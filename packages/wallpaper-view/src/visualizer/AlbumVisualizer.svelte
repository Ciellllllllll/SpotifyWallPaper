<script lang="ts">
  import type { WallpaperPreferences } from '@spotify-wallpaper/shared-types';
  import { closedPolarSamplePoints, polarSamplePoints, radialBarRectangles } from '../visualizerGeometry';
  import { visualizerResponsePeak, visualizerResponseSample } from '../visualizerStyle';

  export let mode: WallpaperPreferences['visualizer']['mode'];
  export let samples: number[];
  export let peak: number;
  export let style: string;
  export let radius = 1;
  export let rotation = 0;
  export let intensity = 1;
  export let responseGain = 1;
  export let impact = 0;
  export let decorativeLayers = true;

  const circularBaseRadius = 50;
  const radialBarSide = 2;
  const radialBarMinSample = 0.03;
  const radialBarThresholdEpsilon = 0.000001;

  $: safeSamples = Array.isArray(samples)
    ? samples.map((sample) => Number.isFinite(sample) ? Math.max(0, sample) : 0)
    : [];
  $: displayPeak = Number.isFinite(peak) ? Math.max(0, peak) : 0;
  $: visualizerRadius = Number.isFinite(radius) ? Math.min(2.2, Math.max(0.6, radius)) : 1;
  $: counterRotation = Number.isFinite(rotation) ? -rotation : 0;
  $: visualizerIntensity = Number.isFinite(intensity) ? Math.min(2, Math.max(0, intensity)) : 1;
  $: sourceSamples = visualizerIntensity > 0
    ? safeSamples.map((sample) => sample / visualizerIntensity)
    : safeSamples.map(() => 0);
  $: responseSamples = sourceSamples.map((sample) => visualizerResponseSample(sample, responseGain) * visualizerIntensity);
  $: radialResponseSamples = sourceSamples.map((sample) => sample + radialBarThresholdEpsilon < radialBarMinSample
    ? 0
    : visualizerResponseSample(sample, responseGain) * visualizerIntensity);
  $: impactLevel = Number.isFinite(impact) ? Math.min(1, Math.max(0, impact)) : 0;
  $: responsePeak = visualizerResponsePeak(displayPeak, visualizerIntensity, responseGain);
  $: responsePeakLevel = Math.min(1, responsePeak);
  $: radialBarPolygons = mode === 'radial-bars'
    ? radialBarRectangles(radialResponseSamples, {
        centerX: 50,
        centerY: 50,
        radius: circularBaseRadius,
        amplitude: 18 * visualizerRadius,
        side: radialBarSide,
        minSample: visualizerIntensity > 0 ? radialBarMinSample * visualizerIntensity : Number.MAX_VALUE
      })
    : [];
  $: waveformPoints = mode === 'waveform-line'
    ? polarSamplePoints(responseSamples, {
        centerX: 50,
        centerY: 50,
        radius: circularBaseRadius,
        amplitude: 13 * visualizerRadius
      })
    : [];
  $: albumRingWaveformPoints = mode === 'album-ring'
    ? closedPolarSamplePoints(responseSamples, {
        centerX: 50,
        centerY: 50,
        radius: circularBaseRadius,
        amplitude: (16 + impactLevel * 6) * visualizerRadius
      })
    : [];
  $: radialBarSvgPoints = radialBarPolygons
    .map((points) => points.map(({ x, y }) => `${x},${y}`).join(' '));
  $: waveformSvgPoints = waveformPoints.map(({ x, y }) => `${x},${y}`).join(' ');
  $: albumRingWaveformSvgPoints = albumRingWaveformPoints.map(({ x, y }) => `${x},${y}`).join(' ');
  $: ringDash = mode === 'album-ring'
    ? `${responsePeakLevel > 0 ? responsePeakLevel : 0} ${Math.max(0, 1 - responsePeakLevel)}`
    : '0 1';
</script>

<div class="visualizer visualizer-album" class:visualizer-low-power={!decorativeLayers} aria-hidden="true" style={style}>
  <svg class="visualizer-canvas" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={`transform: rotate(${counterRotation}deg)`}>
    {#if mode === 'radial-bars'}
      {#if decorativeLayers}
        {#each radialBarSvgPoints as points, index (index)}
          <polygon class="visualizer-glow radial-bar-glow" class:radial-bar-hidden={points.length === 0} points={points} />
        {/each}
      {/if}
      {#each radialBarSvgPoints as points, index (index)}
        <polygon
          class="radial-bar"
          class:radial-bar-hidden={points.length === 0}
          points={points}
          style={`opacity: ${0.78 + impactLevel * 0.22}`}
        />
      {/each}
    {:else if mode === 'waveform-line'}
      {#if decorativeLayers}
        <polyline class="visualizer-glow circular-waveform-glow" points={waveformSvgPoints} />
      {/if}
      <polyline class="circular-waveform" points={waveformSvgPoints} />
    {:else}
      <circle class="ring-base" cx="50" cy="50" r={circularBaseRadius} pathLength="1" />
      {#if decorativeLayers}
        <circle
          class="visualizer-glow ring-impact"
          cx="50"
          cy="50"
          r={circularBaseRadius}
          pathLength="1"
          stroke-dasharray={ringDash}
          style={`opacity: ${impactLevel * 0.45}; stroke-width: calc(var(--visualizer-line-width, 2px) + ${responsePeak * 2 + impactLevel * 6}px)`}
        />
      {/if}
      {#if decorativeLayers}
        <polyline
          class="visualizer-glow album-ring-waveform-glow"
          points={albumRingWaveformSvgPoints}
          style={`opacity: ${0.24 + impactLevel * 0.3}; stroke-width: calc(var(--visualizer-line-width, 2px) + ${2 + impactLevel * 3}px)`}
        />
      {/if}
      <polyline
        class="album-ring-waveform"
        points={albumRingWaveformSvgPoints}
        style={`opacity: ${0.64 + impactLevel * 0.36}`}
      />
      <circle
        class="ring-active"
        cx="50"
        cy="50"
        r={circularBaseRadius}
        pathLength="1"
        stroke-dasharray={ringDash}
        style={`opacity: ${responsePeakLevel > 0 ? 0.3 + responsePeakLevel * 0.7 : 0}; stroke-width: calc(var(--visualizer-line-width, 2px) + ${responsePeak * 4 + impactLevel * 2}px)`}
      />
    {/if}
  </svg>
</div>

<style>
  .visualizer { position: absolute; inset: 0; display: grid; width: 100%; height: 100%; place-items: center; overflow: visible; pointer-events: none; color: var(--visualizer-color, #ffffff); opacity: .84; filter: drop-shadow(0 0 calc(18px * var(--visualizer-glow, 0)) var(--visualizer-color, #ffffff)); transition: color 450ms ease, filter 450ms ease; }
  .visualizer-low-power { filter: none; }
  .visualizer-album { z-index: 0; border-radius: 50%; }
  .visualizer-canvas { position: absolute; inset: 0; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: visible; transform-origin: center; }
  .ring-base, .ring-active { fill: none; stroke: currentColor; stroke-linecap: round; }
  .ring-base { opacity: .2; stroke-width: var(--visualizer-line-width, 2px); }
  .ring-active { stroke-linecap: round; }
  .radial-bar { fill: currentColor; stroke: none; }
  .radial-bar-glow { fill: currentColor; opacity: .28; filter: blur(1px); }
  .radial-bar-hidden { display: none; }
  .circular-waveform, .album-ring-waveform { fill: none; stroke: currentColor; stroke-linejoin: round; stroke-width: var(--visualizer-line-width, 2px); }
  .circular-waveform-glow, .album-ring-waveform-glow { fill: none; stroke: currentColor; stroke-linejoin: round; stroke-width: calc(var(--visualizer-line-width, 2px) + 4px); opacity: .3; filter: blur(1px); }
  .ring-impact { fill: none; stroke: currentColor; stroke-linecap: round; }
</style>
