import type { VisualizerFrame } from '@spotify-wallpaper/shared-types';
import type { WallpaperPreferences } from '@spotify-wallpaper/shared-types';

export interface ReadabilityResult {
  text: { r: number; g: number; b: number };
  overlayOpacity: number;
  shadowStrength: number;
  contrastRatio: number;
}

interface VisualCoreModule {
  default?: () => Promise<void>;
  normalize_visualizer: (
    current: Float32Array,
    previous: Float32Array,
    smoothing: number,
    decay: number,
    clampMax: number,
    noiseGate: number
  ) => Float32Array;
  readability: (r: number, g: number, b: number) => Float32Array;
}

let coreModule: VisualCoreModule | null = null;
let loadStarted = false;

export const initVisualCore = (): void => {
  if (loadStarted || typeof window === 'undefined') {
    return;
  }

  loadStarted = true;
  void dynamicImport(visualCoreModuleUrl())
    .then(async (module: VisualCoreModule) => {
      if (module.default) {
        await module.default();
      }
      coreModule = module;
    })
    .catch(() => {
      coreModule = null;
    });
};

const dynamicImport = (specifier: string): Promise<VisualCoreModule> => {
  const loader = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<VisualCoreModule>;
  return loader(specifier);
};

const visualCoreModuleUrl = (): string =>
  import.meta.url.includes('/src/')
    ? '/wasm/spotify_wallpaper_visual_core.js'
    : new URL('../wasm/spotify_wallpaper_visual_core.js', import.meta.url).href;

export const visualCoreStatus = (): 'wasm' | 'typescript-fallback' => (coreModule ? 'wasm' : 'typescript-fallback');

export const normalizeSamplesWithCore = (
  frame: VisualizerFrame,
  previous: VisualizerFrame | null,
  settings: WallpaperPreferences['visualizer']
): { samples: number[]; peak: number } | null => {
  const core = coreModule;
  if (!core) {
    return null;
  }

  try {
    const output = core.normalize_visualizer(
      Float32Array.from(frame.samples),
      Float32Array.from(previous?.samples ?? []),
      settings.smoothing,
      settings.decay,
      settings.clampMax,
      settings.noiseGate
    );
    if (!(output instanceof Float32Array) || output.length === 0) {
      return null;
    }
    return decodeNormalizationOutput(output);
  } catch {
    return null;
  }
};

export const readabilityWithCore = (r: number, g: number, b: number): ReadabilityResult | null => {
  const core = coreModule;
  if (!core) {
    return null;
  }

  try {
    const output = core.readability(Math.round(r), Math.round(g), Math.round(b));
    return decodeReadabilityOutput(output);
  } catch {
    return null;
  }
};

export const decodeNormalizationOutput = (output: Float32Array): { samples: number[]; peak: number } | null => {
  if (!(output instanceof Float32Array) || output.length === 0) {
    return null;
  }
  const samples = Array.from(output.slice(1), finiteOrZero);
  return { peak: finiteOrZero(output[0]), samples: samples.length > 0 ? samples : [0] };
};

export const decodeReadabilityOutput = (output: Float32Array): ReadabilityResult | null => {
  if (!(output instanceof Float32Array) || output.length < 6) {
    return null;
  }
  return {
    text: { r: finiteOrZero(output[0]), g: finiteOrZero(output[1]), b: finiteOrZero(output[2]) },
    overlayOpacity: finiteOrZero(output[3]),
    shadowStrength: finiteOrZero(output[4]),
    contrastRatio: finiteOrZero(output[5])
  };
};

const finiteOrZero = (value: number): number => (Number.isFinite(value) ? value : 0);
