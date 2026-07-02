<script lang="ts">
  import type { LayoutItem, VisualizerFrame, WallpaperSettings, WallpaperTheme } from '@spotify-wallpaper/shared-types';
  import { layoutStyle } from '../layout/style';
  import { buildVisualizerBars, buildWaveformPath, effectiveVisualizerConfig, idleVisualizerFrame, visualizerColor } from './model';

  export let frame: VisualizerFrame | null;
  export let settings: WallpaperSettings;
  export let theme: WallpaperTheme;
  export let albumItem: LayoutItem;

  $: config = effectiveVisualizerConfig(settings);
  $: activeFrame = frame ?? idleVisualizerFrame(Date.now(), settings.visualizer);
  $: bars = buildVisualizerBars(activeFrame, settings, config);
  $: wavePath = buildWaveformPath(activeFrame, config.barCount);
  $: color = visualizerColor(settings.visualizer.colorMode, theme);
  $: mode = settings.visualizer.mode;
  $: ringOpacity = Math.min(0.86, 0.2 + activeFrame.peak * 0.72);
  $: ringRadius = mode === 'album-ring' ? 92 - settings.visualizer.lineWidth : 60 + settings.visualizer.gap / 10;
  $: spinDurationSeconds = 18 / Math.max(Math.abs(config.rotationSpeed), 0.08);
  $: anchorStyle = `${layoutStyle(albumItem)} --visualizer-color: ${color}; --visualizer-glow: ${config.glowStrength}; --visualizer-scale: ${settings.visualizer.radius}; --visualizer-spin-duration: ${spinDurationSeconds}s;`;
</script>

{#if settings.visualizer.enabled}
  {#if mode === 'waveform-line'}
    <div class="visualizer-wave" aria-hidden="true" style={`--visualizer-color: ${color}; --visualizer-glow: ${config.glowStrength};`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="presentation">
        <path d={wavePath} />
      </svg>
    </div>
  {:else}
    <div class="layout-item visualizer-anchor" aria-hidden="true" style={anchorStyle}>
      <svg class:slow-spin={settings.visualizer.idleAnimation && mode !== 'album-ring'} viewBox="-100 -100 200 200" role="presentation">
        {#if mode === 'album-ring'}
          <circle
            class="ring-base"
            r={ringRadius}
            pathLength="1"
            stroke-width={settings.visualizer.lineWidth}
          />
          <circle
            class="ring-active"
            r={ringRadius}
            pathLength="1"
            stroke-width={settings.visualizer.lineWidth + activeFrame.peak * 5}
            stroke-dasharray={`${Math.max(0.08, activeFrame.peak * 0.94)} 1`}
            opacity={ringOpacity}
          />
        {:else}
          {#each bars as bar}
            <line
              class="bar"
              x1="0"
              y1={-ringRadius}
              x2="0"
              y2={-(ringRadius + 8 + bar.value * 32)}
              stroke-width={Math.max(1, settings.visualizer.lineWidth * (0.65 + bar.value))}
              opacity={0.32 + bar.value * 0.68}
              transform={`rotate(${bar.angle})`}
            />
          {/each}
        {/if}
      </svg>
    </div>
  {/if}
{/if}

<style>
  .visualizer-anchor {
    position: absolute;
    overflow: hidden;
    border-radius: 50%;
    pointer-events: none;
    z-index: 3;
    filter:
      drop-shadow(0 0 calc(18px * var(--visualizer-glow, 0.5)) var(--visualizer-color))
      drop-shadow(0 16px 34px rgb(0 0 0 / 30%));
  }

  .visualizer-anchor svg {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .slow-spin {
    animation: visualizer-spin var(--visualizer-spin-duration, 112s) linear infinite;
  }

  .ring-base,
  .ring-active,
  .bar {
    fill: none;
    stroke: var(--visualizer-color, #ffffff);
    stroke-linecap: round;
  }

  .ring-base {
    opacity: 0.22;
  }

  .ring-active {
    transform: none;
    transition:
      stroke-dasharray 420ms cubic-bezier(0.22, 1, 0.36, 1),
      stroke-width 420ms cubic-bezier(0.22, 1, 0.36, 1),
      opacity 420ms ease;
  }

  .visualizer-wave {
    position: absolute;
    left: 7vw;
    right: 7vw;
    bottom: 8vh;
    z-index: 1;
    height: 18vh;
    min-height: 92px;
    max-height: 190px;
    pointer-events: none;
    opacity: 0.86;
    filter:
      drop-shadow(0 0 calc(20px * var(--visualizer-glow, 0.5)) var(--visualizer-color))
      drop-shadow(0 12px 34px rgb(0 0 0 / 34%));
  }

  .visualizer-wave svg {
    width: 100%;
    height: 100%;
  }

  .visualizer-wave path {
    fill: none;
    stroke: var(--visualizer-color, #ffffff);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2.6;
  }

  @keyframes visualizer-spin {
    from {
      rotate: 0deg;
    }

    to {
      rotate: 360deg;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .slow-spin {
      animation: none;
    }
  }
</style>
