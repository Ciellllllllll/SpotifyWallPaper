<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import './app.css';
  import type { NormalizedPlayback, SpotifyPlaybackError, WallpaperSettings, WallpaperTheme } from '@spotify-wallpaper/shared-types';
  import LyricsLayer from './lyrics/LyricsLayer.svelte';
  import { lyricDisplayState, parseLrc } from './lyrics/lrc';
  import { mockPlayback } from './mock/mockPlayback';
  import { defaultSettings } from './settings/defaultSettings';
  import { loadSettings } from './settings/loadSettings';
  import { credentialsFromSettings, nextPollingDelayMs, SpotifyPlaybackSession } from './spotify/polling';
  import { layoutStyle } from './layout/style';
  import { buildBackgroundStyle, buildThemeCssVariables } from './theme/background';
  import { fallbackThemeFromSeed, hexToRgb, themeFromPrimary } from './theme/colors';
  import { extractAlbumTheme } from './theme/extractAlbumTheme';
  import TransitionOverlay from './transitions/TransitionOverlay.svelte';
  import { createTransitionState, type TrackTransitionState } from './transitions/model';
  import VisualizerLayer from './visualizer/VisualizerLayer.svelte';
  import { idleVisualizerFrame, shapeVisualizerFrame } from './visualizer/model';
  import { startAudioBridge } from './wallpaperEngine/audio';
  import { applySettingsPatch, registerWallpaperPropertyListener } from './wallpaperEngine/properties';
  import type { SpotifyPlaybackCommand } from './spotify/types';
  import type { VisualizerFrame } from '@spotify-wallpaper/shared-types';

  let playback: NormalizedPlayback = mockPlayback;
  let previousPlayback: NormalizedPlayback | null = null;
  let settings: WallpaperSettings = defaultSettings;
  let spotifyError: SpotifyPlaybackError | null = null;
  let settingsWarning: string | null = null;
  let playbackMode = 'browser mock';
  let settingsSource = 'defaults/browser';
  let visualizerFrame: VisualizerFrame | null = null;
  let previousVisualizerFrame: VisualizerFrame | null = null;
  let transitionState: TrackTransitionState | null = null;
  let theme: WallpaperTheme = fallbackThemeFromSeed(mockPlayback.id ?? mockPlayback.title);
  let themeSeed = mockPlayback.id ?? mockPlayback.title;
  let themeImageUrl = '';
  let lastPollingDelayMs: number | null = null;
  let consecutiveErrors = 0;
  let spotifySession: SpotifyPlaybackSession | null = null;
  let controlError: SpotifyPlaybackError | null = null;
  let controlBusy = false;

  let now = new Date();
  let progressNowMs = Date.now();
  let debugOpen = settings.debug.enabled;
  let clockInterval: number | null = null;
  let progressInterval: number | null = null;
  let visualizerIdleInterval: number | null = null;
  let pollingTimeout: number | null = null;
  let transitionTimeout: number | null = null;
  let stopAudioBridge: (() => void) | null = null;
  let lastAudioFrameAtMs = 0;
  let pollingRunId = 0;

  const updateClock = () => {
    now = new Date();
  };

  const clockUpdateDelayMs = (date = new Date()) => {
    if (settings.clock.showSeconds) {
      return 1000;
    }

    const msUntilNextMinute = 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds());
    return Math.max(1000, msUntilNextMinute);
  };

  const formatTime = (ms: number) => {
    const safeMs = Math.max(0, ms);
    const totalSeconds = Math.floor(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  $: displayedProgressMs = playback.isPlaying
    ? Math.min(
        playback.durationMs,
        playback.progressMs + Math.max(0, progressNowMs - new Date(playback.fetchedAt).getTime())
      )
    : playback.progressMs;
  $: progressPercent = playback.durationMs > 0 ? Math.min(100, (displayedProgressMs / playback.durationMs) * 100) : 0;
  $: artists = playback.artists.join(', ');
  $: clock = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: settings.clock.showSeconds ? '2-digit' : undefined,
    hour12: settings.clock.hour12
  });
  $: clockDate = settings.clock.showDate
    ? now.toLocaleDateString([], {
        weekday: settings.clock.showWeekday ? 'short' : undefined,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
    : settings.clock.showWeekday
      ? now.toLocaleDateString([], { weekday: 'short' })
      : '';
  $: clockColor = settings.clock.colorMode === 'fixed' ? settings.clock.fixedColor : activeTextColor;
  $: clockStyle = [
    layoutStyle(layoutItems.clock),
    `font-size: ${settings.clock.fontSizePx}px`,
    `font-weight: ${settings.clock.fontWeight}`,
    `letter-spacing: ${settings.clock.letterSpacingPx}px`,
    `opacity: ${settings.clock.opacity}`,
    `color: ${clockColor}`
  ].join('; ');
  $: activeTextColor = settings.theme.autoReadability ? theme.readableTextColor : settings.theme.textColor;
  $: albumBackground = buildBackgroundStyle(settings, theme, playback.albumImageUrl);
  $: themeVariables = `${buildThemeCssVariables(theme)}; --theme-text: ${activeTextColor}`;
  $: layoutItems = settings.layout.items;
  $: parsedLyrics = parseLrc(settings.lyrics.sourceText);
  $: lyricsState = lyricDisplayState(
    parsedLyrics.lines,
    displayedProgressMs + settings.lyrics.offsetMs,
    settings.lyrics.enabled,
    settings.lyrics.showMissingState
  );
  $: canControlPlayback =
    Boolean(spotifySession) &&
    playback.source === 'spotify' &&
    settings.player.controlsEnabled &&
    !playback.device?.isRestricted &&
    !controlBusy;
  $: controlStatusText = controlError?.message ?? (playback.device?.isRestricted ? 'Current Spotify device is restricted.' : '');

  $: {
    const nextSeed = playback.id ?? playback.albumName ?? playback.title;
    if (playback.albumImageUrl !== themeImageUrl || nextSeed !== themeSeed || settings.theme.mode === 'custom') {
      themeImageUrl = playback.albumImageUrl;
      themeSeed = nextSeed;
      updateTheme(playback.albumImageUrl, nextSeed);
    }
  }

  const replacePlayback = (next: NormalizedPlayback) => {
    if (playback.id !== next.id || playback.itemType !== next.itemType) {
      previousPlayback = playback;
      startTrackTransition(playback, next);
    }

    playback = next;
  };

  const clearTransition = () => {
    if (transitionTimeout !== null) {
      window.clearTimeout(transitionTimeout);
      transitionTimeout = null;
    }
    transitionState = null;
  };

  const startTrackTransition = (previous: NormalizedPlayback, current: NormalizedPlayback) => {
    if (transitionTimeout !== null) {
      window.clearTimeout(transitionTimeout);
      transitionTimeout = null;
    }

    transitionState = createTransitionState(previous, current, settings);
    if (!transitionState) {
      return;
    }

    const startedAtMs = transitionState.startedAtMs;
    transitionTimeout = window.setTimeout(() => {
      if (transitionState?.startedAtMs === startedAtMs) {
        transitionState = null;
        transitionTimeout = null;
      }
    }, transitionState.durationMs);
  };

  const updateTheme = (imageUrl: string, seed: string) => {
    const customColor = settings.theme.customPrimaryColor ? hexToRgb(settings.theme.customPrimaryColor) : null;
    if (settings.theme.mode === 'custom' && customColor) {
      theme = themeFromPrimary(customColor, 'fallback');
      return;
    }

    if (settings.theme.mode === 'fallback') {
      theme = fallbackThemeFromSeed(seed);
      return;
    }

    const expectedImageUrl = imageUrl;
    void extractAlbumTheme(imageUrl, seed).then((nextTheme) => {
      if (themeImageUrl === expectedImageUrl) {
        theme = nextTheme;
      }
    });
  };

  const startClock = () => {
    if (clockInterval !== null) {
      window.clearTimeout(clockInterval);
    }

    const tick = () => {
      updateClock();
      clockInterval = window.setTimeout(tick, clockUpdateDelayMs(now));
    };

    clockInterval = window.setTimeout(tick, clockUpdateDelayMs(now));
  };

  const startProgressTicker = () => {
    progressInterval = window.setInterval(() => {
      progressNowMs = Date.now();
    }, 1000);
  };

  const clearVisualizerFrame = () => {
    visualizerFrame = null;
    previousVisualizerFrame = null;
    lastAudioFrameAtMs = 0;
  };

  const acceptVisualizerFrame = (frame: VisualizerFrame) => {
    if (!settings.visualizer.enabled) {
      clearVisualizerFrame();
      return;
    }

    const shapedFrame = shapeVisualizerFrame(frame, previousVisualizerFrame, settings.visualizer);
    previousVisualizerFrame = shapedFrame;
    visualizerFrame = shapedFrame;
    lastAudioFrameAtMs = Date.now();
  };

  const updateIdleVisualizerFrame = () => {
    if (!settings.visualizer.enabled) {
      clearVisualizerFrame();
      return;
    }

    const nowMs = Date.now();
    const staleAfterMs = settings.performance.mode === 'low-power' ? 1600 : 700;
    if (lastAudioFrameAtMs > 0 && nowMs - lastAudioFrameAtMs < staleAfterMs) {
      return;
    }

    acceptVisualizerFrame(idleVisualizerFrame(nowMs, settings.visualizer));
  };

  const startVisualizerIdleTicker = () => {
    if (visualizerIdleInterval !== null) {
      window.clearInterval(visualizerIdleInterval);
    }

    const intervalMs = settings.performance.mode === 'low-power' ? 1000 : 500;
    visualizerIdleInterval = window.setInterval(updateIdleVisualizerFrame, intervalMs);
    updateIdleVisualizerFrame();
  };

  const stopPolling = () => {
    pollingRunId += 1;
    if (pollingTimeout !== null) {
      window.clearTimeout(pollingTimeout);
    }
    pollingTimeout = null;
    lastPollingDelayMs = null;
    spotifySession = null;
  };

  const updatePlaybackAfterCommand = (command: SpotifyPlaybackCommand) => {
    switch (command.type) {
      case 'play':
        playback = { ...playback, isPlaying: true, fetchedAt: new Date().toISOString(), progressMs: displayedProgressMs };
        return;
      case 'pause':
        playback = { ...playback, isPlaying: false, fetchedAt: new Date().toISOString(), progressMs: displayedProgressMs };
        return;
      case 'seek':
        playback = { ...playback, progressMs: Math.min(playback.durationMs, Math.max(0, command.positionMs)), fetchedAt: new Date().toISOString() };
        return;
      case 'volume':
        playback = {
          ...playback,
          volumePercent: Math.min(100, Math.max(0, Math.round(command.volumePercent))),
          device: playback.device
            ? { ...playback.device, volumePercent: Math.min(100, Math.max(0, Math.round(command.volumePercent))) }
            : playback.device
        };
        return;
      case 'shuffle':
        playback = { ...playback, shuffleState: command.state };
        return;
      case 'repeat':
        playback = { ...playback, repeatState: command.state };
        return;
      case 'next':
      case 'previous':
        return;
    }
  };

  const runPlaybackCommand = async (command: SpotifyPlaybackCommand) => {
    if (!spotifySession || !canControlPlayback) {
      return;
    }

    controlBusy = true;
    controlError = null;
    const result = await spotifySession.control(command);
    controlBusy = false;

    if (result.ok) {
      updatePlaybackAfterCommand(command);
      return;
    }

    controlError = result.error;
  };

  const seekToPercent = (value: string) => {
    const percent = Number(value);
    if (!Number.isFinite(percent) || playback.durationMs <= 0) {
      return;
    }

    void runPlaybackCommand({ type: 'seek', positionMs: Math.round((playback.durationMs * percent) / 100) });
  };

  const setVolume = (value: string) => {
    const volumePercent = Number(value);
    if (!Number.isFinite(volumePercent)) {
      return;
    }

    void runPlaybackCommand({ type: 'volume', volumePercent });
  };

  const applyRuntimeSettings = (nextSettings: WallpaperSettings, source: string, warning: string | null) => {
    settings = nextSettings;
    settingsWarning = warning;
    settingsSource = source;
    debugOpen = settings.debug.enabled;
    if (!settings.transitions.enabled) {
      clearTransition();
    }
    if (!settings.visualizer.enabled) {
      clearVisualizerFrame();
    }
    startClock();
    startVisualizerIdleTicker();
    configureSpotifyPolling();
  };

  const configureSpotifyPolling = () => {
    stopPolling();

    const credentials = credentialsFromSettings(settings);
    if (!credentials) {
      playbackMode = 'browser mock';
      spotifyError = null;
      controlError = null;
      consecutiveErrors = 0;
      return;
    }

    playbackMode = 'spotify';
    const session = new SpotifyPlaybackSession(credentials);
    spotifySession = session;
    const runId = pollingRunId;

    const poll = async () => {
      const result = await session.poll();
      if (runId !== pollingRunId) {
        return;
      }

      if (result.ok) {
        replacePlayback(result.value);
        spotifyError = null;
        consecutiveErrors = 0;
      } else {
        spotifyError = result.error;
        consecutiveErrors += 1;
      }

      lastPollingDelayMs = nextPollingDelayMs({
        playback,
        error: spotifyError,
        consecutiveErrors,
        settings
      });
      pollingTimeout = window.setTimeout(poll, lastPollingDelayMs);
    };

    void poll();
  };

  onMount(() => {
    const loaded = loadSettings();
    applyRuntimeSettings(loaded.settings, loaded.warning ? 'fallback defaults' : 'defaults/browser', loaded.warning);
    startProgressTicker();
    registerWallpaperPropertyListener((result) => {
      applyRuntimeSettings(applySettingsPatch(settings, result.patch), 'wallpaper-engine properties', result.warning);
    });
    stopAudioBridge = startAudioBridge(acceptVisualizerFrame);

    return stopPolling;
  });

  onDestroy(() => {
    if (clockInterval !== null) {
      window.clearTimeout(clockInterval);
    }
    if (progressInterval !== null) {
      window.clearInterval(progressInterval);
    }
    clearTransition();
    if (visualizerIdleInterval !== null) {
      window.clearInterval(visualizerIdleInterval);
    }
    if (stopAudioBridge) {
      stopAudioBridge();
    }
    stopPolling();
  });
</script>

<main class="wallpaper" aria-label="Spotify wallpaper mock preview" style={themeVariables}>
  <div class="album-backdrop" aria-hidden="true" style={albumBackground}></div>

  <VisualizerLayer frame={visualizerFrame} {settings} {theme} albumItem={layoutItems.albumArt} />

  <LyricsLayer {settings} state={lyricsState} />

  {#if settings.albumArt.visible && layoutItems.albumArt.enabled}
    <div class="layout-item album-frame" style={layoutStyle(layoutItems.albumArt)}>
      <img src={playback.albumImageUrl} alt={playback.albumName} class="album-art" />
      {#if settings.seekbar.visible && settings.seekbar.style === 'album-ring'}
        <svg class="album-progress-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="album-progress-track" cx="50" cy="50" r="47"></circle>
          <circle
            class="album-progress-fill"
            cx="50"
            cy="50"
            r="47"
            style={`stroke-dashoffset: ${295.31 - (295.31 * progressPercent) / 100}`}
          ></circle>
        </svg>
      {/if}
    </div>
  {/if}

  {#if settings.text.visible && layoutItems.trackText.enabled}
    <section class="layout-item track-panel" style={layoutStyle(layoutItems.trackText)}>
      <p class="eyebrow">{playback.isPlaying ? 'Playing' : 'Paused'}</p>
      <h1>{playback.title}</h1>
      <p class="artists">{artists}</p>
      <p class="album">{playback.albumName}</p>
      {#if settings.player.visible}
        <div class="player-meta">
          <span>{playback.isPlaying ? 'Playing' : 'Paused'}</span>
          {#if settings.player.showDevice && playback.deviceName}
            <span>{playback.deviceName}</span>
          {/if}
          {#if settings.player.showVolume && playback.volumePercent !== null}
            <span>{playback.volumePercent}%</span>
          {/if}
        </div>
        {#if settings.player.controlsEnabled}
          <div class="player-controls" aria-label="Spotify playback controls">
            <button type="button" disabled={!canControlPlayback} aria-label="Previous track" on:click={() => void runPlaybackCommand({ type: 'previous' })}>
              Prev
            </button>
            <button
              type="button"
              disabled={!canControlPlayback}
              aria-label={playback.isPlaying ? 'Pause playback' : 'Resume playback'}
              on:click={() => void runPlaybackCommand({ type: playback.isPlaying ? 'pause' : 'play' })}
            >
              {playback.isPlaying ? 'Pause' : 'Play'}
            </button>
            <button type="button" disabled={!canControlPlayback} aria-label="Next track" on:click={() => void runPlaybackCommand({ type: 'next' })}>
              Next
            </button>
          </div>
        {/if}
        {#if settings.player.showShuffleRepeat}
          <div class="player-controls secondary-controls" aria-label="Spotify playback modes">
            <button
              type="button"
              class:active-control={playback.shuffleState === true}
              disabled={!canControlPlayback || playback.shuffleState === null}
              aria-label="Toggle shuffle"
              on:click={() => void runPlaybackCommand({ type: 'shuffle', state: playback.shuffleState !== true })}
            >
              Shuffle
            </button>
            <button
              type="button"
              class:active-control={playback.repeatState === 'context'}
              disabled={!canControlPlayback || playback.repeatState === null}
              aria-label="Repeat context"
              on:click={() => void runPlaybackCommand({ type: 'repeat', state: playback.repeatState === 'context' ? 'off' : 'context' })}
            >
              Repeat
            </button>
          </div>
        {/if}
        {#if settings.player.showVolume && playback.volumePercent !== null}
          <label class="volume-control">
            <span>Volume</span>
            <input
              type="range"
              min="0"
              max="100"
              value={playback.volumePercent}
              disabled={!canControlPlayback}
              aria-label="Spotify volume"
              on:change={(event) => setVolume(event.currentTarget.value)}
            />
          </label>
        {/if}
        {#if controlStatusText}
          <p class="status-line">{controlStatusText}</p>
        {/if}
      {/if}
      {#if spotifyError}
        <p class="status-line">{spotifyError.message}</p>
      {/if}
    </section>
  {/if}

  {#if settings.seekbar.visible && settings.seekbar.style === 'line' && layoutItems.seekbar.enabled}
    <section class="layout-item seekbar-panel" style={layoutStyle(layoutItems.seekbar)} aria-label="Playback progress">
      <input
        class="seekbar-input"
        type="range"
        min="0"
        max="100"
        value={progressPercent}
        disabled={!canControlPlayback || playback.durationMs <= 0}
        aria-label="Seek playback position"
        on:change={(event) => seekToPercent(event.currentTarget.value)}
      />
      <div class="seekbar" aria-hidden="true">
        <div class="seekbar-fill" style={`width: ${progressPercent}%`}></div>
      </div>
      <div class="time-row">
        <span>{formatTime(displayedProgressMs)}</span>
        <span>{formatTime(playback.durationMs)}</span>
      </div>
    </section>
  {/if}

  {#if settings.clock.enabled && layoutItems.clock.enabled}
    <div class="layout-item clock" style={clockStyle} aria-label="Clock">
      <span>{clock}</span>
      {#if clockDate}
        <small>{clockDate}</small>
      {/if}
    </div>
  {/if}

  <TransitionOverlay state={transitionState} {settings} {theme} />

  <button class="debug-toggle" type="button" aria-pressed={debugOpen} on:click={() => (debugOpen = !debugOpen)}>
    Debug
  </button>

  {#if debugOpen}
    <aside class="layout-item debug-panel" style={layoutStyle(layoutItems.debug)} aria-label="Debug overlay">
      <div>Mode: {playbackMode}</div>
      <div>Spotify token: {settings.spotify.hasRefreshToken ? 'configured' : 'not configured'}</div>
      <div>Spotify status: {spotifyError ? spotifyError.kind : 'ok'}</div>
      <div>Polling: {lastPollingDelayMs ? `${lastPollingDelayMs}ms` : 'idle'}</div>
      <div>Preset: {settings.layout.preset}</div>
      <div>Theme: {theme.source}</div>
      <div>Previous item: {previousPlayback ? previousPlayback.title : 'none'}</div>
      <div>Transition: {transitionState ? transitionState.resolvedPreset : 'idle'}</div>
      <div>Visualizer: {settings.visualizer.enabled ? `${settings.visualizer.mode}/${visualizerFrame?.source ?? 'idle'}` : 'disabled'}</div>
      <div>Lyrics: {settings.lyrics.enabled ? `${lyricsState.status}/${parsedLyrics.lines.length}` : 'disabled'}</div>
      <div>Performance: {settings.performance.mode}</div>
      <div>Audio peak: {visualizerFrame ? visualizerFrame.peak.toFixed(2) : '0.00'}</div>
      <div>Settings: {settingsWarning ?? settingsSource}</div>
    </aside>
  {/if}
</main>

<style>
  .wallpaper {
    position: relative;
    width: 100vw;
    height: 100vh;
    min-height: 540px;
    overflow: hidden;
    background:
      radial-gradient(circle at 18% 24%, rgb(110 155 180 / 42%), transparent 34%),
      linear-gradient(135deg, var(--theme-dark, #17191e) 0%, #22262d 45%, #111318 100%);
  }

  .album-backdrop {
    position: absolute;
    inset: -8vh -8vw;
    background-image: linear-gradient(rgb(12 14 18 / 38%), rgb(12 14 18 / 72%)), url('/mock/album-placeholder.svg');
    background-size: cover;
    background-position: center;
    filter: blur(26px) saturate(1.2);
    transform: scale(1.08);
    opacity: 0.72;
  }

  .layout-item {
    position: absolute;
  }

  .album-frame {
    aspect-ratio: 1;
    border: 1px solid rgb(255 255 255 / 18%);
    border-radius: 8px;
    overflow: hidden;
    background: rgb(255 255 255 / 8%);
    box-shadow: 0 28px 80px rgb(0 0 0 / 42%);
  }

  .album-art {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .album-progress-ring {
    position: absolute;
    inset: 6px;
    width: calc(100% - 12px);
    height: calc(100% - 12px);
    pointer-events: none;
    transform: rotate(-90deg);
  }

  .album-progress-track,
  .album-progress-fill {
    fill: none;
    stroke-width: 2.4;
  }

  .album-progress-track {
    stroke: rgb(255 255 255 / 20%);
  }

  .album-progress-fill {
    stroke: var(--theme-accent, #f8d778);
    stroke-dasharray: 295.31;
    stroke-linecap: round;
    transition: stroke-dashoffset 240ms ease;
  }

  .track-panel {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    color: var(--theme-text, #f6f7fb);
    text-shadow: 0 2px 18px rgb(0 0 0 / calc(var(--theme-shadow-strength, 0.7) * 0.72));
  }

  .eyebrow {
    margin: 0 0 14px;
    color: var(--theme-accent, #96d0b4);
    font-size: clamp(0.78rem, 1.2vw, 0.9rem);
    font-weight: 700;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    overflow-wrap: anywhere;
    font-size: clamp(2.2rem, 7vw, 6rem);
    line-height: 0.96;
  }

  .artists {
    margin: 18px 0 0;
    overflow-wrap: anywhere;
    color: var(--theme-text, #f3f5f9);
    font-size: clamp(1.1rem, 2.2vw, 1.6rem);
    font-weight: 650;
  }

  .album {
    margin: 8px 0 0;
    overflow-wrap: anywhere;
    color: rgb(246 247 251 / 72%);
    font-size: clamp(0.95rem, 1.6vw, 1.12rem);
  }

  .player-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
    color: rgb(246 247 251 / 70%);
    font-size: 0.82rem;
  }

  .player-meta span {
    max-width: 100%;
    padding: 4px 8px;
    border: 1px solid rgb(255 255 255 / 14%);
    border-radius: 8px;
    background: rgb(15 17 22 / 28%);
    overflow-wrap: anywhere;
  }

  .player-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  .secondary-controls {
    margin-top: 8px;
  }

  .player-controls button {
    min-width: 64px;
    height: 34px;
    border: 1px solid rgb(255 255 255 / 18%);
    border-radius: 8px;
    color: var(--theme-text, #f6f7fb);
    background: rgb(15 17 22 / 46%);
    cursor: pointer;
  }

  .player-controls button:disabled {
    cursor: not-allowed;
    opacity: 0.46;
  }

  .player-controls .active-control {
    border-color: var(--theme-accent, #f8d778);
    background: color-mix(in srgb, var(--theme-accent, #f8d778) 22%, rgb(15 17 22 / 62%));
  }

  .volume-control {
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(100%, 320px);
    margin-top: 12px;
    color: rgb(246 247 251 / 70%);
    font-size: 0.82rem;
  }

  .volume-control input {
    width: 100%;
    accent-color: var(--theme-accent, #f8d778);
  }

  .seekbar {
    width: 100%;
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: rgb(255 255 255 / 20%);
  }

  .seekbar-fill {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--theme-primary, #9ee2bd), var(--theme-accent, #f8d778));
  }

  .seekbar-input {
    position: absolute;
    inset: -8px 0 auto;
    z-index: 1;
    width: 100%;
    height: 24px;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .seekbar-input:disabled {
    cursor: not-allowed;
  }

  .time-row {
    display: flex;
    justify-content: space-between;
    width: 100%;
    margin-top: 10px;
    color: rgb(246 247 251 / 70%);
    font-size: 0.88rem;
    font-variant-numeric: tabular-nums;
  }

  .status-line {
    width: min(100%, 420px);
    margin: 14px 0 0;
    color: rgb(246 247 251 / 74%);
    font-size: 0.88rem;
  }

  .clock {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    font-variant-numeric: tabular-nums;
    line-height: 1.05;
    text-shadow: 0 2px 18px rgb(0 0 0 / 42%);
  }

  .clock small {
    margin-top: 8px;
    font-size: 0.42em;
    font-weight: 600;
    opacity: 0.72;
  }

  .debug-toggle {
    position: absolute;
    top: 18px;
    right: 18px;
    z-index: 4;
    min-width: 72px;
    height: 36px;
    border: 1px solid rgb(255 255 255 / 18%);
    border-radius: 8px;
    color: #f6f7fb;
    background: rgb(15 17 22 / 58%);
    backdrop-filter: blur(10px);
    cursor: pointer;
  }

  .debug-panel {
    padding: 14px;
    border: 1px solid rgb(255 255 255 / 14%);
    border-radius: 8px;
    color: rgb(246 247 251 / 82%);
    background: rgb(15 17 22 / 72%);
    backdrop-filter: blur(14px);
    font-size: 0.82rem;
    line-height: 1.7;
  }

  @media (max-width: 720px) {
    .wallpaper {
      min-height: 620px;
    }

    h1 {
      font-size: clamp(2.4rem, 13vw, 4.8rem);
    }
  }
</style>
