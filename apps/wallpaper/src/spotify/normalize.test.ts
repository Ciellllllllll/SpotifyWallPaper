import { describe, expect, it } from 'vitest';
import episodeFixture from '../../../../tests/fixtures/spotify/current-playback-episode.json';
import itemNullFixture from '../../../../tests/fixtures/spotify/current-playback-item-null.json';
import missingImageFixture from '../../../../tests/fixtures/spotify/current-playback-missing-image.json';
import trackFixture from '../../../../tests/fixtures/spotify/current-playback-track.json';
import { normalizeSpotifyPlayback } from './normalize';

const fetchedAt = '2026-06-13T00:00:00.000Z';

describe('normalizeSpotifyPlayback', () => {
  it('normalizes a track response into the display model', () => {
    const result = normalizeSpotifyPlayback(trackFixture, fetchedAt);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.playback).toMatchObject({
      source: 'spotify',
      itemType: 'track',
      id: 'track-1',
      uri: 'spotify:track:track-1',
      title: 'Current Song',
      artists: ['First Artist', 'Second Artist'],
      albumName: 'Current Album',
      albumImageUrl: 'https://i.scdn.co/image/large',
      durationMs: 180000,
      progressMs: 65000,
      isPlaying: true,
      deviceName: 'Desktop',
      shuffleState: false,
      repeatState: 'off',
      volumePercent: 55,
      externalUrl: 'https://open.spotify.com/track/track-1',
      fetchedAt
    });
  });

  it('normalizes an episode without using track-only fields', () => {
    const result = normalizeSpotifyPlayback(episodeFixture, fetchedAt);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.playback.itemType).toBe('episode');
    expect(result.value.playback.artists).toEqual(['Mock Publisher']);
    expect(result.value.playback.albumName).toBe('Mock Show');
    expect(result.value.playback.albumImageUrl).toBe('https://i.scdn.co/image/show');
  });

  it('returns a safe empty playback model and item_null warning for null item', () => {
    const result = normalizeSpotifyPlayback(itemNullFixture, fetchedAt);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.warning?.kind).toBe('item_null');
    expect(result.value.playback.itemType).toBe('none');
    expect(result.value.playback.title).toBe('Nothing Playing');
    expect(result.value.playback.progressMs).toBe(0);
  });

  it('uses the local placeholder when Spotify artwork is missing', () => {
    const result = normalizeSpotifyPlayback(missingImageFixture, fetchedAt);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.playback.albumImageUrl).toBe('/mock/album-placeholder.svg');
    expect(result.value.playback.progressMs).toBe(0);
  });
});
