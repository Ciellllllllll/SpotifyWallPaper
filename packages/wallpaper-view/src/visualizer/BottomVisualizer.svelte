<script lang="ts">
  import type { WallpaperPreferences } from '@spotify-wallpaper/shared-types';

  export let mode: WallpaperPreferences['visualizer']['mode'];
  export let samples: number[];
  export let peak: number;
  export let style: string;
  export let gap = 10;

  $: safeSamples = Array.isArray(samples)
    ? samples.map((sample) => Number.isFinite(sample) ? Math.max(0, sample) : 0)
    : [];
  $: peakLevel = Number.isFinite(peak) ? Math.min(1, Math.max(0, peak)) : 0;
  $: sampleCount = Math.max(1, safeSamples.length);
  $: gapFactor = Math.max(0.2, Math.min(1, 1 - Math.max(0, gap) / 40));
  $: barWidth = Math.max(0.6, Math.min(8, (90 / sampleCount) * 0.72 * gapFactor));
  $: waveformPoints = safeSamples
    .map((sample, index) => {
      const x = 5 + (index / Math.max(1, sampleCount - 1)) * 90;
      const y = 39 - Math.min(1, sample) * 25;
      return `${x},${y}`;
    })
    .join(' ');
  $: activeBandWidth = peakLevel * 90;
  $: activeBandHeight = 2 + peakLevel * 10;
</script>

<div class="visualizer visualizer-bottom" aria-hidden="true" style={style}>
  <svg class="visualizer-canvas" viewBox="0 0 100 40" preserveAspectRatio="none">
    {#if mode === 'radial-bars'}
      {#each safeSamples as sample, index}
        {@const height = 3 + Math.min(1, sample) * 30}
        {@const x = 5 + ((index + 0.5) / sampleCount) * 90 - barWidth / 2}
        <rect class="bottom-bar" x={x} y={40 - height} width={barWidth} height={height} rx="1" />
      {/each}
    {:else if mode === 'waveform-line'}
      <polyline class="horizontal-waveform" points={waveformPoints} />
    {:else}
      <rect class="peak-band-base" x="5" y="38" width="90" height="2" rx="1" />
      <rect
        class="peak-band-active"
        x={50 - activeBandWidth / 2}
        y={40 - activeBandHeight}
        width={activeBandWidth}
        height={activeBandHeight}
        rx="2"
      />
    {/if}
  </svg>
</div>

<style>
  .visualizer { position: absolute; display: grid; width: 100%; height: 100%; place-items: center; overflow: visible; pointer-events: none; color: var(--visualizer-color, #ffffff); opacity: .78; filter: drop-shadow(0 0 calc(12px * var(--visualizer-glow, 0)) var(--visualizer-color, #ffffff)); }
  .visualizer-canvas { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; transform: scaleY(var(--visualizer-radius, 1)); transform-origin: center bottom; }
  .bottom-bar { fill: var(--visualizer-color, #ffffff); }
  .horizontal-waveform { fill: none; stroke: var(--visualizer-color, #ffffff); stroke-linecap: round; stroke-linejoin: round; stroke-width: var(--visualizer-line-width, 2px); }
  .peak-band-base { fill: var(--visualizer-color, #ffffff); fill-opacity: .22; }
  .peak-band-active { fill: var(--visualizer-color, #ffffff); fill-opacity: .88; }
</style>
