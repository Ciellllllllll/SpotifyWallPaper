<script lang="ts">
  import type { WallpaperPreferences } from '@spotify-wallpaper/shared-types';
  import { closedPolarSamplePoints, visualizerAudioAmplitude } from '../visualizerGeometry';
  import { visualizerResponseSample } from '../visualizerStyle';

  export let mode: WallpaperPreferences['visualizer']['mode'];
  export let samples: number[];
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
  $: visualizerRadius = Number.isFinite(radius) ? Math.min(2.2, Math.max(0.6, radius)) : 1;
  $: visualizerIntensity = Number.isFinite(intensity) ? Math.min(6, Math.max(0, intensity)) : 1;
  $: sourceSamples = visualizerIntensity > 0
    ? safeSamples.map((sample) => sample / visualizerIntensity)
    : safeSamples.map(() => 0);
  $: responseSamples = sourceSamples.map((sample) => visualizerResponseSample(sample, responseGain) * visualizerIntensity);
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
          const y = 39 - sample * visualizerAudioAmplitude(25, visualizerRadius);
          return `${x},${y}`;
        })
        .join(' ')
    : '';
  $: circularWaveformPoints = mode === 'album-ring'
    ? closedPolarSamplePoints(responseSamples, {
        centerX: 50,
        centerY: 50,
        radius: 26,
        amplitude: visualizerAudioAmplitude(12 + impactLevel * 4, visualizerRadius)
      })
    : [];
  $: circularWaveformSvgPoints = circularWaveformPoints.map(({ x, y }) => `${x},${y}`).join(' ');
</script>

<div class="visualizer visualizer-bottom" class:visualizer-low-power={!decorativeLayers} aria-hidden="true" style={style}>
  <svg
    class="visualizer-canvas"
    viewBox={mode === 'album-ring' ? '0 0 100 100' : '0 0 100 40'}
    preserveAspectRatio={mode === 'album-ring' ? 'xMidYMid meet' : 'none'}
  >
    {#if mode === 'radial-bars'}
      {#each radialResponseSamples as sample, index}
        {@const height = 3 + sample * visualizerAudioAmplitude(30, visualizerRadius)}
        {@const x = 5 + ((index + 0.5) / sampleCount) * 90 - barWidth / 2}
        {#if decorativeLayers}
          <rect
            class="visualizer-glow bottom-bar-glow"
            class:bottom-bar-hidden={sample <= 0}
            x={x - 1}
            y={36 - height}
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
    {/if}
  </svg>
</div>

<style>
  .visualizer { position: absolute; display: grid; width: 100%; height: 100%; place-items: center; overflow: visible; pointer-events: none; color: var(--visualizer-color, #ffffff); opacity: .84; filter: drop-shadow(0 0 calc(18px * var(--visualizer-glow, 0)) var(--visualizer-color, #ffffff)); transition: color 450ms ease, filter 450ms ease; }
  .visualizer-low-power { filter: none; transition: color 450ms ease; }
  .visualizer-canvas { position: absolute; inset: 0; width: 100%; height: 100%; overflow: hidden; }
  .bottom-bar { fill: currentColor; }
  .bottom-bar-glow { fill: currentColor; opacity: .28; filter: blur(1px); }
  .bottom-bar-hidden { display: none; }
  .horizontal-waveform { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: var(--visualizer-line-width, 2px); }
  .horizontal-waveform-glow { stroke-width: calc(var(--visualizer-line-width, 2px) + 4px); opacity: .3; filter: blur(1px); }
  .bottom-ring-base, .bottom-circular-waveform { fill: none; stroke: currentColor; stroke-linejoin: round; }
  .bottom-ring-base { opacity: .2; stroke-width: var(--visualizer-line-width, 2px); }
  .bottom-circular-waveform { stroke-linecap: round; stroke-width: var(--visualizer-line-width, 2px); }
  .bottom-circular-waveform-glow { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; filter: blur(1px); }
</style>
