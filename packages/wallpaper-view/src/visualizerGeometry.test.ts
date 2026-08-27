import { describe, expect, it } from 'vitest';
import { polarPoint, polarSamplePoints } from './visualizerGeometry';

describe('visualizer geometry', () => {
  it('places a point at the requested angle around the center', () => {
    expect(polarPoint(50, 40, 10, 0)).toEqual({ x: 60, y: 40 });

    const top = polarPoint(50, 40, 10, -Math.PI / 2);
    expect(top.x).toBeCloseTo(50);
    expect(top.y).toBeCloseTo(30);
  });

  it('maps samples clockwise from the top and uses each sample as radial amplitude', () => {
    const points = polarSamplePoints([0, 0.5, 1, 0.5], {
      centerX: 50,
      centerY: 50,
      radius: 20,
      amplitude: 20
    });

    expect(points).toHaveLength(4);
    expect(points[0].x).toBeCloseTo(50);
    expect(points[0].y).toBeCloseTo(30);
    expect(Math.hypot(points[1].x - 50, points[1].y - 50)).toBeCloseTo(30);
    expect(points[2].x).toBeCloseTo(50);
    expect(points[2].y).toBeCloseTo(90);
  });

  it('keeps invalid samples at the base radius and returns no points for empty input', () => {
    const points = polarSamplePoints([Number.NaN, -1], {
      centerX: 50,
      centerY: 50,
      radius: 20,
      amplitude: 20
    });

    expect(Math.hypot(points[0].x - 50, points[0].y - 50)).toBeCloseTo(20);
    expect(Math.hypot(points[1].x - 50, points[1].y - 50)).toBeCloseTo(20);
    expect(polarSamplePoints([], { centerX: 50, centerY: 50, radius: 20, amplitude: 20 })).toEqual([]);
  });
});
