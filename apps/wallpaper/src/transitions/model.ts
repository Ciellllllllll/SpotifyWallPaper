import type { NormalizedPlayback, WallpaperSettings } from '@spotify-wallpaper/shared-types';

export interface TrackTransitionState {
  previous: NormalizedPlayback;
  current: NormalizedPlayback;
  startedAtMs: number;
  durationMs: number;
  preset: WallpaperSettings['transitions']['preset'];
  resolvedPreset: WallpaperSettings['transitions']['preset'];
  easing: WallpaperSettings['transitions']['easing'];
}

export const isPlaybackChange = (previous: NormalizedPlayback, next: NormalizedPlayback): boolean => {
  const previousKey = playbackKey(previous);
  const nextKey = playbackKey(next);
  return previousKey !== nextKey;
};

export const createTransitionState = (
  previous: NormalizedPlayback,
  current: NormalizedPlayback,
  settings: WallpaperSettings,
  startedAtMs = Date.now()
): TrackTransitionState | null => {
  if (!settings.transitions.enabled || !isPlaybackChange(previous, current)) {
    return null;
  }

  return {
    previous,
    current,
    startedAtMs,
    durationMs: settings.transitions.durationMs,
    preset: settings.transitions.preset,
    resolvedPreset: resolveTransitionPreset(settings),
    easing: settings.transitions.easing
  };
};

export const resolveTransitionPreset = (settings: WallpaperSettings): WallpaperSettings['transitions']['preset'] => {
  if (!settings.transitions.reduceMotion) {
    return settings.transitions.preset;
  }

  return settings.transitions.preset === 'crossfade' ? 'crossfade' : 'fade';
};

export const transitionCssClass = (state: TrackTransitionState): string => `transition-${state.resolvedPreset}`;

const playbackKey = (playback: NormalizedPlayback): string => {
  if (playback.id) {
    return `${playback.itemType}:${playback.id}`;
  }

  return `${playback.itemType}:${playback.uri ?? playback.title}`;
};
