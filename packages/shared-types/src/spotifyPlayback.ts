import type { NormalizedPlayback, PlaybackDeviceState, SpotifyRepeatState } from './playback';
import type { ProviderResult } from './provider';

const FALLBACK_ALBUM_IMAGE = 'mock/album-placeholder.svg';

export const normalizeSpotifyPlaybackPayload = (
  raw: unknown,
  fetchedAt: string
): ProviderResult<NormalizedPlayback> => {
  if (!validFetchedAt(fetchedAt)) {
    return unknownShape('Spotify playback response shape was unexpected.');
  }
  if (!isRecord(raw)) {
    return unknownShape('Spotify playback response shape was unexpected.');
  }

  const device = normalizeDevice(raw.device);
  if (raw.item === null || raw.item === undefined) {
    return { ok: true, value: emptyPlayback(raw, fetchedAt, device) };
  }
  if (!isRecord(raw.item)) {
    return unknownShape('Spotify playback item shape was unexpected.');
  }

  const item = raw.item;
  const itemType = playbackItemType(item.type) ?? playbackItemType(raw.currently_playing_type);
  if (itemType === null) {
    return { ok: true, value: emptyPlayback(raw, fetchedAt, device) };
  }

  const id = nonEmptyString(item.id);
  const uri = nonEmptyString(item.uri);
  if (id === null || uri === null) {
    return unknownShape('Spotify playback item identity was unexpected.');
  }

  const durationMs = safeNonNegativeInteger(item.duration_ms);
  const progressMs = Math.min(durationMs, safeNonNegativeInteger(raw.progress_ms));
  const imageUrls = itemType === 'episode' ? episodeImageUrls(item) : trackImageUrls(item);

  return {
    ok: true,
    value: {
      source: 'spotify',
      itemType,
      id,
      uri,
      title: stringOr(item.name, itemType === 'episode' ? 'Untitled episode' : 'Untitled track'),
      artists: itemType === 'episode' ? episodePublisher(item) : trackArtists(item),
      albumName: itemType === 'episode' ? nestedString(item.show, 'name') : nestedString(item.album, 'name'),
      imageUrls,
      albumImageUrl: imageUrls[0] ?? FALLBACK_ALBUM_IMAGE,
      durationMs,
      progressMs,
      isPlaying: raw.is_playing === true,
      device,
      deviceName: device?.name ?? null,
      shuffleState: typeof raw.shuffle_state === 'boolean' ? raw.shuffle_state : null,
      repeatState: repeatState(raw.repeat_state),
      volumePercent: device?.volumePercent ?? null,
      externalUrl: nullableString(nestedValue(item.external_urls, 'spotify')),
      fetchedAt
    }
  };
};

const emptyPlayback = (
  raw: Record<string, unknown>,
  fetchedAt: string,
  device: PlaybackDeviceState | null
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
  progressMs: 0,
  isPlaying: false,
  device,
  deviceName: device?.name ?? null,
  shuffleState: typeof raw.shuffle_state === 'boolean' ? raw.shuffle_state : null,
  repeatState: repeatState(raw.repeat_state),
  volumePercent: device?.volumePercent ?? null,
  externalUrl: null,
  fetchedAt
});

const normalizeDevice = (value: unknown): PlaybackDeviceState | null => {
  if (!isRecord(value)) return null;
  return {
    id: nullableString(value.id),
    name: nullableString(value.name),
    type: nullableString(value.type),
    isActive: value.is_active === true,
    isRestricted: value.is_restricted === true,
    volumePercent: nullableVolume(value.volume_percent)
  };
};

const trackArtists = (item: Record<string, unknown>): string[] => {
  if (!Array.isArray(item.artists)) return [];
  return item.artists
    .slice(0, 32)
    .map((artist) => isRecord(artist) ? nullableString(artist.name) : null)
    .filter((name): name is string => name !== null);
};

const trackImageUrls = (item: Record<string, unknown>): string[] => imageUrls(nestedValue(item.album, 'images'));

const episodePublisher = (item: Record<string, unknown>): string[] => {
  const publisher = nullableString(item.publisher);
  return publisher === null ? [] : [publisher];
};

const episodeImageUrls = (item: Record<string, unknown>): string[] => {
  const direct = imageUrls(item.images);
  return direct[0] === FALLBACK_ALBUM_IMAGE ? imageUrls(nestedValue(item.show, 'images')) : direct;
};

const imageUrls = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [FALLBACK_ALBUM_IMAGE];
  const urls = value
    .slice(0, 8)
    .map((image) => isRecord(image) ? nullableString(image.url) : null)
    .filter((url): url is string => url !== null);
  return urls.length > 0 ? urls : [FALLBACK_ALBUM_IMAGE];
};

const nestedString = (value: unknown, key: string): string => stringOr(nestedValue(value, key), '');

const nestedValue = (value: unknown, key: string): unknown => isRecord(value) ? value[key] : undefined;

const nullableString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  return value.length > 0 ? value : null;
};

const nonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const stringOr = (value: unknown, fallback: string): string => typeof value === 'string' ? value : fallback;

const repeatState = (value: unknown): SpotifyRepeatState | null =>
  value === 'off' || value === 'track' || value === 'context' ? value : null;

const nullableVolume = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
};

const safeNonNegativeInteger = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.round(Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, value)));
};

const playbackItemType = (value: unknown): 'track' | 'episode' | null =>
  value === 'track' || value === 'episode' ? value : null;

const validFetchedAt = (value: string): boolean => typeof value === 'string' && Number.isFinite(Date.parse(value));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const unknownShape = (message: string): ProviderResult<never> => ({
  ok: false,
  error: { kind: 'unknown_response_shape', message }
});
