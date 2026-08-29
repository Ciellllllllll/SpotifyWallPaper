<script lang="ts">
  import { onMount } from 'svelte';
  import {
    PARTICLE_SPEED_TRANSITION_MS,
    advanceGlowingParticles,
    interpolateParticleSpeedMultiplier,
    spawnGlowingParticle,
    type GlowingParticle,
    type ParticleViewport
  } from './particleModel';

  export let enabled = true;
  export let particleCount = 48;
  export let particleLifeMs = 3500;
  export let pixelRatio = 1.5;
  export let glow = true;
  export let glowStrength = 1;
  export let color = '#ffffff';
  export let speedMultiplier = 1;
  export let randomSeed = 0x6d2b79f5;

  let canvas: HTMLCanvasElement;
  let context: CanvasRenderingContext2D | null = null;
  let viewport: ParticleViewport = { width: 1, height: 1 };
  let devicePixelRatio = 1;
  let particles: GlowingParticle[] = [];
  let activeParticleCount = 0;
  let frameHandle: number | null = null;
  let lastFrameMs: number | null = null;
  let drawAccumulatorMs = 0;
  let nextSpawnAtMs = 0;
  let smoothedSpeedMultiplier = 1;
  let speedTransitionFrom = 1;
  let speedTransitionTo = 1;
  let speedTransitionElapsedMs = PARTICLE_SPEED_TRANSITION_MS;
  let seededRandom: () => number = () => 0.5;
  let resizeObserver: ResizeObserver | null = null;
  let mounted = false;
  let lastPixelRatio: number | null = null;

  $: if (mounted) {
    if (enabled) {
      startLoop();
    } else {
      stopLoop();
    }
  }

  $: if (mounted && pixelRatio !== lastPixelRatio) {
    lastPixelRatio = pixelRatio;
    resizeCanvas();
  }

  onMount(() => {
    context = canvas.getContext('2d');
    seededRandom = createSeededRandom(randomSeed);
    resizeCanvas();
    lastPixelRatio = pixelRatio;
    window.addEventListener('resize', resizeCanvas, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(canvas.parentElement ?? canvas);
    }
    mounted = true;

    return () => {
      mounted = false;
      stopLoop();
      resizeObserver?.disconnect();
      resizeObserver = null;
      window.removeEventListener('resize', resizeCanvas);
    };
  });

  const startLoop = () => {
    if (frameHandle !== null || !enabled || !context) return;
    lastFrameMs = null;
    const tick = (nowMs: number) => {
      frameHandle = null;
      if (!enabled || !context) {
        stopLoop();
        return;
      }

      const deltaMs = lastFrameMs === null ? 16.67 : Math.max(0, Math.min(1000, nowMs - lastFrameMs));
      lastFrameMs = nowMs;
      drawAccumulatorMs += deltaMs;
      const drawIntervalMs = pixelRatio <= 1 ? 33.34 : 16.67;
      if (drawAccumulatorMs >= drawIntervalMs) {
        const drawDeltaMs = drawAccumulatorMs;
        drawAccumulatorMs = 0;
        renderFrame(nowMs, drawDeltaMs);
      }
      frameHandle = window.requestAnimationFrame(tick);
    };
    frameHandle = window.requestAnimationFrame(tick);
  };

  const stopLoop = () => {
    if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
    frameHandle = null;
    lastFrameMs = null;
    drawAccumulatorMs = 0;
    nextSpawnAtMs = 0;
    smoothedSpeedMultiplier = 1;
    speedTransitionFrom = 1;
    speedTransitionTo = 1;
    speedTransitionElapsedMs = PARTICLE_SPEED_TRANSITION_MS;
    particles = [];
    setActiveParticleCount(0);
    clearCanvas();
  };

  const resizeCanvas = () => {
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    const width = safeDimension(rect.width || canvas.parentElement?.clientWidth || window.innerWidth);
    const height = safeDimension(rect.height || canvas.parentElement?.clientHeight || window.innerHeight);
    const requestedRatio = clamp(Number.isFinite(pixelRatio) ? pixelRatio : 1, 1, 2);
    devicePixelRatio = requestedRatio;
    viewport = { width, height };
    canvas.width = Math.max(1, Math.round(width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(height * devicePixelRatio));
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    clearCanvas();
  };

  const renderFrame = (nowMs: number, deltaMs: number) => {
    if (!context) return;
    const targetSpeed = clamp(Number.isFinite(speedMultiplier) ? speedMultiplier : 1, 1, 2);
    if (targetSpeed !== speedTransitionTo) {
      speedTransitionFrom = smoothedSpeedMultiplier;
      speedTransitionTo = targetSpeed;
      speedTransitionElapsedMs = 0;
    }
    speedTransitionElapsedMs = Math.min(PARTICLE_SPEED_TRANSITION_MS, speedTransitionElapsedMs + deltaMs);
    smoothedSpeedMultiplier = interpolateParticleSpeedMultiplier(
      speedTransitionFrom,
      speedTransitionTo,
      speedTransitionElapsedMs
    );
    const requestedCount = safeParticleCount(particleCount);
    particles = advanceGlowingParticles(particles, viewport, deltaMs, smoothedSpeedMultiplier);
    if (particles.length > requestedCount) {
      particles = requestedCount > 0 ? particles.slice(-requestedCount) : [];
    }

    if (requestedCount > 0 && particles.length < requestedCount && nowMs >= nextSpawnAtMs) {
      particles = [
        ...particles,
        spawnGlowingParticle(seededRandom, viewport, {
          lifeMs: particleLifeMs
        })
      ];
      const intervalMs = Math.max(16, safeLife(particleLifeMs) / requestedCount);
      nextSpawnAtMs = nowMs + intervalMs * (0.65 + seededRandom() * 0.7);
    }
    setActiveParticleCount(particles.length);
    drawParticles();
  };

  const drawParticles = () => {
    if (!context) return;
    clearCanvas();
    const rgb = parseColor(color);
    const safeGlowStrength = clamp(Number.isFinite(glowStrength) ? glowStrength : 1, 0, 2);
    context.globalCompositeOperation = 'lighter';
    for (const particle of particles) {
      const lifeProgress = clamp(particle.ageMs / particle.lifeMs, 0, 1);
      const alpha = particle.opacity * (1 - lifeProgress);
      if (alpha <= 0) continue;
      context.beginPath();
      context.moveTo(particle.previousX, particle.previousY);
      context.lineTo(particle.x, particle.y);
      context.lineWidth = Math.max(0.6, particle.size * 0.55);
      context.lineCap = 'round';
      context.strokeStyle = rgba(rgb, alpha * 0.42);
      context.stroke();

      context.beginPath();
      context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      context.shadowBlur = glow ? particle.size * 5 * safeGlowStrength : 0;
      context.shadowColor = rgba(rgb, alpha * Math.min(1, safeGlowStrength));
      context.fillStyle = rgba(rgb, alpha);
      context.fill();
    }
    context.shadowBlur = 0;
    context.globalCompositeOperation = 'source-over';
  };

  const clearCanvas = () => {
    if (!context || !canvas) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  };

  const setActiveParticleCount = (count: number) => {
    if (activeParticleCount !== count) activeParticleCount = count;
  };

  const safeParticleCount = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const safeLife = (value: number): number => Number.isFinite(value) && value > 0 ? Math.min(10_000, value) : 3500;
  const safeDimension = (value: number): number => Number.isFinite(value) && value > 0 ? value : 1;
  const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

  const createSeededRandom = (seed: number): (() => number) => {
    let state = (Number.isFinite(seed) ? seed : 0x6d2b79f5) >>> 0;
    if (state === 0) state = 0x6d2b79f5;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
  };

  const parseColor = (value: string): { r: number; g: number; b: number } => {
    const match = /^#([0-9a-f]{6})$/i.exec(value);
    if (!match) return { r: 255, g: 255, b: 255 };
    return {
      r: Number.parseInt(match[1].slice(0, 2), 16),
      g: Number.parseInt(match[1].slice(2, 4), 16),
      b: Number.parseInt(match[1].slice(4, 6), 16)
    };
  };

  const rgba = ({ r, g, b }: { r: number; g: number; b: number }, alpha: number): string =>
    `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
</script>

<div
  class="glowing-object-layer"
  aria-hidden="true"
  data-enabled={enabled}
  data-particle-count={particleCount}
  data-active-particles={activeParticleCount}
  data-speed-multiplier={speedMultiplier}
  data-pixel-ratio={pixelRatio}
  data-glow={glow}
  data-glow-strength={glowStrength}
>
  <canvas
    bind:this={canvas}
    class="glowing-object-canvas"
    aria-hidden="true"
    data-enabled={enabled}
    data-particle-count={particleCount}
    data-active-particles={activeParticleCount}
    data-speed-multiplier={speedMultiplier}
    data-pixel-ratio={pixelRatio}
    data-glow={glow}
    data-glow-strength={glowStrength}
  ></canvas>
</div>

<style>
  .glowing-object-layer { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
  .glowing-object-canvas { display: block; width: 100%; height: 100%; pointer-events: none; }
</style>
