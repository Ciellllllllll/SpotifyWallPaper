import type { NormalizedPlayback, SpotifyErrorKind, SpotifyPlaybackError } from './playback';

export type PlaybackProviderKind = 'mock' | 'direct' | 'backend';

export type ProviderError = SpotifyPlaybackError;
export type ProviderErrorKind = SpotifyErrorKind;

export type ProviderConfigurationErrorCode =
  | 'missing-credentials'
  | 'invalid-origin'
  | 'unsupported-provider';

export interface ProviderConfigurationError {
  kind: 'configuration';
  code: ProviderConfigurationErrorCode;
  message: string;
}

export type ProviderSelection =
  | { kind: 'mock'; provider: PlaybackProvider & { readonly kind: 'mock' } }
  | { kind: 'ready'; provider: PlaybackProvider & { readonly kind: 'direct' | 'backend' } }
  | { kind: 'invalid'; error: ProviderConfigurationError };

export type PlaybackCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'volume'; volumePercent: number }
  | { type: 'shuffle'; state: boolean }
  | { type: 'repeat'; state: 'off' | 'track' | 'context' };

export type ProviderResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProviderError };

export interface PlaybackProvider {
  readonly kind: PlaybackProviderKind;
  poll(signal: AbortSignal): Promise<ProviderResult<NormalizedPlayback>>;
  control(command: PlaybackCommand, signal: AbortSignal): Promise<ProviderResult<void>>;
  dispose(): void;
}

export const isProviderConfigurationError = (value: unknown): value is ProviderConfigurationError => {
  if (!isRecord(value) || !hasExactKeys(value, ['kind', 'code', 'message'])) {
    return false;
  }
  return (
    value.kind === 'configuration' &&
    ['missing-credentials', 'invalid-origin', 'unsupported-provider'].includes(value.code as string) &&
    typeof value.message === 'string'
  );
};

export const isProviderSelection = (value: unknown): value is ProviderSelection => {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return false;
  }
  if (value.kind === 'invalid') {
    return hasExactKeys(value, ['kind', 'error']) && isProviderConfigurationError(value.error);
  }
  if (!hasExactKeys(value, ['kind', 'provider']) || !isRecord(value.provider)) {
    return false;
  }
  const providerKind = value.provider.kind;
  const kindMatches =
    value.kind === 'mock'
      ? providerKind === 'mock'
      : value.kind === 'ready' && (providerKind === 'direct' || providerKind === 'backend');
  return (
    kindMatches &&
    typeof value.provider.poll === 'function' &&
    typeof value.provider.control === 'function' &&
    typeof value.provider.dispose === 'function'
  );
};

const providerErrorKinds: readonly ProviderErrorKind[] = [
  'unauthorized',
  'forbidden',
  'rate_limited',
  'network_error',
  'unavailable',
  'unknown_response_shape',
  'item_null'
];

/**
 * Checks the provider-v1 wire envelope without interpreting the payload.
 * Exact top-level keys keep Worker and loopback drift observable.
 */
export const isProviderResultEnvelope = (value: unknown): value is ProviderResult<unknown> => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    return false;
  }

  if (value.ok) {
    return hasExactKeys(value, ['ok', 'value']) && 'value' in value;
  }

  if (!hasExactKeys(value, ['ok', 'error']) || !isRecord(value.error)) {
    return false;
  }

  const error = value.error;
  if (
    typeof error.kind !== 'string' ||
    !providerErrorKinds.includes(error.kind as ProviderErrorKind) ||
    typeof error.message !== 'string'
  ) {
    return false;
  }

  return (
    (!('retryAfterMs' in error) || isSafeNonNegativeInteger(error.retryAfterMs)) &&
    (!('status' in error) || isIntegerInRange(error.status, 100, 599)) &&
    hasExactKeys(error, ['kind', 'message', ...(error.retryAfterMs !== undefined ? ['retryAfterMs'] : []), ...(error.status !== undefined ? ['status'] : [])])
  );
};

export const isNormalizedPlaybackResultEnvelope = (value: unknown): value is ProviderResult<NormalizedPlayback> => {
  if (!isProviderResultEnvelope(value)) {
    return false;
  }
  return value.ok ? isNormalizedPlayback(value.value) : true;
};

export const isPlaybackCommand = (value: unknown): value is PlaybackCommand => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'play':
    case 'pause':
    case 'next':
    case 'previous':
      return hasExactKeys(value, ['type']);
    case 'seek':
      return hasExactKeys(value, ['type', 'positionMs']) && isIntegerAtLeast(value.positionMs, 0);
    case 'volume':
      return hasExactKeys(value, ['type', 'volumePercent']) && isIntegerInRange(value.volumePercent, 0, 100);
    case 'shuffle':
      return hasExactKeys(value, ['type', 'state']) && typeof value.state === 'boolean';
    case 'repeat':
      return hasExactKeys(value, ['type', 'state']) && ['off', 'track', 'context'].includes(value.state as string);
    default:
      return false;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: string[]): boolean => {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isIntegerAtLeast = (value: unknown, min: number): value is number =>
  isFiniteNumber(value) && Number.isSafeInteger(value) && value >= min;

const isIntegerInRange = (value: unknown, min: number, max: number): value is number =>
  isIntegerAtLeast(value, min) && value <= max;

const isNormalizedPlayback = (value: unknown): value is NormalizedPlayback => {
  if (!isRecord(value) || !hasExactKeys(value, [
    'source',
    'itemType',
    'id',
    'uri',
    'title',
    'artists',
    'albumName',
    'imageUrls',
    'albumImageUrl',
    'durationMs',
    'progressMs',
    'isPlaying',
    'device',
    'deviceName',
    'shuffleState',
    'repeatState',
    'volumePercent',
    'externalUrl',
    'fetchedAt'
  ])) {
    return false;
  }

  return (
    (value.source === 'mock' || value.source === 'spotify') &&
    (value.itemType === 'track' || value.itemType === 'episode' || value.itemType === 'none') &&
    nullableString(value.id) &&
    nullableString(value.uri) &&
    typeof value.title === 'string' &&
    isStringArray(value.artists) &&
    typeof value.albumName === 'string' &&
    isStringArray(value.imageUrls) &&
    typeof value.albumImageUrl === 'string' &&
    isSafeNonNegativeInteger(value.durationMs) &&
    isSafeNonNegativeInteger(value.progressMs) &&
    value.progressMs <= value.durationMs &&
    typeof value.isPlaying === 'boolean' &&
    isPlaybackDevice(value.device) &&
    nullableString(value.deviceName) &&
    nullableBoolean(value.shuffleState) &&
    nullableRepeat(value.repeatState) &&
    nullableVolume(value.volumePercent) &&
    nullableString(value.externalUrl) &&
    typeof value.fetchedAt === 'string' &&
    Number.isFinite(Date.parse(value.fetchedAt)) &&
    playbackItemInvariant(value)
  );
};

const isPlaybackDevice = (value: unknown): boolean => {
  if (value === null) {
    return true;
  }
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'name', 'type', 'isActive', 'isRestricted', 'volumePercent'])) {
    return false;
  }
  return (
    nullableString(value.id) &&
    nullableString(value.name) &&
    nullableString(value.type) &&
    typeof value.isActive === 'boolean' &&
    typeof value.isRestricted === 'boolean' &&
    nullableVolume(value.volumePercent)
  );
};

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const nullableString = (value: unknown): boolean => value === null || typeof value === 'string';
const nullableBoolean = (value: unknown): boolean => value === null || typeof value === 'boolean';
const nullableVolume = (value: unknown): boolean => value === null || isIntegerInRange(value, 0, 100);
const nullableRepeat = (value: unknown): boolean => value === null || value === 'off' || value === 'track' || value === 'context';

const isSafeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const playbackItemInvariant = (value: Record<string, unknown>): boolean => {
  if (value.itemType === 'none') {
    return value.id === null && value.uri === null && value.durationMs === 0 && value.progressMs === 0 && value.isPlaying === false;
  }
  return typeof value.id === 'string' && value.id.length > 0 && typeof value.uri === 'string' && value.uri.length > 0;
};
