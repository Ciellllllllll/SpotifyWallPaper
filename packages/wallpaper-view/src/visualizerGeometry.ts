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
