import type { VisualizerFrame, VisualizerMotionState } from '@spotify-wallpaper/shared-types';

const ALBUM_MAX_SCALE = 0.18;
const ALBUM_MAX_OFFSET_PX = 8;
const PARTICLE_MAX_BRIGHTNESS = 1.6;
const MOTION_RELEASE_MS = 450;

export const neutralVisualizerMotion = (): VisualizerMotionState => ({
  impactLevel: 0,
  stretchLevel: 0,
  albumScale: 1,
  albumOffsetX: 0,
  albumOffsetY: 0,
  particleSpeedMultiplier: 1,
  particleBrightnessMultiplier: 1
});

export const calculateVisualizerMotion = (frame: VisualizerFrame | null): VisualizerMotionState => {
  if (!frame || frame.source === 'idle' || frame.source === 'disabled') {
    return neutralVisualizerMotion();
  }

  const impactLevel = clamp(
    safeSignal(frame.peak) * 0.45
      + safeSignal(frame.bass) * 0.3
      + safeSignal(frame.mid) * 0.15
      + safeSignal(frame.treble) * 0.1,
    0,
    1
  );
  const stretchLevel = impactLevel;
  const offsetMagnitude = clamp(safeSignal(frame.bass), 0, 1) * ALBUM_MAX_OFFSET_PX;
  const offsetAngle = spectralDirection(frame.samples);
  const albumOffsetX = offsetMagnitude === 0 ? 0 : Math.cos(offsetAngle) * offsetMagnitude;
  const albumOffsetY = offsetMagnitude === 0 ? 0 : Math.sin(offsetAngle) * offsetMagnitude;

  return {
    impactLevel,
    stretchLevel,
    albumScale: 1 + stretchLevel * ALBUM_MAX_SCALE,
    albumOffsetX,
    albumOffsetY,
    particleSpeedMultiplier: 1 + stretchLevel,
    particleBrightnessMultiplier: 1 + stretchLevel * (PARTICLE_MAX_BRIGHTNESS - 1)
  };
};

export const releaseVisualizerMotion = (
  source: VisualizerMotionState,
  target: VisualizerMotionState,
  elapsedMs: number
): VisualizerMotionState => {
  const progress = clamp(elapsedMs / MOTION_RELEASE_MS, 0, 1);
  if (progress >= 1 || motionEnergy(target) >= motionEnergy(source)) {
    return target;
  }

  return {
    impactLevel: releaseValue(source.impactLevel, target.impactLevel, progress),
    stretchLevel: releaseValue(source.stretchLevel, target.stretchLevel, progress),
    albumScale: releaseValue(source.albumScale, target.albumScale, progress),
    albumOffsetX: releaseValue(source.albumOffsetX, target.albumOffsetX, progress),
    albumOffsetY: releaseValue(source.albumOffsetY, target.albumOffsetY, progress),
    particleSpeedMultiplier: releaseValue(source.particleSpeedMultiplier, target.particleSpeedMultiplier, progress),
    particleBrightnessMultiplier: releaseValue(source.particleBrightnessMultiplier, target.particleBrightnessMultiplier, progress)
  };
};

const safeSignal = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const releaseValue = (source: number, target: number, progress: number): number =>
  target >= source ? target : source + (target - source) * progress;

const motionEnergy = (motion: VisualizerMotionState): number =>
  Math.max(
    motion.stretchLevel,
    Math.hypot(motion.albumOffsetX, motion.albumOffsetY) / ALBUM_MAX_OFFSET_PX
  );

const spectralDirection = (samples: number[]): number => {
  if (!Array.isArray(samples) || samples.length === 0) return -Math.PI / 2;
  const denominator = Math.max(1, samples.length - 1);
  let total = 0;
  let weightedPosition = 0;
  samples.forEach((sample, index) => {
    const value = safeSignal(sample);
    total += value;
    weightedPosition += value * (index / denominator);
  });
  if (total === 0) return -Math.PI / 2;
  return -Math.PI / 2 + (weightedPosition / total) * Math.PI * 2;
};
