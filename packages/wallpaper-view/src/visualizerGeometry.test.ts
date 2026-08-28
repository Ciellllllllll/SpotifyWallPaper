import { describe, expect, it } from 'vitest';
import { polarPoint, polarSamplePoints, radialBarRectangles } from './visualizerGeometry';

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

  it('builds four-point bars that touch the album edge and grow outward', () => {
    const bars = radialBarRectangles([0.5, 1], {
      centerX: 50,
      centerY: 50,
      radius: 50,
      amplitude: 10,
      side: 2,
      minSample: 0.03
    });

    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveLength(4);
    expect(bars[0][0].x).toBeCloseTo(49);
    expect(bars[0][0].y).toBeCloseTo(0);
    expect(bars[0][1].x).toBeCloseTo(49);
    expect(bars[0][1].y).toBeCloseTo(-7);
    expect(bars[0][2].x).toBeCloseTo(51);
    expect(bars[0][2].y).toBeCloseTo(-7);
    expect(bars[0][3].x).toBeCloseTo(51);
    expect(bars[0][3].y).toBeCloseTo(0);
    expect(bars[1][0].x).toBeCloseTo(51);
    expect(bars[1][0].y).toBeCloseTo(100);
    expect(bars[1][1].x).toBeCloseTo(51);
    expect(bars[1][1].y).toBeCloseTo(112);
    expect(bars[1][2].x).toBeCloseTo(49);
    expect(bars[1][2].y).toBeCloseTo(112);
    expect(bars[1][3].x).toBeCloseTo(49);
    expect(bars[1][3].y).toBeCloseTo(100);
  });

  it('hides samples below 0.03 while keeping the threshold value visible', () => {
    const bars = radialBarRectangles([0.029, 0.03, Number.NaN, -1, 0.5], {
      centerX: 50,
      centerY: 50,
      radius: 50,
      amplitude: 10,
      side: 2,
      minSample: 0.03
    });

    expect(bars).toHaveLength(5);
    expect(bars.map((points) => points.length)).toEqual([0, 4, 0, 0, 4]);
  });

  it('starts from a two-by-two square before adding sample extension', () => {
    const [bar] = radialBarRectangles([0], {
      centerX: 50,
      centerY: 50,
      radius: 50,
      amplitude: 10,
      side: 2,
      minSample: 0
    });

    expect(bar).toHaveLength(4);
    expect(bar[0].x).toBeCloseTo(49);
    expect(bar[0].y).toBeCloseTo(0);
    expect(bar[1].x).toBeCloseTo(49);
    expect(bar[1].y).toBeCloseTo(-2);
    expect(bar[2].x).toBeCloseTo(51);
    expect(bar[2].y).toBeCloseTo(-2);
    expect(bar[3].x).toBeCloseTo(51);
    expect(bar[3].y).toBeCloseTo(0);
  });

  it('keeps rectangle coordinates finite for invalid layout values', () => {
    const bars = radialBarRectangles([Number.NaN, -1, 0.5], {
      centerX: Number.NaN,
      centerY: Number.POSITIVE_INFINITY,
      radius: -2,
      amplitude: Number.NaN,
      side: -2,
      minSample: 0.03
    });

    expect(bars).toHaveLength(3);
    expect(bars.map((points) => points.length)).toEqual([0, 0, 4]);
    expect(bars[2].every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });
});
