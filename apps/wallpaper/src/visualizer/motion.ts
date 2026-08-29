import type { VisualizerFrame, VisualizerMotionState } from '@spotify-wallpaper/shared-types';

const IMPACT_THRESHOLD = 0.4;
const ALBUM_MAX_SCALE = 0.12;

export const neutralVisualizerMotion = (): VisualizerMotionState => ({
  impactLevel: 0,
  stretchLevel: 0,
  albumScale: 1,
  particleSpeedMultiplier: 1
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
  const stretchLevel = clamp(
    (impactLevel - IMPACT_THRESHOLD) / (1 - IMPACT_THRESHOLD),
    0,
    1
  );

  return {
    impactLevel,
    stretchLevel,
    albumScale: 1 + stretchLevel * ALBUM_MAX_SCALE,
    particleSpeedMultiplier: 1 + stretchLevel
  };
};

const safeSignal = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
