export interface PolarPoint {
  x: number;
  y: number;
}

export interface PolarSampleLayout {
  centerX: number;
  centerY: number;
  radius: number;
  amplitude: number;
}

export interface RadialBarLayout extends PolarSampleLayout {
  side: number;
  minSample: number;
}

export const visualizerAudioAmplitude = (baseAmplitude: number, radius: number): number => {
  const safeBaseAmplitude = Number.isFinite(baseAmplitude) ? Math.max(0, baseAmplitude) : 0;
  const safeRadius = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  return safeBaseAmplitude * 3 * safeRadius;
};

export const polarPoint = (centerX: number, centerY: number, radius: number, angleRadians: number): PolarPoint => ({
  x: centerX + Math.cos(angleRadians) * radius,
  y: centerY + Math.sin(angleRadians) * radius
});

export const polarSamplePoints = (samples: readonly number[], layout: PolarSampleLayout): PolarPoint[] => {
  if (samples.length === 0) {
    return [];
  }

  const centerX = Number.isFinite(layout.centerX) ? layout.centerX : 0;
  const centerY = Number.isFinite(layout.centerY) ? layout.centerY : 0;
  const radius = Number.isFinite(layout.radius) ? Math.max(0, layout.radius) : 0;
  const amplitude = Number.isFinite(layout.amplitude) ? Math.max(0, layout.amplitude) : 0;

  return samples.map((sample, index) => {
    const value = Number.isFinite(sample) ? Math.max(0, sample) : 0;
    const angle = -Math.PI / 2 + (index / samples.length) * Math.PI * 2;
    return polarPoint(centerX, centerY, radius + value * amplitude, angle);
  });
};

/**
 * Gives the lower-frequency side of the spectrum a small, deterministic lift.
 * The input order is preserved so the waveform still reflects the source data.
 */
export const lowFrequencyWeightedSamples = (samples: readonly number[], boost = 0.35): number[] => {
  const safeBoost = Number.isFinite(boost) ? Math.max(0, boost) : 0;
  const denominator = Math.max(1, samples.length - 1);

  return samples.map((sample, index) => {
    const value = Number.isFinite(sample) ? Math.max(0, sample) : 0;
    const lowFrequencyFactor = 1 - index / denominator;
    return value * (1 + lowFrequencyFactor * safeBoost);
  });
};

export const closedPolarSamplePoints = (samples: readonly number[], layout: PolarSampleLayout, boost = 0.35): PolarPoint[] => {
  const points = polarSamplePoints(lowFrequencyWeightedSamples(samples, boost), layout);
  return points.length > 0 ? [...points, points[0]] : [];
};

export const radialBarRectangles = (samples: readonly number[], layout: RadialBarLayout): PolarPoint[][] => {
  if (samples.length === 0) {
    return [];
  }

  const centerX = Number.isFinite(layout.centerX) ? layout.centerX : 0;
  const centerY = Number.isFinite(layout.centerY) ? layout.centerY : 0;
  const radius = Number.isFinite(layout.radius) ? Math.max(0, layout.radius) : 0;
  const amplitude = Number.isFinite(layout.amplitude) ? Math.max(0, layout.amplitude) : 0;
  const side = Number.isFinite(layout.side) ? Math.max(0, layout.side) : 0;
  const minSample = Number.isFinite(layout.minSample) ? Math.max(0, layout.minSample) : 0;

  return samples.map((sample, index) => {
    const value = Number.isFinite(sample) ? Math.max(0, sample) : 0;
    if (value < minSample) {
      return [];
    }

    const angle = -Math.PI / 2 + (index / samples.length) * Math.PI * 2;
    const normalX = Math.cos(angle);
    const normalY = Math.sin(angle);
    const tangentX = -normalY * side / 2;
    const tangentY = normalX * side / 2;
    const inner = polarPoint(centerX, centerY, radius, angle);
    const outer = polarPoint(centerX, centerY, radius + side + value * amplitude, angle);

    return [
      { x: inner.x - tangentX, y: inner.y - tangentY },
      { x: outer.x - tangentX, y: outer.y - tangentY },
      { x: outer.x + tangentX, y: outer.y + tangentY },
      { x: inner.x + tangentX, y: inner.y + tangentY }
    ];
  });
};
