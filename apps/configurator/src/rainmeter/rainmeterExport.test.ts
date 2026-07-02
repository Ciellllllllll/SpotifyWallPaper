import { describe, expect, it } from 'vitest';
import type { NormalizedPlayback, WallpaperTheme } from '@spotify-wallpaper/shared-types';
import { buildRainmeterOutput, exportRainmeterJson } from './rainmeterExport';

const playback: NormalizedPlayback = {
  source: 'mock',
  itemType: 'track',
  id: 'track-id',
  uri: 'spotify:track:track-id',
  title: 'Afterglow Atlas',
  artists: ['Nami Kuroda', 'The Static Lights'],
  albumName: 'Mock Signals',
  imageUrls: ['https://example.test/album.jpg'],
  albumImageUrl: 'https://example.test/album.jpg',
  durationMs: 200_000,
  progressMs: 84_000,
  isPlaying: true,
  device: null,
  deviceName: 'Browser Mock',
  shuffleState: false,
  repeatState: 'off',
  volumePercent: 72,
  externalUrl: null,
  fetchedAt: '2026-06-14T00:00:00.000Z'
};

const theme: Pick<WallpaperTheme, 'primaryColor' | 'secondaryColor' | 'accentColor' | 'readableTextColor'> = {
  primaryColor: '#112233',
  secondaryColor: '#445566',
  accentColor: '#778899',
  readableTextColor: '#f6f7fb'
};

describe('rainmeter export', () => {
  it('builds the documented Rainmeter JSON payload from playback and theme data', () => {
    const output = buildRainmeterOutput(playback, theme, {
      albumArtLocalPath: 'D:\\Cache\\album.jpg',
      timestamp: '2026-06-14T10:00:00.000Z'
    });

    expect(output).toEqual({
      title: 'Afterglow Atlas',
      artists: ['Nami Kuroda', 'The Static Lights'],
      albumName: 'Mock Signals',
      albumArtLocalPath: 'D:\\Cache\\album.jpg',
      progressMs: 84_000,
      durationMs: 200_000,
      progressRatio: 0.42,
      isPlaying: true,
      primaryColor: '#112233',
      secondaryColor: '#445566',
      accentColor: '#778899',
      readableTextColor: '#f6f7fb',
      timestamp: '2026-06-14T10:00:00.000Z',
      playbackSource: 'mock'
    });
  });

  it('clamps progress ratio and omits Spotify credentials', () => {
    const output = buildRainmeterOutput({ ...playback, progressMs: 250_000 }, theme);
    const json = exportRainmeterJson(output);

    expect(output.progressMs).toBe(200_000);
    expect(output.progressRatio).toBe(1);
    expect(json).not.toMatch(/accessToken|refreshToken|authorizationCode|clientSecret/i);
  });
});
