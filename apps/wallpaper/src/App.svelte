<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import './app.css';
  import type { LayoutItem, NormalizedPlayback, SpotifyPlaybackError, WallpaperPreferences, WallpaperTheme } from '@spotify-wallpaper/shared-types';
  import { mockPlayback } from './mock/mockPlayback';
  import { defaultSettings } from './settings/defaultSettings';
  import { loadSettings } from './settings/loadSettings';
  import { layoutStyle } from './layout/style';
  import { buildBackgroundStyle, buildThemeCssVariables } from './theme/background';
  import { fallbackThemeFromSeed } from './theme/colors';
  import TransitionOverlay from './transitions/TransitionOverlay.svelte';
  import type { TrackTransitionState } from './transitions/model';
  import VisualizerLayer from './visualizer/VisualizerLayer.svelte';
  import { registerWallpaperPropertyListener } from './wallpaperEngine/properties';
  import { initVisualCore, visualCoreStatus } from './wasm/visualCore';
  import type { SpotifyPlaybackCommand } from './spotify/types';
  import type { VisualizerFrame } from '@spotify-wallpaper/shared-types';
  import { createWallpaperRuntime, type WallpaperRuntimeSnapshot, type WallpaperRuntimeViewModel } from './runtime/wallpaperRuntime';

  let playback: NormalizedPlayback = mockPlayback;
  let previousPlayback: NormalizedPlayback | null = null;
  let settings: WallpaperPreferences = defaultSettings;
  let spotifyError: SpotifyPlaybackError | null = null;
  let settingsWarning: string | null = null;
  let playbackMode = 'browser mock';
  let settingsSource = 'defaults/browser';
  let visualizerFrame: VisualizerFrame | null = null;
  let previousVisualizerFrame: VisualizerFrame | null = null;
  let transitionState: TrackTransitionState | null = null;
  let theme: WallpaperTheme = fallbackThemeFromSeed(mockPlayback.id ?? mockPlayback.title);
  let lastPollingDelayMs: number | null = null;
  let consecutiveErrors = 0;
  let providerSelection: 'mock' | 'ready' | 'invalid' = 'mock';
  let providerConfigurationError: string | null = null;
  let configurationSafetyGateOpen = false;
  let controlError: SpotifyPlaybackError | null = null;
  let controlBusy = false;
  let credentialStatus: WallpaperRuntimeSnapshot['credentialStatus'] = {
    kind: 'none',
    present: false,
    revision: 0
  };
  let displayMode: 'album-only' | 'album-details' = 'album-only';
  let detailHoverUiVisible = false;

  let now = new Date();
  let progressNowMs = Date.now();
  const wallpaperRuntime = createWallpaperRuntime(defaultSettings);
  let runtimeUnsubscribe: (() => void) | null = null;

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
  $: displayedProgressTime = playback.durationMs > 0 ? formatTime(displayedProgressMs) : '--:--';
  $: displayedDurationTime = playback.durationMs > 0 ? formatTime(playback.durationMs) : '--:--';
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
  $: showAlbumDetails = displayMode === 'album-details';
  $: albumOnlyAlbumItem = {
    ...layoutItems.albumArt,
    x: 50,
    y: 48,
    anchor: 'center',
    zIndex: 2
  } satisfies LayoutItem;
  $: activeAlbumItem = showAlbumDetails ? layoutItems.albumArt : albumOnlyAlbumItem;
  $: albumModeToggleStyle = layoutStyle({
    ...activeAlbumItem,
    opacity: 1,
    zIndex: activeAlbumItem.zIndex + 16
  });
  $: albumOnlySeekbarItem = {
    ...layoutItems.seekbar,
    x: 50,
    y: 70.5,
    anchor: 'center',
    width: Math.min(440, albumOnlyAlbumItem.width + 40),
    zIndex: 3
  } satisfies LayoutItem;
  $: activeSeekbarItem = showAlbumDetails ? layoutItems.seekbar : albumOnlySeekbarItem;
  $: seekbarPanelStyle = `${layoutStyle(activeSeekbarItem)}${
    showAlbumDetails && !detailHoverUiVisible ? '; opacity: 0; pointer-events: none' : ''
  }`;
  $: canControlPlayback =
    providerSelection === 'ready' &&
    playback.source === 'spotify' &&
    settings.player.controlsEnabled &&
    !playback.device?.isRestricted &&
    !controlBusy;
  $: controlStatusText = controlError?.message ?? (playback.device?.isRestricted ? 'Current Spotify device is restricted.' : '');
  $: spotifyStatusText = providerConfigurationError
    ? providerConfigurationError
    : spotifyError
    ? `${spotifyError.kind}${spotifyError.status ? ` ${spotifyError.status}` : ''}: ${spotifyError.message}`
    : 'ok';

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

  const runPlaybackCommand = (command: SpotifyPlaybackCommand) => wallpaperRuntime.execute(command);

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

  const toggleDisplayMode = () => {
    detailHoverUiVisible = false;
    wallpaperRuntime.toggleDisplayMode();
  };

  const showDetailHoverUi = () => {
    detailHoverUiVisible = true;
  };

  const showAlbumOnlyHoverUi = () => {
    if (!showAlbumDetails) {
      showDetailHoverUi();
    }
  };

  const hideAlbumOnlyHoverUi = () => {
    if (!showAlbumDetails) {
      hideDetailHoverUi();
    }
  };

  const hideDetailHoverUi = () => {
    detailHoverUiVisible = false;
  };

  const syncRuntime = (next: WallpaperRuntimeViewModel) => {
    const mutable = next as unknown as WallpaperRuntimeSnapshot;
    playback = mutable.playback;
    previousPlayback = mutable.previousPlayback;
    settings = mutable.settings;
    spotifyError = mutable.spotifyError;
    playbackMode = mutable.playbackMode;
    visualizerFrame = mutable.visualizerFrame;
    previousVisualizerFrame = mutable.previousVisualizerFrame;
    transitionState = mutable.transitionState;
    theme = mutable.theme;
    lastPollingDelayMs = mutable.lastPollingDelayMs;
    consecutiveErrors = mutable.consecutiveErrors;
    providerSelection = mutable.providerSelection;
    providerConfigurationError = mutable.providerConfigurationError;
    controlError = mutable.controlError;
    controlBusy = mutable.controlBusy;
    credentialStatus = mutable.credentialStatus;
    displayMode = mutable.settings.player.displayMode;
    now = new Date(mutable.nowMs);
    progressNowMs = mutable.progressNowMs;
  };

  onMount(() => {
    initVisualCore();
    const loaded = loadSettings();
    configurationSafetyGateOpen = loaded.safetyGateOpen;
    settingsWarning = loaded.warning;
    settingsSource = loaded.warning ? 'fallback defaults' : 'defaults/browser';
    runtimeUnsubscribe = wallpaperRuntime.subscribe(syncRuntime);
    wallpaperRuntime.applyConfiguration(loaded.settings, { kind: 'retain' }, loaded.safetyGateOpen);
    wallpaperRuntime.start();
    registerWallpaperPropertyListener((result) => {
      const safetyAllowed = configurationSafetyGateOpen && result.safetyGateOpen;
      configurationSafetyGateOpen = safetyAllowed;
      settingsWarning = result.warning;
      settingsSource = 'wallpaper-engine properties';
      if (result.settings) {
        wallpaperRuntime.applyConfiguration(result.settings, result.credential, safetyAllowed);
      }
    }, window, () => settings.spotify.provider, () => settings);
  });

  onDestroy(() => {
    runtimeUnsubscribe?.();
    runtimeUnsubscribe = null;
    wallpaperRuntime.dispose();
  });
</script>

<main
  class="wallpaper"
  class:album-only-mode={!showAlbumDetails}
  class:album-details-mode={showAlbumDetails}
  class:detail-hover-ui-visible={detailHoverUiVisible}
  aria-label="Spotify wallpaper mock preview"
  style={themeVariables}
>
  <div class="album-backdrop" aria-hidden="true" style={albumBackground}></div>

  {#if providerConfigurationError}
    <div class="provider-status" role="status" aria-live="polite">{providerConfigurationError}</div>
  {/if}

  <VisualizerLayer frame={visualizerFrame} {settings} {theme} albumItem={activeAlbumItem} />

  {#if settings.albumArt.visible && activeAlbumItem.enabled}
    <div
      class="layout-item album-frame"
      style={layoutStyle(activeAlbumItem)}
      role="group"
      aria-label="Album art and playback controls"
      on:mouseenter={showAlbumOnlyHoverUi}
      on:mouseleave={hideAlbumOnlyHoverUi}
      on:focusin={showAlbumOnlyHoverUi}
      on:focusout={hideAlbumOnlyHoverUi}
    >
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

  {#if showAlbumDetails && settings.text.visible && layoutItems.trackText.enabled}
    <section
      class="layout-item track-panel"
      style={layoutStyle(layoutItems.trackText)}
      role="group"
      aria-label="Track details"
    >
      <p class="eyebrow">{playback.isPlaying ? 'Now Playing' : 'Paused'}</p>
      <h1>{playback.title}</h1>
      <p class="artists">{artists}</p>
      <p class="album">{playback.albumName}</p>
    </section>
  {/if}

  {#if activeAlbumItem.enabled}
    <button
      class="layout-item album-mode-toggle-hitbox"
      type="button"
      style={albumModeToggleStyle}
      aria-label={showAlbumDetails ? 'Show album only' : 'Show album details'}
      on:click={toggleDisplayMode}
      on:mouseenter={showAlbumOnlyHoverUi}
      on:mouseleave={hideAlbumOnlyHoverUi}
      on:focusin={showAlbumOnlyHoverUi}
      on:focusout={hideAlbumOnlyHoverUi}
    ></button>
  {/if}

  {#if showAlbumDetails && settings.player.visible}
    <section
      class="control-dock"
      role="group"
      aria-label="Playback control dock"
      on:mouseenter={showDetailHoverUi}
      on:mouseleave={hideDetailHoverUi}
      on:focusin={showDetailHoverUi}
      on:focusout={hideDetailHoverUi}
    >
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
        <span class="control-status-dot" aria-label={controlStatusText}></span>
      {/if}
      {#if settings.seekbar.visible && settings.seekbar.style === 'line' && activeSeekbarItem.enabled}
        <div class="detail-hover-seekbar" aria-label="Playback progress">
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
            <span>{displayedProgressTime}</span>
            <span>{displayedDurationTime}</span>
          </div>
        </div>
      {/if}
    </section>
  {/if}

  {#if !showAlbumDetails && settings.seekbar.visible && settings.seekbar.style === 'line' && activeSeekbarItem.enabled}
    <section
      class="layout-item seekbar-panel"
      style={seekbarPanelStyle}
      role="group"
      aria-label="Playback progress"
      on:mouseenter={showDetailHoverUi}
      on:mouseleave={hideDetailHoverUi}
      on:focusin={showDetailHoverUi}
      on:focusout={hideDetailHoverUi}
    >
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
        <span>{displayedProgressTime}</span>
        <span>{displayedDurationTime}</span>
      </div>
    </section>
  {/if}

  {#if showAlbumDetails && settings.clock.enabled && layoutItems.clock.enabled}
    <div class="layout-item clock" style={clockStyle} aria-label="Clock">
      <span>{clock}</span>
      {#if clockDate}
        <small>{clockDate}</small>
      {/if}
    </div>
  {/if}

  <TransitionOverlay state={transitionState} {settings} {theme} />

  {#if settings.debug.enabled}
    <aside class="layout-item debug-panel" style={layoutStyle(layoutItems.debug)} aria-label="Debug overlay">
      <div>Mode: {playbackMode}</div>
      <div>Spotify credential: {credentialStatus.present ? 'configured' : 'not configured'}</div>
      <div>Spotify status: {spotifyStatusText}</div>
      <div>Polling: {lastPollingDelayMs ? `${lastPollingDelayMs}ms` : 'idle'}</div>
      <div>Preset: {settings.layout.preset}</div>
      <div>Theme: {theme.source}</div>
      <div>Previous item: {previousPlayback ? previousPlayback.title : 'none'}</div>
      <div>Transition: {transitionState ? transitionState.resolvedPreset : 'idle'}</div>
      <div>Visualizer: {settings.visualizer.enabled ? `${settings.visualizer.mode}/${visualizerFrame?.source ?? 'idle'}` : 'disabled'}</div>
      <div>Visual core: {visualCoreStatus()}</div>
      <div>Performance: {settings.performance.mode}</div>
      <div>Audio peak: {visualizerFrame ? visualizerFrame.peak.toFixed(2) : '0.00'}</div>
      <div>Settings: {settingsWarning ?? settingsSource}</div>
    </aside>
  {/if}
</main>

<style>
  .wallpaper {
    --ease-out-circ: cubic-bezier(0, 0.55, 0.45, 1);

    position: relative;
    width: 100vw;
    height: 100vh;
    min-height: 540px;
    overflow: hidden;
    background:
      radial-gradient(circle at 18% 24%, rgb(96 130 144 / 26%), transparent 32%),
      radial-gradient(circle at 78% 8%, rgb(154 132 75 / 14%), transparent 28%),
      linear-gradient(135deg, var(--theme-dark, #15171c) 0%, #1d2127 45%, #0f1116 100%);
  }

  .album-backdrop {
    position: absolute;
    inset: -8vh -8vw;
    background-image: linear-gradient(rgb(8 10 14 / 56%), rgb(8 10 14 / 80%)), url('../mock/album-placeholder.svg');
    background-size: cover;
    background-position: center;
    filter: blur(30px) saturate(0.86);
    transform: scale(1.08);
    opacity: 0.62;
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
    transition:
      left 560ms var(--ease-out-circ),
      top 560ms var(--ease-out-circ),
      width 560ms var(--ease-out-circ),
      height 560ms var(--ease-out-circ),
      transform 560ms var(--ease-out-circ),
      filter 420ms ease;
  }

  .album-only-mode .album-frame {
    z-index: 8 !important;
  }

  .album-only-mode .album-backdrop,
  .album-only-mode .album-disc,
  .album-only-mode :global(.visualizer-anchor),
  .album-only-mode .seekbar-panel,
  .album-only-mode .seekbar-input {
    pointer-events: none;
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

  .album-mode-toggle-hitbox {
    position: absolute;
    padding: 0;
    border: 0;
    border-radius: 50%;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }

  .album-mode-toggle-hitbox:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--theme-accent, #f8d778) 72%, white 16%);
    outline-offset: 8px;
  }

  .album-mode-toggle-hitbox:active {
    cursor: pointer;
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
    overflow: visible;
    color: var(--theme-text, #f6f7fb);
    text-shadow: 0 2px 18px rgb(0 0 0 / calc(var(--theme-shadow-strength, 0.7) * 0.72));
    animation: text-enter 680ms 90ms cubic-bezier(0.22, 1, 0.36, 1) both;
    transition:
      opacity 360ms ease,
      transform 520ms var(--ease-out-circ);
  }

  .track-panel::before {
    content: '';
    position: absolute;
    left: -48px;
    top: 25%;
    width: 1px;
    height: 42%;
    border-radius: 999px;
    background: linear-gradient(
      180deg,
      transparent,
      color-mix(in srgb, var(--theme-accent, #f8d778) 34%, white 16%),
      rgb(255 255 255 / 12%),
      transparent
    );
    box-shadow: 0 0 14px color-mix(in srgb, var(--theme-accent, #f8d778) 22%, transparent);
    opacity: 0.62;
  }

  .eyebrow {
    margin: 0 0 16px;
    color: var(--theme-accent, #96d0b4);
    font-size: clamp(0.78rem, 1.2vw, 0.9rem);
    font-weight: 700;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    display: block;
    width: 100%;
    max-width: min(100%, 680px);
    max-height: 3.05em;
    overflow: hidden;
    overflow-wrap: anywhere;
    word-break: normal;
    white-space: normal;
    font-size: clamp(2.2rem, 4.7vw, 4.6rem);
    line-height: 1.04;
    mask-image: linear-gradient(180deg, #000 94%, rgb(0 0 0 / 0) 100%);
    transition: max-height 240ms ease;
  }

  .detail-hover-ui-visible h1 {
    max-height: 2.05em;
  }

  .artists {
    margin: 16px 0 0;
    max-width: min(100%, 540px);
    overflow: hidden;
    overflow-wrap: anywhere;
    color: rgb(246 247 251 / 84%);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    font-size: clamp(1rem, 1.8vw, 1.35rem);
    font-weight: 600;
    transition: max-height 240ms ease;
  }

  .detail-hover-ui-visible .artists {
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .album {
    margin: 16px 0 0;
    max-width: min(100%, 520px);
    overflow: hidden;
    overflow-wrap: anywhere;
    color: rgb(246 247 251 / 66%);
    font-size: clamp(0.95rem, 1.6vw, 1.12rem);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .control-dock {
    position: absolute;
    bottom: clamp(180px, 19vh, 230px);
    left: 50%;
    z-index: 4;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    width: min(440px, calc(100vw - 48px));
    opacity: 0;
    pointer-events: auto;
    transform: translate(-50%, 8px);
    transition:
      opacity 240ms ease,
      transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .control-dock > * {
    pointer-events: none;
  }

  .detail-hover-ui-visible .control-dock {
    opacity: 1;
    transform: translate(-50%, 0);
  }

  .detail-hover-ui-visible .control-dock > * {
    pointer-events: auto;
  }

  .player-controls {
    display: flex;
    flex-wrap: nowrap;
    justify-content: center;
    gap: 8px;
    margin-top: 0;
  }

  .player-controls button {
    display: inline-grid;
    place-items: center;
    width: 44px;
    min-width: 44px;
    height: 38px;
    border: 1px solid rgb(255 255 255 / 14%);
    border-radius: 8px;
    color: var(--theme-text, #f6f7fb);
    background: rgb(10 12 16 / 42%);
    box-shadow: 0 12px 28px rgb(0 0 0 / 20%);
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
    margin-top: 0;
    color: rgb(246 247 251 / 58%);
    font-size: 0.82rem;
  }

  .volume-control input {
    width: 100%;
    accent-color: var(--theme-accent, #f8d778);
  }

  .detail-hover-seekbar {
    position: relative;
    width: min(100%, 440px);
  }

  .seekbar {
    width: 100%;
    height: 5px;
    overflow: hidden;
    border-radius: 999px;
    background: rgb(255 255 255 / 16%);
  }

  .seekbar-panel {
    transition:
      left 560ms var(--ease-out-circ),
      top 560ms var(--ease-out-circ),
      width 560ms var(--ease-out-circ),
      height 560ms var(--ease-out-circ),
      transform 560ms var(--ease-out-circ),
      opacity 320ms ease;
  }

  .seekbar-fill {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--theme-primary, #9ee2bd), var(--theme-accent, #f8d778));
    transition: width 380ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .seekbar-input {
    position: absolute;
    inset: -10px 0 auto;
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
    margin-top: 12px;
    color: rgb(246 247 251 / 58%);
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
  }

  .control-status-dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--theme-accent, #f8d778) 70%, white 8%);
    box-shadow: 0 0 14px color-mix(in srgb, var(--theme-accent, #f8d778) 46%, transparent);
    opacity: 0.62;
  }

  .clock {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    font-variant-numeric: tabular-nums;
    line-height: 1.05;
    opacity: 0.78;
    text-shadow: 0 2px 18px rgb(0 0 0 / 34%);
  }

  .clock small {
    margin-top: 8px;
    font-size: 0.42em;
    font-weight: 600;
    opacity: 0.72;
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
    pointer-events: none;
  }

  .provider-status {
    position: fixed;
    top: 1rem;
    left: 50%;
    z-index: 20;
    max-width: min(90vw, 42rem);
    padding: 0.65rem 0.9rem;
    border: 1px solid rgba(255, 184, 92, 0.65);
    border-radius: 0.5rem;
    background: rgba(32, 24, 14, 0.88);
    color: #ffd9a3;
    font-size: 0.8rem;
    transform: translateX(-50%);
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

    .album-frame,
    .seekbar-panel,
    .track-panel {
      transition: none;
    }
  }
</style>
