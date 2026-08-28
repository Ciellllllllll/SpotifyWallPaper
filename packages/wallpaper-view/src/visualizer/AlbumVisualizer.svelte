<script lang="ts">
  import type { WallpaperPreferences } from '@spotify-wallpaper/shared-types';
  import { polarSamplePoints, radialBarRectangles } from '../visualizerGeometry';

  export let mode: WallpaperPreferences['visualizer']['mode'];
  export let samples: number[];
  export let peak: number;
  export let style: string;
  export let radius = 1;
  export let rotation = 0;
  export let intensity = 1;

  const circularBaseRadius = 50;
  const radialBarSide = 2;
  const radialBarMinSample = 0.03;

  $: safeSamples = Array.isArray(samples)
    ? samples.map((sample) => Number.isFinite(sample) ? Math.max(0, sample) : 0)
    : [];
  $: peakLevel = Number.isFinite(peak) ? Math.min(1, Math.max(0, peak)) : 0;
  $: visualizerRadius = Number.isFinite(radius) ? Math.min(2.2, Math.max(0.6, radius)) : 1;
  $: counterRotation = Number.isFinite(rotation) ? -rotation : 0;
  $: visualizerIntensity = Number.isFinite(intensity) ? Math.max(0, intensity) : 1;
  $: radialBarPolygons = mode === 'radial-bars'
    ? radialBarRectangles(safeSamples, {
        centerX: 50,
        centerY: 50,
        radius: circularBaseRadius,
        amplitude: 18 * visualizerRadius,
        side: radialBarSide,
        minSample: visualizerIntensity > 0 ? radialBarMinSample * visualizerIntensity : Number.MAX_VALUE
      })
    : [];
  $: waveformPoints = mode === 'waveform-line'
    ? polarSamplePoints(safeSamples, {
        centerX: 50,
        centerY: 50,
        radius: circularBaseRadius,
        amplitude: 13 * visualizerRadius
      })
    : [];
  $: radialBarSvgPoints = radialBarPolygons
    .map((points) => points.map(({ x, y }) => `${x},${y}`).join(' '));
  $: waveformSvgPoints = waveformPoints.map(({ x, y }) => `${x},${y}`).join(' ');
  $: ringDash = mode === 'album-ring'
    ? `${Math.max(0.08, peakLevel)} ${Math.max(0, 1 - peakLevel)}`
    : '0 1';
</script>

<div class="visualizer visualizer-album" aria-hidden="true" style={style}>
  <svg class="visualizer-canvas" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={`transform: rotate(${counterRotation}deg)`}>
    {#if mode === 'radial-bars'}
      {#each radialBarSvgPoints as points, index (index)}
        <polygon class="radial-bar" class:radial-bar-hidden={points.length === 0} points={points} />
      {/each}
    {:else if mode === 'waveform-line'}
      <polygon class="circular-waveform" points={waveformSvgPoints} />
    {:else}
      <circle class="ring-base" cx="50" cy="50" r={circularBaseRadius} pathLength="1" />
      <circle
        class="ring-active"
        cx="50"
        cy="50"
        r={circularBaseRadius}
        pathLength="1"
        stroke-dasharray={ringDash}
        style={`opacity: ${0.3 + peakLevel * 0.7}; stroke-width: calc(var(--visualizer-line-width, 2px) + ${peakLevel * 4}px)`}
      />
    {/if}
  </svg>
</div>

<style>
  .visualizer { position: absolute; inset: 0; display: grid; width: 100%; height: 100%; place-items: center; overflow: visible; pointer-events: none; color: var(--visualizer-color, #ffffff); opacity: .78; filter: drop-shadow(0 0 calc(12px * var(--visualizer-glow, 0)) var(--visualizer-color, #ffffff)); }
  .visualizer-album { z-index: 0; border-radius: 50%; }
  .visualizer-canvas { width: 100%; height: 100%; overflow: visible; transform-origin: center; }
  .ring-base, .ring-active { fill: none; stroke: var(--visualizer-color, #ffffff); stroke-linecap: round; }
  .ring-base { opacity: .2; stroke-width: var(--visualizer-line-width, 2px); }
  .ring-active { stroke-linecap: round; }
  .radial-bar { fill: var(--visualizer-color, #ffffff); stroke: none; }
  .radial-bar-hidden { display: none; }
  .circular-waveform { fill: var(--visualizer-color, #ffffff); fill-opacity: .12; stroke: var(--visualizer-color, #ffffff); stroke-linejoin: round; stroke-width: var(--visualizer-line-width, 2px); }
</style>
