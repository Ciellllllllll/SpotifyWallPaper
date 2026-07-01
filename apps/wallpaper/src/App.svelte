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
  import { initVisualCore, visualCoreStatus } from './wasm/visualCore';
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

  const playbackButtonIcon = (kind: 'previous' | 'play' | 'pause' | 'next' | 'shuffle' | 'repeat'): string => {
    switch (kind) {
      case 'previous':
        return 'M19 6 L10 12 L19 18 Z M8 6 H5 V18 H8 Z';
      case 'play':
        return 'M8 5 L19 12 L8 19 Z';
      case 'pause':
        return 'M7 5 H10 V19 H7 Z M14 5 H17 V19 H14 Z';
      case 'next':
        return 'M5 6 L14 12 L5 18 Z M16 6 H19 V18 H16 Z';
      case 'shuffle':
        return 'M4 7 H7.5 C10.5 7 11.8 17 16 17 H20 M17 14 L20 17 L17 20 M4 17 H7.5 C9 17 10 14 11 12 M15 7 H20 M17 4 L20 7 L17 10';
      case 'repeat':
        return 'M7 7 H17 C19 7 20 8.2 20 10 V11 M17 4 L20 7 L17 10 M17 17 H7 C5 17 4 15.8 4 14 V13 M7 20 L4 17 L7 14';
    }
  };

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
    initVisualCore();
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
      <div class:album-spinning={playback.isPlaying} class="album-disc">
        <img src={playback.albumImageUrl} alt={playback.albumName} class="album-art" />
      </div>
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
        {#if settings.player.controlsEnabled || settings.player.showShuffleRepeat}
          <div class="player-controls" aria-label="Spotify playback controls">
            {#if settings.player.showShuffleRepeat}
              <button
                class="icon-control line-control"
                type="button"
                class:active-control={playback.shuffleState === true}
                disabled={!canControlPlayback || playback.shuffleState === null}
                aria-label="Toggle shuffle"
                on:click={() => void runPlaybackCommand({ type: 'shuffle', state: playback.shuffleState !== true })}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={playbackButtonIcon('shuffle')} />
                </svg>
              </button>
            {/if}
            <button class="icon-control" type="button" disabled={!canControlPlayback} aria-label="Previous track" on:click={() => void runPlaybackCommand({ type: 'previous' })}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={playbackButtonIcon('previous')} />
              </svg>
            </button>
            <button
              class="icon-control"
              type="button"
              disabled={!canControlPlayback}
              aria-label={playback.isPlaying ? 'Pause playback' : 'Resume playback'}
              on:click={() => void runPlaybackCommand({ type: playback.isPlaying ? 'pause' : 'play' })}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={playbackButtonIcon(playback.isPlaying ? 'pause' : 'play')} />
              </svg>
            </button>
            <button class="icon-control" type="button" disabled={!canControlPlayback} aria-label="Next track" on:click={() => void runPlaybackCommand({ type: 'next' })}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={playbackButtonIcon('next')} />
              </svg>
            </button>
            {#if settings.player.showShuffleRepeat}
              <button
                class="icon-control line-control"
                type="button"
                class:active-control={playback.repeatState === 'context'}
                disabled={!canControlPlayback || playback.repeatState === null}
                aria-label="Repeat context"
                on:click={() => void runPlaybackCommand({ type: 'repeat', state: playback.repeatState === 'context' ? 'off' : 'context' })}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={playbackButtonIcon('repeat')} />
                </svg>
              </button>
            {/if}
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
      <div>Visual core: {visualCoreStatus()}</div>
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
    background-image: linear-gradient(rgb(12 14 18 / 38%), rgb(12 14 18 / 72%)), url('../mock/album-placeholder.svg');
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
    border-radius: 50%;
    overflow: visible;
    filter: drop-shadow(0 28px 80px rgb(0 0 0 / 42%));
    animation: album-enter 780ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  .album-disc {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 18%);
    border-radius: 50%;
    background: rgb(255 255 255 / 8%);
    transform-origin: center;
    transition:
      filter 420ms ease,
      scale 420ms cubic-bezier(0.22, 1, 0.36, 1);
    will-change: transform;
  }

  .album-art {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .album-spinning {
    animation: album-spin 22s linear infinite;
  }

  .album-progress-ring {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
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
    position: relative;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    color: var(--theme-text, #f6f7fb);
    text-shadow: 0 2px 18px rgb(0 0 0 / calc(var(--theme-shadow-strength, 0.7) * 0.72));
    animation: text-enter 680ms 90ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  .track-panel::before {
    content: '';
    position: absolute;
    left: -48px;
    top: 13%;
    width: 2px;
    height: 74%;
    border-radius: 999px;
    background: linear-gradient(
      180deg,
      transparent,
      color-mix(in srgb, var(--theme-accent, #f8d778) 72%, white 18%),
      rgb(255 255 255 / 28%),
      transparent
    );
    box-shadow: 0 0 22px color-mix(in srgb, var(--theme-accent, #f8d778) 48%, transparent);
    opacity: 0.96;
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
    flex-wrap: nowrap;
    gap: 8px;
    margin-top: 12px;
  }

  .player-controls button {
    display: inline-grid;
    place-items: center;
    width: 44px;
    min-width: 44px;
    height: 38px;
    border: 1px solid rgb(255 255 255 / 18%);
    border-radius: 8px;
    color: var(--theme-text, #f6f7fb);
    background: rgb(15 17 22 / 46%);
    cursor: pointer;
    transition:
      translate 180ms ease,
      scale 180ms ease,
      border-color 220ms ease,
      background 220ms ease,
      opacity 220ms ease;
  }

  .player-controls button svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .player-controls button:not(:disabled):hover {
    translate: 0 -1px;
    border-color: color-mix(in srgb, var(--theme-accent, #f8d778) 56%, white 10%);
    background: rgb(255 255 255 / 12%);
  }

  .player-controls button:not(:disabled):active {
    scale: 0.94;
  }

  .player-controls button:not(:disabled):hover svg {
    transform: scale(1.08);
  }

  .line-control svg {
    fill: none;
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
    width: min(100%, 340px);
    margin-top: 14px;
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
    transition: width 380ms cubic-bezier(0.22, 1, 0.36, 1);
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
    margin: 10px 0 0;
    color: rgb(246 247 251 / 74%);
    font-size: 0.88rem;
    line-height: 1.45;
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
    top: 22px;
    right: 28px;
    z-index: 4;
    width: 64px;
    height: 34px;
    padding: 0 10px;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 18%);
    border-radius: 8px;
    color: #f6f7fb;
    background: rgb(15 17 22 / 58%);
    backdrop-filter: blur(10px);
    cursor: pointer;
    transition:
      translate 180ms ease,
      border-color 220ms ease,
      background 220ms ease;
  }

  .debug-toggle:hover {
    translate: 0 -1px;
    border-color: rgb(255 255 255 / 32%);
    background: rgb(15 17 22 / 72%);
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

  @keyframes album-spin {
    from {
      rotate: 0deg;
    }

    to {
      rotate: 360deg;
    }
  }

  @keyframes album-enter {
    from {
      opacity: 0;
      scale: 0.94;
      filter: drop-shadow(0 12px 38px rgb(0 0 0 / 20%));
    }

    to {
      opacity: 1;
      scale: 1;
      filter: drop-shadow(0 28px 80px rgb(0 0 0 / 42%));
    }
  }

  @keyframes text-enter {
    from {
      opacity: 0;
      translate: 18px 0;
    }

    to {
      opacity: 1;
      translate: 0 0;
    }
  }

  @media (max-width: 720px) {
    .wallpaper {
      min-height: 620px;
    }

    h1 {
      font-size: clamp(2.4rem, 13vw, 4.8rem);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .album-spinning {
      animation: none;
    }

    .album-frame,
    .track-panel {
      animation: none;
    }
  }
</style>
