<script lang="ts">
  import type { WallpaperPreferences } from '@spotify-wallpaper/shared-types';
  import { polarSamplePoints } from '../visualizerGeometry';

  export let mode: WallpaperPreferences['visualizer']['mode'];
  export let samples: number[];
  export let peak: number;
  export let style: string;

  $: safeSamples = Array.isArray(samples)
    ? samples.map((sample) => Number.isFinite(sample) ? Math.max(0, sample) : 0)
    : [];
  $: peakLevel = Number.isFinite(peak) ? Math.min(1, Math.max(0, peak)) : 0;
  $: radialBarStarts = polarSamplePoints(safeSamples.map(() => 0), {
    centerX: 50,
    centerY: 50,
    radius: 36,
    amplitude: 0
  });
  $: radialBarEnds = polarSamplePoints(safeSamples, {
    centerX: 50,
    centerY: 50,
    radius: 36,
    amplitude: 18
  });
  $: waveformPoints = polarSamplePoints(safeSamples, {
    centerX: 50,
    centerY: 50,
    radius: 35,
    amplitude: 14
  });
  $: waveformSvgPoints = waveformPoints.map(({ x, y }) => `${x},${y}`).join(' ');
  $: ringDash = `${Math.max(0.08, peakLevel)} ${Math.max(0, 1 - peakLevel)}`;
</script>

<div class="visualizer visualizer-album" aria-hidden="true" style={style}>
  <svg class="visualizer-canvas" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
    {#if mode === 'radial-bars'}
      {#each radialBarStarts as start, index}
        {@const end = radialBarEnds[index]}
        <line class="radial-bar" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      {/each}
    {:else if mode === 'waveform-line'}
      <polygon class="circular-waveform" points={waveformSvgPoints} />
    {:else}
      <circle class="ring-base" cx="50" cy="50" r="36" pathLength="1" />
      <circle
        class="ring-active"
        cx="50"
        cy="50"
        r="36"
        pathLength="1"
        stroke-dasharray={ringDash}
        style={`opacity: ${0.3 + peakLevel * 0.7}; stroke-width: calc(var(--visualizer-line-width, 2px) + ${peakLevel * 4}px)`}
      />
    {/if}
  </svg>
</div>

<style>
  .visualizer { position: absolute; display: grid; width: 100%; height: 100%; place-items: center; overflow: visible; pointer-events: none; color: var(--visualizer-color, #ffffff); opacity: .78; filter: drop-shadow(0 0 calc(12px * var(--visualizer-glow, 0)) var(--visualizer-color, #ffffff)); }
  .visualizer-canvas { width: 100%; height: 100%; overflow: visible; transform: scale(var(--visualizer-radius, 1)); transform-origin: center; }
  .ring-base, .ring-active { fill: none; stroke: var(--visualizer-color, #ffffff); stroke-linecap: round; }
  .ring-base { opacity: .2; stroke-width: var(--visualizer-line-width, 2px); }
  .ring-active { stroke-linecap: round; }
  .radial-bar { stroke: var(--visualizer-color, #ffffff); stroke-linecap: round; stroke-width: var(--visualizer-gap, 2px); }
  .circular-waveform { fill: var(--visualizer-color, #ffffff); fill-opacity: .12; stroke: var(--visualizer-color, #ffffff); stroke-linejoin: round; stroke-width: var(--visualizer-line-width, 2px); }
</style>
