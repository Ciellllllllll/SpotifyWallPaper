import type {
  NormalizedPlayback,
  PlaybackDeviceState
} from '@spotify-wallpaper/shared-types';

import type { ApiResult } from './contracts';

const fallbackAlbumImage = 'mock/album-placeholder.svg';

export function normalizeSpotifyPlayback(
  raw: unknown,
  fetchedAt = new Date().toISOString()
): ApiResult<NormalizedPlayback> {
  if (raw === null || Array.isArray(raw) || typeof raw !== 'object') {
    return unknownShape('Spotify playback response shape was unexpected.');
  }

  const playback = raw as Record<string, unknown>;
  const device = normalizeDevice(playback.device);
  if (playback.item === null || playback.item === undefined) {
    return {
      ok: true,
      value: emptySpotifyPlayback(fetchedAt, playback, device)
    };
  }
  if (Array.isArray(playback.item) || typeof playback.item !== 'object') {
    return unknownShape('Spotify playback item shape was unexpected.');
  }

  const item = playback.item as Record<string, unknown>;
  const itemType = playbackItemType(item.type) ?? playbackItemType(playback.currently_playing_type);
  if (itemType === null) {
    return {
      ok: true,
      value: emptySpotifyPlayback(fetchedAt, playback, device)
    };
  }

  const imageUrls =
    itemType === 'episode' ? episodeImageUrls(item) : trackImageUrls(item);
  return {
    ok: true,
    value: {
      source: 'spotify',
      itemType,
      id: nullableString(item.id),
      uri: nullableString(item.uri),
      title: stringOr(
        item.name,
        itemType === 'episode' ? 'Untitled episode' : 'Untitled track'
      ),
      artists: itemType === 'episode' ? episodePublisher(item) : trackArtists(item),
      albumName: itemType === 'episode' ? episodeShowName(item) : trackAlbumName(item),
      imageUrls,
      albumImageUrl: imageUrls[0] ?? fallbackAlbumImage,
      durationMs: nonNegativeNumber(item.duration_ms),
      progressMs: nonNegativeNumber(playback.progress_ms),
      isPlaying: playback.is_playing === true,
      device,
      deviceName: device?.name ?? null,
      shuffleState:
        typeof playback.shuffle_state === 'boolean' ? playback.shuffle_state : null,
      repeatState:
        playback.repeat_state === 'off' ||
        playback.repeat_state === 'track' ||
        playback.repeat_state === 'context'
          ? playback.repeat_state
          : null,
      volumePercent: device?.volumePercent ?? null,
      externalUrl: externalUrl(item),
      fetchedAt
    }
  };
}

export function emptySpotifyPlayback(
  fetchedAt = new Date().toISOString(),
  raw: Record<string, unknown> = {},
  device: PlaybackDeviceState | null = null
): NormalizedPlayback {
  return {
    source: 'spotify',
    itemType: 'none',
    id: null,
    uri: null,
    title: 'Nothing Playing',
    artists: [],
    albumName: '',
    imageUrls: [fallbackAlbumImage],
    albumImageUrl: fallbackAlbumImage,
    durationMs: 0,
    progressMs: nonNegativeNumber(raw.progress_ms),
    isPlaying: raw.is_playing === true,
    device,
    deviceName: device?.name ?? null,
    shuffleState: typeof raw.shuffle_state === 'boolean' ? raw.shuffle_state : null,
    repeatState:
      raw.repeat_state === 'off' ||
      raw.repeat_state === 'track' ||
      raw.repeat_state === 'context'
        ? raw.repeat_state
        : null,
    volumePercent: device?.volumePercent ?? null,
    externalUrl: null,
    fetchedAt
  };
}

function normalizeDevice(value: unknown): PlaybackDeviceState | null {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    return null;
  }
  const device = value as Record<string, unknown>;
  return {
    id: nullableString(device.id),
    name: nullableString(device.name),
    type: nullableString(device.type),
    isActive: device.is_active === true,
    isRestricted: device.is_restricted === true,
    volumePercent:
      typeof device.volume_percent === 'number' &&
      Number.isFinite(device.volume_percent)
        ? Math.max(0, Math.min(100, Math.round(device.volume_percent)))
        : null
  };
}

function trackArtists(item: Record<string, unknown>): string[] {
  if (!Array.isArray(item.artists)) {
    return [];
  }
  return item.artists
    .slice(0, 32)
    .map((artist) =>
      artist !== null && !Array.isArray(artist) && typeof artist === 'object'
        ? stringOr((artist as Record<string, unknown>).name, '')
        : ''
    )
    .filter((name) => name.length > 0);
}

function trackAlbumName(item: Record<string, unknown>): string {
  return nestedString(item.album, 'name');
}

function episodePublisher(item: Record<string, unknown>): string[] {
  const publisher = stringOr(item.publisher, '');
  return publisher === '' ? [] : [publisher];
}

function episodeShowName(item: Record<string, unknown>): string {
  return nestedString(item.show, 'name');
}

function trackImageUrls(item: Record<string, unknown>): string[] {
  return imageUrls(nestedValue(item.album, 'images'));
}

function episodeImageUrls(item: Record<string, unknown>): string[] {
  const direct = imageUrls(item.images);
  return direct[0] === fallbackAlbumImage
    ? imageUrls(nestedValue(item.show, 'images'))
    : direct;
}

function imageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [fallbackAlbumImage];
  }
  const urls = value
    .slice(0, 8)
    .map((image) =>
      image !== null && !Array.isArray(image) && typeof image === 'object'
        ? nullableString((image as Record<string, unknown>).url)
        : null
    )
    .filter((url): url is string => url !== null);
  return urls.length > 0 ? urls : [fallbackAlbumImage];
}

function externalUrl(item: Record<string, unknown>): string | null {
  return nullableString(nestedValue(item.external_urls, 'spotify'));
}

function nestedString(value: unknown, key: string): string {
  return stringOr(nestedValue(value, key), '');
}

function nestedValue(value: unknown, key: string): unknown {
  return value !== null && !Array.isArray(value) && typeof value === 'object'
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function playbackItemType(value: unknown): 'episode' | 'track' | null {
  return value === 'episode' || value === 'track' ? value : null;
}

function unknownShape(message: string): ApiResult<never> {
  return {
    ok: false,
    error: {
      kind: 'unknown_response_shape',
      message
    }
  };
}
