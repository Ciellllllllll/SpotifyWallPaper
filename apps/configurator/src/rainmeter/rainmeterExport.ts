import type { NormalizedPlayback, RainmeterOutput, WallpaperTheme } from '@spotify-wallpaper/shared-types';

export const buildRainmeterOutput = (
  playback: NormalizedPlayback,
  theme: Pick<WallpaperTheme, 'primaryColor' | 'secondaryColor' | 'accentColor' | 'readableTextColor'>,
  options: {
    albumArtLocalPath?: string | null;
    timestamp?: string;
  } = {}
): RainmeterOutput => {
  const durationMs = Math.max(0, Math.round(playback.durationMs));
  const progressMs = Math.max(0, Math.min(durationMs || Math.round(playback.progressMs), Math.round(playback.progressMs)));
  const progressRatio = durationMs > 0 ? clamp(progressMs / durationMs, 0, 1) : 0;

  return {
    title: playback.title,
    artists: [...playback.artists],
    albumName: playback.albumName,
    albumArtLocalPath: options.albumArtLocalPath ?? null,
    progressMs,
    durationMs,
    progressRatio,
    isPlaying: playback.isPlaying,
    primaryColor: theme.primaryColor,
    secondaryColor: theme.secondaryColor,
    accentColor: theme.accentColor,
    readableTextColor: theme.readableTextColor,
    timestamp: options.timestamp ?? new Date().toISOString(),
    playbackSource: playback.source
  };
};

export const exportRainmeterJson = (output: RainmeterOutput): string => JSON.stringify(output, null, 2);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
