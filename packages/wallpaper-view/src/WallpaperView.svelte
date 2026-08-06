<script lang="ts">
  import type { LayoutItem, WallpaperViewIntent, WallpaperViewModel } from '@spotify-wallpaper/shared-types';
  import { effectiveVisualizerConfig, visualizerRingRadius, visualizerStyleVariables } from './visualizerStyle';

  export let model: WallpaperViewModel;
  export let onIntent: (intent: WallpaperViewIntent) => void = () => undefined;
  export let showDebug = false;

  let detailHoverUiVisible = false;

  $: settings = model.settings;
  $: playback = model.playback;
  $: showAlbumDetails = settings.player.displayMode === 'album-details';
  $: artists = playback.artists.join(', ');
  $: displayedProgressMs = playback.isPlaying
    ? Math.min(
        playback.durationMs,
        playback.progressMs + Math.max(0, model.progressNowMs - new Date(playback.fetchedAt).getTime())
      )
    : playback.progressMs;
  $: progressPercent = playback.durationMs > 0 ? Math.min(100, (displayedProgressMs / playback.durationMs) * 100) : 0;
  $: activeAlbumItem = showAlbumDetails
    ? settings.layout.items.albumArt
    : { ...settings.layout.items.albumArt, x: 50, y: 48, anchor: 'center' as const, zIndex: 2 };
  $: activeSeekbarItem = showAlbumDetails
    ? settings.layout.items.seekbar
    : { ...settings.layout.items.seekbar, x: 50, y: 70.5, anchor: 'center' as const, width: Math.min(440, activeAlbumItem.width + 40), zIndex: 3 };
  $: activeTextColor = settings.theme.autoReadability ? model.theme.readableTextColor : settings.theme.textColor;
  $: effectiveVisualizer = effectiveVisualizerConfig(settings);
  $: visualizerSamples = (model.visualizerFrame?.samples ?? [0])
    .filter((_, index) => index % effectiveVisualizer.sampleStep === 0)
    .slice(0, effectiveVisualizer.barCount);
  $: visualizerVariables = Object.entries(visualizerStyleVariables(settings.visualizer, model.theme, effectiveVisualizer))
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ');
  $: themeVariables = [
    `--theme-primary: ${model.theme.primaryColor}`,
    `--theme-secondary: ${model.theme.secondaryColor}`,
    `--theme-accent: ${model.theme.accentColor}`,
    `--theme-muted: ${model.theme.mutedColor}`,
    `--theme-text: ${activeTextColor}`,
    `--theme-overlay: ${model.theme.overlayOpacity}`
  ].join('; ');
  $: albumBackground = backgroundStyle(settings, model.theme, playback.albumImageUrl);
  $: clock = new Date(model.nowMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: settings.clock.showSeconds ? '2-digit' : undefined,
    hour12: settings.clock.hour12
  });
  $: clockDate = settings.clock.showDate
    ? new Date(model.nowMs).toLocaleDateString([], {
        weekday: settings.clock.showWeekday ? 'short' : undefined,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
    : settings.clock.showWeekday
      ? new Date(model.nowMs).toLocaleDateString([], { weekday: 'short' })
      : '';

  const dispatch = (intent: WallpaperViewIntent) => onIntent(intent);

  const layoutStyle = (item: LayoutItem): string => {
    const positionX = layoutPosition(item.x, item.unit);
    const positionY = layoutPosition(item.y, item.unit);
    const left = item.responsive === 'clamp-safe-area'
      ? `clamp(${item.safeAreaMargin}px, ${positionX}, calc(100% - ${item.safeAreaMargin}px))`
      : positionX;
    const top = item.responsive === 'clamp-safe-area'
      ? `clamp(${item.safeAreaMargin}px, ${positionY}, calc(100% - ${item.safeAreaMargin}px))`
      : positionY;
    const translate = anchorTranslate(item.anchor);
    return [
      `left: ${left}`,
      `top: ${top}`,
      `width: ${item.width}px`,
      `height: ${item.height}px`,
      `opacity: ${item.opacity}`,
      `z-index: ${item.zIndex}`,
      `transform: translate(${translate}) scale(${item.scale}) rotate(${item.rotation}deg)`,
      'transform-origin: center'
    ].join('; ');
  };

  const layoutPosition = (value: number, unit: LayoutItem['unit']): string => {
    if (unit === 'percent') return `${value}%`;
    if (unit === 'vw') return `${value}cqw`;
    if (unit === 'vh') return `${value}cqh`;
    return `${value}px`;
  };

  const anchorTranslate = (anchor: LayoutItem['anchor']): string => {
    const x = anchor.endsWith('right') ? '-100%' : anchor.endsWith('center') || anchor === 'center' ? '-50%' : '0';
    const y = anchor.startsWith('bottom') ? '-100%' : anchor.startsWith('center') || anchor === 'center' ? '-50%' : '0';
    return `${x}, ${y}`;
  };

  const backgroundStyle = (preferences: WallpaperViewModel['settings'], theme: WallpaperViewModel['theme'], imageUrl: string): string => {
    const image = imageUrl ? `url("${imageUrl.replaceAll('"', '')}")` : 'none';
    if (preferences.background.mode === 'solid-color') {
      return `background: ${preferences.background.solidColor};`;
    }
    const overlay = preferences.background.mode === 'album-gradient'
      ? `linear-gradient(135deg, ${theme.primaryColor}, ${theme.secondaryColor})`
      : `linear-gradient(135deg, rgb(0 0 0 / 34%), ${theme.darkColor})`;
    return `background-image: ${overlay}, ${image}; background-position: center; background-size: cover; filter: blur(${preferences.background.blurPx / 8}px); opacity: ${preferences.background.opacity};`;
  };

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
  };

  const seekFromInput = (event: Event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value)) dispatch({ type: 'seek', positionMs: Math.round((playback.durationMs * value) / 100) });
  };

  const volumeFromInput = (event: Event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value)) dispatch({ type: 'volume', volumePercent: value });
  };
</script>

<main
  class="wallpaper"
  class:album-only-mode={!showAlbumDetails}
  class:album-details-mode={showAlbumDetails}
  class:detail-hover-ui-visible={detailHoverUiVisible}
  aria-label="Spotify wallpaper"
  style={themeVariables}
>
  <div class="album-backdrop" aria-hidden="true" style={albumBackground}></div>

  {#if model.providerConfigurationError}
    <div class="provider-status" role="status" aria-live="polite">{model.providerConfigurationError}</div>
  {/if}
  {#if model.settingsWarning}
    <div class="settings-status" role="status" aria-live="polite">{model.settingsWarning}</div>
  {/if}

  {#if settings.visualizer.enabled}
    <div class="visualizer" aria-hidden="true" style={`${layoutStyle(activeAlbumItem)}; ${visualizerVariables}`}>
      {#if settings.visualizer.mode === 'waveform-line'}
        <svg class="waveform" viewBox="0 0 100 40" preserveAspectRatio="none"><polyline points={visualizerSamples.map((sample, index, samples) => `${(index / Math.max(1, samples.length - 1)) * 100},${20 - Math.max(-18, Math.min(18, sample * 20))}`).join(' ')} /></svg>
      {:else if settings.visualizer.mode === 'album-ring'}
        <svg class="visualizer-ring" viewBox="-100 -100 200 200"><circle class="ring-base" r={visualizerRingRadius(settings.visualizer.radius)} /><circle class="ring-active" r={visualizerRingRadius(settings.visualizer.radius)} stroke-dasharray={`${Math.max(0.08, (model.visualizerFrame?.peak ?? 0) * 0.94)} 1`} /></svg>
      {:else}
        {#each visualizerSamples as sample, index}
          <span style={`--bar: ${Math.max(0.08, sample)}; --angle: ${(index / Math.max(1, Math.min(effectiveVisualizer.barCount, visualizerSamples.length))) * 360}deg`}></span>
        {/each}
      {/if}
    </div>
  {/if}

  {#if settings.albumArt.visible && activeAlbumItem.enabled}
    <div
      class="layout-item album-frame"
      style={layoutStyle(activeAlbumItem)}
      role="group"
      aria-label="Album art and playback controls"
      on:mouseenter={() => (detailHoverUiVisible = true)}
      on:mouseleave={() => (detailHoverUiVisible = false)}
      on:focusin={() => (detailHoverUiVisible = true)}
      on:focusout={() => (detailHoverUiVisible = false)}
    >
      <div class:album-spinning={playback.isPlaying} class="album-disc">
        <img src={playback.albumImageUrl} alt={playback.albumName} class="album-art" />
      </div>
      {#if settings.seekbar.visible && settings.seekbar.style === 'album-ring'}
        <svg class="album-progress-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="album-progress-track" cx="50" cy="50" r="47"></circle>
          <circle class="album-progress-fill" cx="50" cy="50" r="47" style={`stroke-dashoffset: ${295.31 - (295.31 * progressPercent) / 100}`}></circle>
        </svg>
      {/if}
    </div>
  {/if}

  {#if showAlbumDetails && settings.text.visible && settings.layout.items.trackText.enabled}
    <section class="layout-item track-panel" style={layoutStyle(settings.layout.items.trackText)} role="group" aria-label="Track details">
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
      style={layoutStyle({ ...activeAlbumItem, opacity: 1, zIndex: activeAlbumItem.zIndex + 16 })}
      aria-label={showAlbumDetails ? 'Show album only' : 'Show album details'}
      on:click={() => dispatch({ type: 'toggle-display-mode' })}
    ></button>
  {/if}

  {#if showAlbumDetails && settings.player.visible}
    <section
      class="control-dock"
      class:detail-hover-ui-visible={detailHoverUiVisible}
      role="group"
      aria-label="Playback control dock"
      on:mouseenter={() => (detailHoverUiVisible = true)}
      on:mouseleave={() => (detailHoverUiVisible = false)}
      on:focusin={() => (detailHoverUiVisible = true)}
      on:focusout={() => (detailHoverUiVisible = false)}
    >
      {#if settings.player.controlsEnabled || settings.player.showShuffleRepeat}
        <div class="player-controls" aria-label="Spotify playback controls">
          {#if settings.player.showShuffleRepeat}
            <button class:active-control={playback.shuffleState === true} class="icon-control" type="button" disabled={!model.canControlPlayback || playback.shuffleState === null} aria-label="Toggle shuffle" on:click={() => dispatch({ type: 'shuffle', state: playback.shuffleState !== true })}>⇄</button>
          {/if}
          <button class="icon-control" type="button" disabled={!model.canControlPlayback} aria-label="Previous track" on:click={() => dispatch({ type: 'previous' })}>◀◀</button>
          <button class="icon-control" type="button" disabled={!model.canControlPlayback} aria-label={playback.isPlaying ? 'Pause playback' : 'Resume playback'} on:click={() => dispatch({ type: playback.isPlaying ? 'pause' : 'play' })}>{playback.isPlaying ? 'Ⅱ' : '▶'}</button>
          <button class="icon-control" type="button" disabled={!model.canControlPlayback} aria-label="Next track" on:click={() => dispatch({ type: 'next' })}>▶▶</button>
          {#if settings.player.showShuffleRepeat}
            <button class:active-control={playback.repeatState === 'context'} class="icon-control" type="button" disabled={!model.canControlPlayback || playback.repeatState === null} aria-label="Repeat context" on:click={() => dispatch({ type: 'repeat', state: playback.repeatState === 'context' ? 'off' : 'context' })}>↻</button>
          {/if}
        </div>
      {/if}
      {#if settings.player.showVolume && playback.volumePercent !== null}
        <label class="volume-control"><span>Volume</span><input type="range" min="0" max="100" value={playback.volumePercent} disabled={!model.canControlPlayback} aria-label="Spotify volume" on:input={volumeFromInput} /></label>
      {/if}
      {#if model.controlStatusText}<span class="control-status-dot" aria-label={model.controlStatusText}></span>{/if}
      {#if settings.seekbar.visible && settings.seekbar.style === 'line' && activeSeekbarItem.enabled}
        <div class="detail-hover-seekbar" aria-label="Playback progress">
          <input class="seekbar-input" type="range" min="0" max="100" value={progressPercent} disabled={!model.canControlPlayback || playback.durationMs <= 0} aria-label="Seek playback position" on:input={seekFromInput} />
          <div class="seekbar" aria-hidden="true"><div class="seekbar-fill" style={`width: ${progressPercent}%`}></div></div>
          <div class="time-row"><span>{formatTime(displayedProgressMs)}</span><span>{formatTime(playback.durationMs)}</span></div>
        </div>
      {/if}
    </section>
  {/if}

  {#if !showAlbumDetails && settings.seekbar.visible && settings.seekbar.style === 'line' && activeSeekbarItem.enabled}
    <section class="layout-item seekbar-panel" style={layoutStyle(activeSeekbarItem)} role="group" aria-label="Playback progress">
      <input class="seekbar-input" type="range" min="0" max="100" value={progressPercent} disabled={!model.canControlPlayback || playback.durationMs <= 0} aria-label="Seek playback position" on:input={seekFromInput} />
      <div class="seekbar" aria-hidden="true"><div class="seekbar-fill" style={`width: ${progressPercent}%`}></div></div>
      <div class="time-row"><span>{formatTime(displayedProgressMs)}</span><span>{formatTime(playback.durationMs)}</span></div>
    </section>
  {/if}

  {#if showAlbumDetails && settings.clock.enabled && settings.layout.items.clock.enabled}
    <time class="layout-item clock" style={`${layoutStyle(settings.layout.items.clock)}; font-size: ${settings.clock.fontSizePx}px; font-weight: ${settings.clock.fontWeight}; letter-spacing: ${settings.clock.letterSpacingPx}px; opacity: ${settings.clock.opacity}; color: ${activeTextColor}`} aria-label="Clock" datetime={new Date(model.nowMs).toISOString()}>
      <strong>{clock}</strong>
      {#if clockDate}<span>{clockDate}</span>{/if}
    </time>
  {/if}

  {#if model.transitionState}
    <div class={`transition-overlay transition-${model.transitionState.resolvedPreset}`} style={`--transition-duration: ${model.transitionState.durationMs}ms; --transition-easing: ${model.transitionState.easing}`} aria-hidden="true">
      {#if settings.transitions.background}<div class="transition-backdrop" style={backgroundStyle(settings, model.theme, model.transitionState.previous.albumImageUrl)}></div>{/if}
      {#if settings.transitions.albumArt && settings.albumArt.visible && settings.layout.items.albumArt.enabled}<div class="transition-album" style={layoutStyle(settings.layout.items.albumArt)}><img src={model.transitionState.previous.albumImageUrl} alt="" /></div>{/if}
      {#if settings.transitions.text && settings.text.visible && settings.layout.items.trackText.enabled}<div class="transition-copy" style={layoutStyle(settings.layout.items.trackText)}><strong>{model.transitionState.previous.title}</strong><span>{model.transitionState.previous.artists.join(', ')}</span></div>{/if}
    </div>
  {/if}

  {#if showDebug && settings.debug.enabled}
    <aside class="layout-item debug-panel" style={layoutStyle(settings.layout.items.debug)} aria-label="Debug overlay">
      <div>Mode: {model.playbackMode}</div>
      <div>Spotify credential: {model.credentialConfigured ? 'configured' : 'not configured'}</div>
      <div>Spotify status: {model.spotifyStatusText}</div>
      <div>Polling: {model.lastPollingDelayMs ? `${model.lastPollingDelayMs}ms` : 'idle'}</div>
      <div>Errors: {model.consecutiveErrors}</div>
      <div>Visualizer: {settings.visualizer.enabled ? `${model.visualizerFrame?.source ?? 'idle'}` : 'disabled'}</div>
      <div>Visual core: {model.visualCoreStatus}</div>
    </aside>
  {/if}
</main>

<style>
  :global(*) { box-sizing: border-box; }
  .wallpaper { container-type: size; position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden; color: var(--theme-text, #f6f7fb); background: #111318; isolation: isolate; }
  .album-backdrop { position: absolute; inset: -8cqh -8cqw; z-index: -2; transform: scale(1.08); }
  .layout-item { position: absolute; }
  .provider-status { position: absolute; top: 18px; left: 50%; z-index: 10; padding: 8px 14px; border: 1px solid rgb(255 255 255 / 30%); border-radius: 999px; color: var(--theme-text); background: rgb(0 0 0 / 38%); transform: translateX(-50%); }
  .settings-status { position: absolute; top: 58px; left: 50%; z-index: 10; padding: 8px 14px; border: 1px solid rgb(255 208 122 / 44%); border-radius: 999px; color: #ffe0a6; background: rgb(0 0 0 / 42%); transform: translateX(-50%); }
  .album-frame { border-radius: 50%; pointer-events: none; }
  .album-disc { position: relative; width: 100%; height: 100%; overflow: hidden; border: 1px solid rgb(255 255 255 / 20%); border-radius: 50%; box-shadow: 0 28px 80px rgb(0 0 0 / 42%); }
  .album-art { display: block; width: 100%; height: 100%; object-fit: cover; }
  .album-spinning { animation: album-spin 22s linear infinite; }
  .album-progress-ring { position: absolute; inset: -5%; width: 110%; height: 110%; transform: rotate(-90deg); }
  .album-progress-track, .album-progress-fill { fill: none; stroke-linecap: round; stroke-width: 2.2; }
  .album-progress-track { stroke: rgb(255 255 255 / 20%); }
  .album-progress-fill { stroke: var(--theme-accent, #96d0b4); stroke-dasharray: 295.31; }
  .track-panel { display: flex; min-width: 0; flex-direction: column; justify-content: center; text-shadow: 0 2px 18px rgb(0 0 0 / 48%); }
  .track-panel h1 { margin: 0; display: block; width: 100%; max-width: min(100%, 680px); max-height: 3.05em; overflow: hidden; overflow-wrap: anywhere; font-size: clamp(2.2rem, 4.7cqw, 4.6rem); line-height: 1.04; }
  .track-panel p { margin: 0; overflow-wrap: anywhere; }
  .track-panel .eyebrow { margin: 0 0 16px; color: var(--theme-accent); font-size: clamp(.78rem, 1.2cqw, .9rem); font-weight: 700; text-transform: uppercase; }
  .track-panel .artists { margin: 16px 0 0; max-width: min(100%, 540px); overflow: hidden; color: rgb(246 247 251 / 84%); font-size: clamp(1rem, 1.8cqw, 1.35rem); font-weight: 600; }
  .track-panel .album { margin: 16px 0 0; max-width: min(100%, 520px); overflow: hidden; color: rgb(246 247 251 / 66%); font-size: clamp(.95rem, 1.6cqw, 1.12rem); text-overflow: ellipsis; white-space: nowrap; }
  .album-mode-toggle-hitbox { border: 0; background: transparent; cursor: pointer; }
  .control-dock { position: absolute; bottom: clamp(180px, 19cqh, 230px); left: 50%; z-index: 4; display: flex; align-items: center; gap: 18px; width: min(92cqw, 900px); padding: 12px 18px; border: 1px solid rgb(255 255 255 / 18%); border-radius: 999px; background: rgb(0 0 0 / 22%); opacity: 0; transform: translate(-50%, 12px); transition: opacity 320ms ease, transform 260ms cubic-bezier(.22, 1, .36, 1); pointer-events: none; backdrop-filter: blur(12px); }
  .control-dock.detail-hover-ui-visible { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
  .player-controls { display: flex; align-items: center; gap: 8px; }
  .icon-control { min-width: 34px; min-height: 30px; border: 1px solid rgb(255 255 255 / 25%); border-radius: 8px; color: var(--theme-text); background: rgb(0 0 0 / 25%); cursor: pointer; }
  .icon-control:disabled, .volume-control input:disabled, .seekbar-input:disabled { cursor: not-allowed; opacity: .48; }
  .active-control { color: var(--theme-accent); border-color: var(--theme-accent); }
  .volume-control { display: flex; align-items: center; gap: 8px; min-width: 150px; color: var(--theme-muted); font-size: .72rem; }
  .volume-control input { min-width: 0; flex: 1; accent-color: var(--theme-accent); }
  .detail-hover-seekbar { position: relative; min-width: 180px; flex: 1; }
  .seekbar-panel { display: grid; gap: 6px; padding: 8px 12px; color: var(--theme-text); opacity: 1; transition: opacity 320ms ease; }
  .album-details-mode .seekbar-panel { opacity: 0; pointer-events: none; }
  .seekbar-input { position: absolute; inset: -10px 0 auto; z-index: 1; width: 100%; height: 24px; cursor: pointer; opacity: 0; }
  .seekbar { width: 100%; height: 5px; overflow: hidden; border-radius: 999px; background: rgb(255 255 255 / 16%); }
  .seekbar-fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--theme-primary), var(--theme-accent)); }
  .time-row { display: flex; justify-content: space-between; opacity: .62; font-size: .72rem; font-variant-numeric: tabular-nums; }
  .control-status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--theme-accent); }
  .control-status { color: var(--theme-muted); }
  .clock { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; color: var(--theme-text); line-height: 1.05; text-align: center; text-shadow: 0 2px 18px rgb(0 0 0 / 34%); }
  .clock strong { font-size: clamp(1.2rem, 3cqw, 2.2rem); font-variant-numeric: tabular-nums; }
  .clock span { color: var(--theme-muted); }
  .debug-panel { display: grid; gap: 4px; padding: 10px; color: var(--theme-muted); background: rgb(0 0 0 / 35%); border-radius: 8px; font: .72rem/1.35 ui-monospace, monospace; }
  .visualizer { position: absolute; pointer-events: none; display: flex; align-items: center; justify-content: center; border-radius: 50%; opacity: .7; overflow: visible; color: var(--visualizer-color); filter: drop-shadow(0 0 calc(14px * var(--visualizer-glow)) var(--visualizer-color)); animation: visualizer-rotate var(--visualizer-rotation-duration) linear infinite; animation-direction: var(--visualizer-rotation-direction); animation-play-state: var(--visualizer-animation-play-state); }
  .visualizer span { position: absolute; width: var(--visualizer-gap); height: calc(20% + var(--bar) * 30% * var(--visualizer-radius)); background: var(--visualizer-color); transform: rotate(var(--angle)) translateY(calc(-110% * var(--visualizer-radius))); transform-origin: center bottom; box-shadow: 0 0 calc(12px * var(--visualizer-glow)) var(--visualizer-color); }
  .visualizer-ring { width: 100%; height: 100%; transform: rotate(-90deg); }
  .ring-base, .ring-active { fill: none; stroke: var(--visualizer-color); stroke-linecap: round; stroke-width: var(--visualizer-line-width); }
  .ring-base { opacity: .22; }
  .ring-active { stroke-width: calc(var(--visualizer-line-width) + 2px); }
  .waveform { width: 100%; height: 100%; overflow: visible; }
  .waveform polyline { fill: none; stroke: var(--visualizer-color); stroke-width: var(--visualizer-line-width); stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 calc(8px * var(--visualizer-glow)) var(--visualizer-color)); }
  .transition-overlay { position: absolute; inset: 0; z-index: 5; pointer-events: none; animation: transition-fade-out var(--transition-duration, 700ms) var(--transition-easing, ease-out) both; }
  .transition-backdrop { position: absolute; inset: -8cqh -8cqw; z-index: -1; }
  .transition-album { position: absolute; overflow: hidden; border: 1px solid rgb(255 255 255 / 18%); border-radius: 8px; box-shadow: 0 28px 80px rgb(0 0 0 / 42%); }
  .transition-album img { width: 100%; height: 100%; object-fit: cover; }
  .transition-copy { display: flex; min-width: 0; flex-direction: column; justify-content: center; color: var(--theme-text); text-shadow: 0 2px 18px rgb(0 0 0 / 48%); }
  .transition-copy strong { font-size: clamp(1.4rem, 4cqw, 3.4rem); }
  .transition-copy span { color: var(--theme-muted); }
  @keyframes album-spin { to { rotate: 360deg; } }
  @keyframes visualizer-rotate { to { rotate: 360deg; } }
  @keyframes transition-fade-out { from { opacity: 1; } to { opacity: 0; } }
  .transition-slide-left { animation-name: transition-slide-left; }
  .transition-zoom-in { animation-name: transition-zoom-in; }
  .transition-blur-fade { animation-name: transition-blur-fade; }
  @keyframes transition-slide-left { to { opacity: 0; transform: translateX(-54px); } }
  @keyframes transition-zoom-in { to { opacity: 0; transform: scale(1.08); } }
  @keyframes transition-blur-fade { to { filter: blur(12px); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .album-spinning, .visualizer { animation: none; } }
</style>
