import { describe, expect, it } from 'vitest';
import {
  advanceGlowingParticles,
  clampParticleBrightness,
  spawnGlowingParticle,
  type GlowingParticle,
  type ParticleViewport
} from './particleModel';

const viewport: ParticleViewport = { width: 100, height: 80 };

describe('glowing particle model', () => {
  it('spawns inside a small central region and points outward', () => {
    const particle = spawnGlowingParticle(() => 0.5, viewport, { lifeMs: 1000, speedPxPerSecond: 100 });
    const centerX = viewport.width / 2;
    const centerY = viewport.height / 2;
    const dot = (particle.x - centerX) * particle.vx + (particle.y - centerY) * particle.vy;

    expect(Math.hypot(particle.x - centerX, particle.y - centerY)).toBeLessThanOrEqual(4);
    expect(dot).toBeGreaterThan(0);
    expect(particle.ageMs).toBe(0);
    expect(particle.lifeMs).toBe(1000);
  });

  it('advances outward at the requested multiplier and keeps a trail origin', () => {
    const particle = spawnGlowingParticle(() => 0.5, viewport, { lifeMs: 1000, speedPxPerSecond: 100 });
    const advanced = advanceGlowingParticles([particle], viewport, 100, 2);

    expect(advanced).toHaveLength(1);
    expect(advanced[0].x - particle.x).toBeCloseTo(particle.vx * 0.2, 5);
    expect(advanced[0].y - particle.y).toBeCloseTo(particle.vy * 0.2, 5);
    expect(advanced[0].previousX).toBe(particle.x);
    expect(advanced[0].previousY).toBe(particle.y);
    expect(advanced[0].ageMs).toBe(100);

    const capped = advanceGlowingParticles([particle], viewport, 100, 3);
    expect(capped[0].x).toBeCloseTo(advanced[0].x, 5);
    expect(capped[0].y).toBeCloseTo(advanced[0].y, 5);
  });

  it('keeps synchronized brightness in a bounded visual range', () => {
    expect(clampParticleBrightness(1.3)).toBe(1.3);
    expect(clampParticleBrightness(0)).toBe(1);
    expect(clampParticleBrightness(4)).toBe(1.6);
    expect(clampParticleBrightness(Number.NaN)).toBe(1);
  });

  it('removes particles after their life or after leaving the viewport', () => {
    const expired = spawnGlowingParticle(() => 0.5, viewport, { lifeMs: 100, speedPxPerSecond: 1 });
    const outside: GlowingParticle = {
      ...expired,
      x: 120,
      previousX: 119,
      y: 40,
      previousY: 40,
      ageMs: 0
    };

    expect(advanceGlowingParticles([expired], viewport, 100, 1)).toEqual([]);
    expect(advanceGlowingParticles([outside], viewport, 16, 1)).toEqual([]);
  });

  it('clamps invalid time and speed values without producing non-finite particles', () => {
    const particle = spawnGlowingParticle(() => Number.NaN, viewport, { lifeMs: Number.NaN, speedPxPerSecond: Number.NaN });
    const advanced = advanceGlowingParticles([particle], viewport, Number.NaN, Number.POSITIVE_INFINITY);

    expect(particle.lifeMs).toBeGreaterThan(0);
    expect(advanced.every((item) => Object.values(item).every((value) => Number.isFinite(value)))).toBe(true);
  });
});
