import type { NormalizedPlayback, PlaybackDeviceState, SpotifyPlaybackError } from '@spotify-wallpaper/shared-types';
import { itemNullError } from './errors';
import type { SpotifyDevice, SpotifyImage, SpotifyPlaybackResponse, SpotifyResult } from './types';

const FALLBACK_ALBUM_IMAGE = 'mock/album-placeholder.svg';

export const normalizeSpotifyPlayback = (
  raw: SpotifyPlaybackResponse,
  fetchedAt = new Date().toISOString()
): SpotifyResult<{ playback: NormalizedPlayback; warning?: SpotifyPlaybackError }> => {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      error: {
        kind: 'unknown_response_shape',
        message: 'Spotify playback response shape was unexpected.'
      }
    };
  }

  const device = normalizeDevice(raw.device);
  if (raw.item === null || raw.item === undefined) {
    return {
      ok: true,
      value: {
        playback: buildEmptyPlayback(raw, device, fetchedAt),
        warning: itemNullError()
      }
    };
  }

  if (!raw.item || typeof raw.item !== 'object') {
    return {
      ok: false,
      error: {
        kind: 'unknown_response_shape',
        message: 'Spotify playback item shape was unexpected.'
      }
    };
  }

  const item = raw.item as Record<string, unknown>;
  const itemType = item.type === 'episode' ? 'episode' : item.type === 'track' ? 'track' : null;
  if (!itemType) {
    return {
      ok: false,
      error: {
        kind: 'unknown_response_shape',
        message: 'Spotify playback item type was unexpected.'
      }
    };
  }

  const title = stringOr(item.name, itemType === 'episode' ? 'Untitled episode' : 'Untitled track');
  const durationMs = numberOr(item.duration_ms, 0);
  const progressMs = numberOr(raw.progress_ms, 0);
  const isPlaying = Boolean(raw.is_playing);
  const imageUrls = itemType === 'episode' ? episodeImageUrls(item) : trackImageUrls(item);
  const artists = itemType === 'episode' ? episodePublisher(item) : trackArtists(item);
  const albumName = itemType === 'episode' ? episodeShowName(item) : trackAlbumName(item);

  return {
    ok: true,
    value: {
      playback: {
        source: 'spotify',
        itemType,
        id: nullableString(item.id),
        uri: nullableString(item.uri),
        title,
        artists,
        albumName,
        imageUrls,
        albumImageUrl: imageUrls[0] ?? FALLBACK_ALBUM_IMAGE,
        durationMs,
        progressMs,
        isPlaying,
        device,
        deviceName: device?.name ?? null,
        shuffleState: typeof raw.shuffle_state === 'boolean' ? raw.shuffle_state : null,
        repeatState:
          raw.repeat_state === 'track' || raw.repeat_state === 'context' || raw.repeat_state === 'off'
            ? raw.repeat_state
            : null,
        volumePercent: device?.volumePercent ?? null,
        externalUrl: externalUrl(item),
        fetchedAt
      }
    }
  };
};

const buildEmptyPlayback = (
  raw: SpotifyPlaybackResponse,
  device: PlaybackDeviceState | null,
  fetchedAt: string
): NormalizedPlayback => ({
  source: 'spotify',
  itemType: 'none',
  id: null,
  uri: null,
  title: 'Nothing Playing',
  artists: [],
  albumName: '',
  imageUrls: [FALLBACK_ALBUM_IMAGE],
  albumImageUrl: FALLBACK_ALBUM_IMAGE,
  durationMs: 0,
  progressMs: numberOr(raw.progress_ms, 0),
  isPlaying: Boolean(raw.is_playing),
  device,
  deviceName: device?.name ?? null,
  shuffleState: typeof raw.shuffle_state === 'boolean' ? raw.shuffle_state : null,
  repeatState:
    raw.repeat_state === 'track' || raw.repeat_state === 'context' || raw.repeat_state === 'off' ? raw.repeat_state : null,
  volumePercent: device?.volumePercent ?? null,
  externalUrl: null,
  fetchedAt
});

const normalizeDevice = (value: unknown): PlaybackDeviceState | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const device = value as SpotifyDevice;
  return {
    id: nullableString(device.id),
    name: nullableString(device.name),
    type: nullableString(device.type),
    isActive: Boolean(device.is_active),
    isRestricted: Boolean(device.is_restricted),
    volumePercent: typeof device.volume_percent === 'number' ? device.volume_percent : null
  };
};

const trackArtists = (item: Record<string, unknown>): string[] => {
  if (!Array.isArray(item.artists)) {
    return [];
  }

  return item.artists
    .map((artist) => (artist && typeof artist === 'object' ? stringOr((artist as Record<string, unknown>).name, '') : ''))
    .filter(Boolean);
};

const trackAlbumName = (item: Record<string, unknown>): string => {
  const album = item.album;
  if (!album || typeof album !== 'object') {
    return '';
  }

  return stringOr((album as Record<string, unknown>).name, '');
};

const trackImageUrls = (item: Record<string, unknown>): string[] => {
  const album = item.album;
  if (!album || typeof album !== 'object') {
    return [FALLBACK_ALBUM_IMAGE];
  }

  return imageUrls((album as Record<string, unknown>).images);
};

const episodePublisher = (item: Record<string, unknown>): string[] => {
  const publisher = stringOr(item.publisher, '');
  return publisher ? [publisher] : [];
};

const episodeShowName = (item: Record<string, unknown>): string => {
  const show = item.show;
  if (!show || typeof show !== 'object') {
    return '';
  }

  return stringOr((show as Record<string, unknown>).name, '');
};

const episodeImageUrls = (item: Record<string, unknown>): string[] => {
  const directImages = imageUrls(item.images);
  if (directImages[0] !== FALLBACK_ALBUM_IMAGE) {
    return directImages;
  }

  const show = item.show;
  if (!show || typeof show !== 'object') {
    return directImages;
  }

  return imageUrls((show as Record<string, unknown>).images);
};

const imageUrls = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [FALLBACK_ALBUM_IMAGE];
  }

  const urls = value.map((image: SpotifyImage) => (typeof image?.url === 'string' ? image.url : '')).filter(Boolean);
  return urls.length > 0 ? urls : [FALLBACK_ALBUM_IMAGE];
};

const externalUrl = (item: Record<string, unknown>): string | null => {
  const externalUrls = item.external_urls;
  if (!externalUrls || typeof externalUrls !== 'object') {
    return null;
  }

  return nullableString((externalUrls as Record<string, unknown>).spotify);
};

const nullableString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const stringOr = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);
const numberOr = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
