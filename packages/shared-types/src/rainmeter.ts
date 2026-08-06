import type { PlaybackSource } from './playback';

export type RainmeterOutputMode = 'json';

export interface RainmeterOutput {
  title: string;
  artists: string[];
  albumName: string;
  albumArtLocalPath: string | null;
  progressMs: number;
  durationMs: number;
  progressRatio: number;
  isPlaying: boolean;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  readableTextColor: string;
  timestamp: string;
  playbackSource: PlaybackSource;
}
