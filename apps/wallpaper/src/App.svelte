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
      window.clearInterval(clockInterval);
    }

    clockInterval = window.setInterval(updateClock, settings.clock.showSeconds ? 1000 : 30000);
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
    startVisualizerIdleTicker();
    configureSpotifyPolling();
  };

  const configureSpotifyPolling = () => {
    stopPolling();

    const credentials = credentialsFromSettings(settings);
    if (!credentials) {
      playbackMode = 'browser mock';
      spotifyError = null;
      consecutiveErrors = 0;
      return;
    }

    playbackMode = 'spotify';
    const session = new SpotifyPlaybackSession(credentials);
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
    startClock();
    startProgressTicker();
    registerWallpaperPropertyListener((result) => {
      applyRuntimeSettings(applySettingsPatch(settings, result.patch), 'wallpaper-engine properties', result.warning);
    });
    stopAudioBridge = startAudioBridge(acceptVisualizerFrame);

    return stopPolling;
  });

  onDestroy(() => {
    if (clockInterval !== null) {
      window.clearInterval(clockInterval);
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
    </div>
  {/if}

  {#if settings.text.visible && layoutItems.trackText.enabled}
    <section class="layout-item track-panel" style={layoutStyle(layoutItems.trackText)}>
      <p class="eyebrow">{playback.isPlaying ? 'Playing' : 'Paused'}</p>
      <h1>{playback.title}</h1>
      <p class="artists">{artists}</p>
      <p class="album">{playback.albumName}</p>
      {#if spotifyError}
        <p class="status-line">{spotifyError.message}</p>
      {/if}
    </section>
  {/if}

  {#if settings.seekbar.visible && layoutItems.seekbar.enabled}
    <section class="layout-item seekbar-panel" style={layoutStyle(layoutItems.seekbar)} aria-label="Playback progress">
      <div class="seekbar">
        <div class="seekbar-fill" style={`width: ${progressPercent}%`}></div>
      </div>
      <div class="time-row">
        <span>{formatTime(displayedProgressMs)}</span>
        <span>{formatTime(playback.durationMs)}</span>
      </div>
    </section>
  {/if}

  {#if settings.clock.enabled && layoutItems.clock.enabled}
    <div class="layout-item clock" style={layoutStyle(layoutItems.clock)} aria-label="Clock">{clock}</div>
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
    align-items: center;
    justify-content: flex-end;
    color: var(--theme-text, rgb(246 247 251 / 88%));
    font-size: clamp(1.2rem, 3vw, 2.4rem);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 2px 18px rgb(0 0 0 / 42%);
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
