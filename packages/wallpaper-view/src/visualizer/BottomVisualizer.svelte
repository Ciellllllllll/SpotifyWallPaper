<script lang="ts">
  import type { WallpaperPreferences } from '@spotify-wallpaper/shared-types';
  import { closedPolarSamplePoints } from '../visualizerGeometry';
  import { visualizerResponsePeak, visualizerResponseSample } from '../visualizerStyle';

  export let mode: WallpaperPreferences['visualizer']['mode'];
  export let samples: number[];
  export let peak: number;
  export let style: string;
  export let gap = 10;
  export let radius = 1;
  export let intensity = 1;
  export let responseGain = 1;
  export let impact = 0;
  export let decorativeLayers = true;

  const radialBarMinSample = 0.03;
  const radialBarThresholdEpsilon = 0.000001;

  $: safeSamples = Array.isArray(samples)
    ? samples.map((sample) => Number.isFinite(sample) ? Math.max(0, sample) : 0)
    : [];
  $: displayPeak = Number.isFinite(peak) ? Math.max(0, peak) : 0;
  $: visualizerRadius = Number.isFinite(radius) ? Math.min(2.2, Math.max(0.6, radius)) : 1;
  $: visualizerIntensity = Number.isFinite(intensity) ? Math.min(2, Math.max(0, intensity)) : 1;
  $: sourceSamples = visualizerIntensity > 0
    ? safeSamples.map((sample) => sample / visualizerIntensity)
    : safeSamples.map(() => 0);
  $: responseSamples = sourceSamples.map((sample) => visualizerResponseSample(sample, responseGain) * visualizerIntensity);
  $: responsePeak = visualizerResponsePeak(displayPeak, visualizerIntensity, responseGain);
  $: radialResponseSamples = sourceSamples.map((sample) => sample + radialBarThresholdEpsilon < radialBarMinSample
    ? 0
    : visualizerResponseSample(sample, responseGain) * visualizerIntensity);
  $: impactLevel = Number.isFinite(impact) ? Math.min(1, Math.max(0, impact)) : 0;
  $: sampleCount = mode === 'radial-bars' ? Math.max(1, safeSamples.length) : 1;
  $: gapFactor = mode === 'radial-bars' ? Math.max(0.2, Math.min(1, 1 - Math.max(0, gap) / 40)) : 1;
  $: barWidth = mode === 'radial-bars'
    ? Math.max(0.6, Math.min(8, (90 / sampleCount) * 0.72 * gapFactor))
    : 0;
  $: waveformPoints = mode === 'waveform-line'
    ? responseSamples
        .map((sample, index) => {
          const x = 5 + (index / Math.max(1, safeSamples.length - 1)) * 90;
          const y = 39 - sample * 25 * visualizerRadius;
          return `${x},${y}`;
        })
        .join(' ')
    : '';
  $: activeBandWidth = mode === 'album-ring' ? responsePeak * 90 : 0;
  $: activeBandHeight = mode === 'album-ring' ? 3 + responsePeak * 14 : 0;
  $: circularWaveformPoints = mode === 'album-ring'
    ? closedPolarSamplePoints(responseSamples, {
        centerX: 50,
        centerY: 50,
        radius: 26,
        amplitude: (12 + impactLevel * 4) * visualizerRadius
      })
    : [];
  $: circularWaveformSvgPoints = circularWaveformPoints.map(({ x, y }) => `${x},${y}`).join(' ');
  $: peakBandBaseline = mode === 'album-ring' ? 98 : 40;
</script>

<div class="visualizer visualizer-bottom" class:visualizer-low-power={!decorativeLayers} aria-hidden="true" style={style}>
  <svg
    class="visualizer-canvas"
    viewBox={mode === 'album-ring' ? '0 0 100 100' : '0 0 100 40'}
    preserveAspectRatio={mode === 'album-ring' ? 'xMidYMid meet' : 'none'}
  >
    {#if mode === 'radial-bars'}
      {#each radialResponseSamples as sample, index}
        {@const height = 3 + sample * 30 * visualizerRadius}
        {@const x = 5 + ((index + 0.5) / sampleCount) * 90 - barWidth / 2}
        {#if decorativeLayers}
          <rect
            class="visualizer-glow bottom-bar-glow"
            class:bottom-bar-hidden={sample <= 0}
            x={x - 1}
            y={38 - height}
            width={barWidth + 2}
            height={height + 4}
          />
        {/if}
        <rect
          class="bottom-bar"
          class:bottom-bar-hidden={sample <= 0}
          x={x}
          y={40 - height}
          width={barWidth}
          height={height}
          style={`opacity: ${0.78 + impactLevel * 0.22}`}
        />
      {/each}
    {:else if mode === 'waveform-line'}
      {#if decorativeLayers}
        <polyline class="visualizer-glow horizontal-waveform-glow" points={waveformPoints} />
      {/if}
      <polyline class="horizontal-waveform" points={waveformPoints} />
    {:else}
      <circle class="bottom-ring-base" cx="50" cy="50" r="26" />
      {#if decorativeLayers}
        <polyline
          class="visualizer-glow bottom-circular-waveform-glow"
          points={circularWaveformSvgPoints}
          style={`opacity: ${0.22 + impactLevel * 0.28}; stroke-width: calc(var(--visualizer-line-width, 2px) + ${2 + impactLevel * 2}px)`}
        />
      {/if}
      <polyline
        class="bottom-circular-waveform"
        points={circularWaveformSvgPoints}
        style={`opacity: ${0.58 + impactLevel * 0.42}`}
      />
      <rect class="peak-band-base" x="5" y={peakBandBaseline - 2} width="90" height="2" rx="1" />
      {#if decorativeLayers}
        <rect
          class="visualizer-glow peak-band-glow"
          x={50 - activeBandWidth / 2}
          y={peakBandBaseline - activeBandHeight - 2}
          width={activeBandWidth}
          height={activeBandHeight + 4}
        />
      {/if}
      <rect
        class="peak-band-active"
        x={50 - activeBandWidth / 2}
        y={peakBandBaseline - activeBandHeight}
        width={activeBandWidth}
        height={activeBandHeight}
        rx="2"
      />
    {/if}
  </svg>
</div>

<style>
  .visualizer { position: absolute; display: grid; width: 100%; height: 100%; place-items: center; overflow: visible; pointer-events: none; color: var(--visualizer-color, #ffffff); opacity: .84; filter: drop-shadow(0 0 calc(18px * var(--visualizer-glow, 0)) var(--visualizer-color, #ffffff)); transition: color 450ms ease, filter 450ms ease; }
  .visualizer-low-power { filter: none; }
  .visualizer-canvas { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .bottom-bar { fill: currentColor; }
  .bottom-bar-glow { fill: currentColor; opacity: .28; filter: blur(1px); }
  .bottom-bar-hidden { display: none; }
  .horizontal-waveform { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: var(--visualizer-line-width, 2px); }
  .horizontal-waveform-glow { stroke-width: calc(var(--visualizer-line-width, 2px) + 4px); opacity: .3; filter: blur(1px); }
  .bottom-ring-base, .bottom-circular-waveform { fill: none; stroke: currentColor; stroke-linejoin: round; }
  .bottom-ring-base { opacity: .2; stroke-width: var(--visualizer-line-width, 2px); }
  .bottom-circular-waveform { stroke-linecap: round; stroke-width: var(--visualizer-line-width, 2px); }
  .bottom-circular-waveform-glow { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; filter: blur(1px); }
  .peak-band-base { fill: currentColor; fill-opacity: .22; }
  .peak-band-glow { fill: currentColor; opacity: .3; filter: blur(1px); }
  .peak-band-active { fill: currentColor; fill-opacity: .88; }
</style>
