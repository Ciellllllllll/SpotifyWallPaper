export interface ParticleViewport {
  width: number;
  height: number;
}

export interface GlowingParticle {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  vx: number;
  vy: number;
  angle: number;
  ageMs: number;
  lifeMs: number;
  size: number;
  opacity: number;
}

export interface GlowingParticleSpawnOptions {
  lifeMs: number;
  speedPxPerSecond?: number;
  originRadius?: number;
}

const DEFAULT_PARTICLE_LIFE_MS = 3500;
const MAX_PARTICLE_LIFE_MS = 10_000;
const MAX_FRAME_DELTA_MS = 1000;
export const PARTICLE_SPEED_TRANSITION_MS = 450;
const MIN_PARTICLE_SIZE = 1.5;
const MAX_PARTICLE_SIZE = 4;

export const spawnGlowingParticle = (
  random: () => number,
  viewport: ParticleViewport,
  options: GlowingParticleSpawnOptions
): GlowingParticle => {
  const width = safeDimension(viewport.width);
  const height = safeDimension(viewport.height);
  const centerX = width / 2;
  const centerY = height / 2;
  const originRadius = Number.isFinite(options.originRadius) && (options.originRadius ?? 0) > 0
    ? options.originRadius as number
    : Math.min(width, height) * 0.05;
  const angle = safeRandom(random) * Math.PI * 2;
  const distance = Math.sqrt(safeRandom(random)) * originRadius;
  const x = centerX + Math.cos(angle) * distance;
  const y = centerY + Math.sin(angle) * distance;
  const lifeMs = safeLife(options.lifeMs);
  const defaultSpeed = Math.hypot(width, height) * 0.8 / (lifeMs / 1000);
  const speed = Number.isFinite(options.speedPxPerSecond) && (options.speedPxPerSecond ?? 0) > 0
    ? options.speedPxPerSecond as number
    : defaultSpeed * (0.8 + safeRandom(random) * 0.4);

  return {
    x,
    y,
    previousX: x,
    previousY: y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    angle,
    ageMs: 0,
    lifeMs,
    size: MIN_PARTICLE_SIZE + safeRandom(random) * (MAX_PARTICLE_SIZE - MIN_PARTICLE_SIZE),
    opacity: 0.35 + safeRandom(random) * 0.5
  };
};

export const advanceGlowingParticles = (
  particles: readonly GlowingParticle[],
  viewport: ParticleViewport,
  deltaMs: number,
  speedMultiplier: number
): GlowingParticle[] => {
  const delta = Number.isFinite(deltaMs) ? Math.min(MAX_FRAME_DELTA_MS, Math.max(0, deltaMs)) : 0;
  const multiplier = Number.isFinite(speedMultiplier) ? Math.min(2, Math.max(1, speedMultiplier)) : 1;
  const width = safeDimension(viewport.width);
  const height = safeDimension(viewport.height);

  return particles.flatMap((particle) => {
    if (!isFiniteParticle(particle)) return [];
    const seconds = delta / 1000;
    const next: GlowingParticle = {
      ...particle,
      previousX: particle.x,
      previousY: particle.y,
      x: particle.x + particle.vx * seconds * multiplier,
      y: particle.y + particle.vy * seconds * multiplier,
      ageMs: particle.ageMs + delta
    };
    return next.ageMs < next.lifeMs && isInsideViewport(next, width, height) ? [next] : [];
  });
};

export const interpolateParticleSpeedMultiplier = (
  from: number,
  to: number,
  elapsedMs: number,
  durationMs = PARTICLE_SPEED_TRANSITION_MS
): number => {
  const safeFrom = finiteSpeed(from);
  const safeTo = finiteSpeed(to);
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : PARTICLE_SPEED_TRANSITION_MS;
  const progress = Number.isFinite(elapsedMs) ? Math.min(1, Math.max(0, elapsedMs / duration)) : 0;
  return safeFrom + (safeTo - safeFrom) * progress;
};

const safeDimension = (value: number): number => Number.isFinite(value) && value > 0 ? value : 1;

const safeLife = (value: number): number => Number.isFinite(value) && value > 0
  ? Math.min(MAX_PARTICLE_LIFE_MS, value)
  : DEFAULT_PARTICLE_LIFE_MS;

const safeRandom = (random: () => number): number => {
  try {
    const value = random();
    if (!Number.isFinite(value)) return 0.5;
    return value - Math.floor(value);
  } catch {
    return 0.5;
  }
};

const finiteSpeed = (value: number): number => Number.isFinite(value) ? Math.min(2, Math.max(1, value)) : 1;

const isInsideViewport = (particle: GlowingParticle, width: number, height: number): boolean =>
  particle.x >= -particle.size
  && particle.x <= width + particle.size
  && particle.y >= -particle.size
  && particle.y <= height + particle.size;

const isFiniteParticle = (particle: GlowingParticle): boolean =>
  Object.values(particle).every((value) => Number.isFinite(value));
