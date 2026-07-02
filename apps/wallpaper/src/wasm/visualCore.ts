import type { LayoutItem, LyricLine, VisualizerFrame, WallpaperSettings } from '@spotify-wallpaper/shared-types';

export interface LrcParseResult {
  offsetMs: number;
  lines: LyricLine[];
}

export interface ReadabilityResult {
  text: { r: number; g: number; b: number };
  overlayOpacity: number;
  shadowStrength: number;
  contrastRatio: number;
}

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VisualCoreModule {
  default?: () => Promise<void>;
  parse_lrc_json: (input: string) => string;
  normalize_visualizer_json: (inputJson: string) => string;
  readability_json: (r: number, g: number, b: number) => string;
  calculate_layout_rect_json: (inputJson: string) => string;
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

export const parseLrcWithCore = (input: string, fallback: () => LrcParseResult): LrcParseResult => {
  const output = callJson<LrcParseResult>(() => coreModule?.parse_lrc_json(input));
  return output?.lines ? output : fallback();
};

export const normalizeSamplesWithCore = (
  frame: VisualizerFrame,
  previous: VisualizerFrame | null,
  settings: WallpaperSettings['visualizer']
): { samples: number[]; peak: number } | null =>
  callJson(() =>
    coreModule?.normalize_visualizer_json(
      JSON.stringify({
        current: frame.samples,
        previous: previous?.samples ?? [],
        smoothing: settings.smoothing,
        decay: settings.decay,
        clampMax: 1,
        noiseGate: 0
      })
    )
  );

export const readabilityWithCore = (r: number, g: number, b: number): ReadabilityResult | null =>
  callJson(() => coreModule?.readability_json(Math.round(r), Math.round(g), Math.round(b)));

export const layoutRectWithCore = (item: LayoutItem): LayoutRect | null => {
  if (item.unit !== 'percent' || typeof window === 'undefined') {
    return null;
  }

  return callJson(() =>
    coreModule?.calculate_layout_rect_json(
      JSON.stringify({
        xPercent: item.x,
        yPercent: item.y,
        width: item.width,
        height: item.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        safeMargin: item.safeAreaMargin,
        anchor: item.anchor,
        clampToSafeArea: item.responsive === 'clamp-safe-area'
      })
    )
  );
};

const callJson = <T>(callback: () => string | undefined): T | null => {
  if (!coreModule) {
    return null;
  }

  try {
    const raw = callback();
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as T & { error?: string };
    return parsed && !parsed.error ? parsed : null;
  } catch {
    return null;
  }
};
