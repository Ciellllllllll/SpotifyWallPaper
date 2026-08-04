import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { defaultWallpaperPreferences } from '@spotify-wallpaper/shared-types';
import { normalizeSamplesFallback, readabilityFallback } from './fallback';
import { decodeNormalizationOutput, decodeReadabilityOutput } from './visualCore';

const wasmDirectory = new URL('../../public/wasm/', import.meta.url);
const wasmJavaScript = new URL('spotify_wallpaper_visual_core.js', wasmDirectory);
const wasmBinary = new URL('spotify_wallpaper_visual_core_bg.wasm', wasmDirectory);
const hasGeneratedWasm = existsSync(wasmJavaScript) && existsSync(wasmBinary);

describe.skipIf(!hasGeneratedWasm)('actual WASM and production fallback parity', () => {
  it('matches normalization and readability within the published tolerances', async () => {
    const wasmModule = await import(wasmJavaScript.href);
    await wasmModule.default({ module_or_path: await readFile(wasmBinary) });
    const settings = {
      ...defaultWallpaperPreferences().visualizer,
      smoothing: 0.35,
      decay: 0.22,
      clampMax: 1,
      noiseGate: 0.03
    };
    const current = [0.05, 0.25, 0.5, 1.4, 0];
    const previous = [0.8, 0.2, 0.1, 0.4, 0.2, 0.9];
    const actual = decodeNormalizationOutput(
      wasmModule.normalize_visualizer(
        new Float32Array(current),
        new Float32Array(previous),
        settings.smoothing,
        settings.decay,
        settings.clampMax,
        settings.noiseGate
      )
    );
    const expected = normalizeSamplesFallback(current, previous, settings);
    expect(actual).not.toBeNull();
    expect(actual?.samples).toHaveLength(expected.samples.length);
    actual?.samples.forEach((value, index) => expect(value).toBeCloseTo(expected.samples[index], 5));
    expect(actual?.peak).toBeCloseTo(expected.peak, 5);

    const actualReadability = decodeReadabilityOutput(wasmModule.readability(245, 240, 230));
    const expectedReadability = readabilityFallback(245, 240, 230);
    expect(actualReadability).not.toBeNull();
    expectAbsoluteDifference(actualReadability?.text.r, expectedReadability.text.r, 1e-4);
    expectAbsoluteDifference(actualReadability?.text.g, expectedReadability.text.g, 1e-4);
    expectAbsoluteDifference(actualReadability?.text.b, expectedReadability.text.b, 1e-4);
    expectAbsoluteDifference(actualReadability?.overlayOpacity, expectedReadability.overlayOpacity, 1e-4);
    expectAbsoluteDifference(actualReadability?.shadowStrength, expectedReadability.shadowStrength, 1e-4);
    expectAbsoluteDifference(actualReadability?.contrastRatio, expectedReadability.contrastRatio, 1e-4);
  });

  it('keeps NaN and empty input safe through the same decoder contract', async () => {
    const wasmModule = await import(wasmJavaScript.href);
    await wasmModule.default({ module_or_path: await readFile(wasmBinary) });
    const settings = defaultWallpaperPreferences().visualizer;
    const invalid = decodeNormalizationOutput(
      wasmModule.normalize_visualizer(new Float32Array([Number.NaN]), new Float32Array(), settings.smoothing, settings.decay, settings.clampMax, settings.noiseGate)
    );
    const empty = decodeNormalizationOutput(
      wasmModule.normalize_visualizer(new Float32Array(), new Float32Array(), settings.smoothing, settings.decay, settings.clampMax, settings.noiseGate)
    );
    expect(invalid).toEqual(normalizeSamplesFallback([Number.NaN], [], settings));
    expect(empty).toEqual(normalizeSamplesFallback([], [], settings));
  });
});

const expectAbsoluteDifference = (actual: number | undefined, expected: number, tolerance: number): void => {
  expect(actual).toBeDefined();
  expect(Math.abs((actual ?? 0) - expected)).toBeLessThanOrEqual(tolerance);
};
