import type { WallpaperPreferences } from '@spotify-wallpaper/shared-types';
import type { CredentialInput } from '../../settings/credentialBoundary';
import { MockPlaybackProvider } from './mockProvider';
import { DirectPlaybackProvider } from './directProvider';
import { BackendPlaybackProvider, normalizeBackendBaseUrl } from './backendProvider';
import type { Fetcher, SpotifyCredentials, SpotifyResult } from '../types';
import type { BackendPlaybackProviderConfig, PlaybackProvider, ProviderSelection } from './types';

export const selectPlaybackProvider = (
  settings: WallpaperPreferences,
  credential: CredentialInput | null,
  fetcher: Fetcher = fetch
): ProviderSelection => {
  switch (settings.spotify.provider) {
    case 'mock':
      return { kind: 'mock', provider: new MockPlaybackProvider() };
    case 'direct': {
      const credentials = credentialsFromCredential(credential);
      return credentials
        ? { kind: 'ready', provider: new DirectPlaybackProvider(credentials, fetcher) }
        : invalid('missing-credentials', 'Spotify direct credentials are not configured.');
    }
    case 'backend': {
      if (credential?.kind !== 'backend' || credential.pairingToken.length === 0 || !settings.spotify.backendOrigin) {
        return invalid('missing-credentials', 'Spotify backend credentials or origin are not configured.');
      }
      const normalizedOrigin = normalizeBackendBaseUrl(settings.spotify.backendOrigin);
      if (!normalizedOrigin.ok) return invalid('invalid-origin', 'Spotify backend URL is invalid.');
      const config: BackendPlaybackProviderConfig = {
        backendUrl: normalizedOrigin.value,
        pairingToken: credential.pairingToken
      };
      return { kind: 'ready', provider: new BackendPlaybackProvider(config, fetcher) };
    }
    default:
      return invalid('unsupported-provider', 'Spotify provider selection is unsupported.');
  }
};

export const playbackProviderFromSettings = (
  settings: WallpaperPreferences,
  credentialOrFetcher: CredentialInput | Fetcher | null = null,
  fetcher: Fetcher = fetch
): PlaybackProvider | null => {
  const credential = typeof credentialOrFetcher === 'function' ? null : credentialOrFetcher;
  const actualFetcher = typeof credentialOrFetcher === 'function' ? credentialOrFetcher : fetcher;
  const selection = selectPlaybackProvider(settings, credential, actualFetcher);
  // The legacy nullable adapter keeps mock rendering local; callers that need
  // an explicit three-state result use selectPlaybackProvider directly.
  return selection.kind === 'invalid' || selection.kind === 'mock' ? null : selection.provider;
};

export const hasSpotifyCredentials = (credential: CredentialInput | null): credential is Extract<CredentialInput, { kind: 'direct' }> =>
  credential?.kind === 'direct' && credential.clientId.length > 0 && credential.refreshToken.length > 0;

export const credentialsFromCredential = (credential: CredentialInput | null): SpotifyCredentials | null =>
  hasSpotifyCredentials(credential) ? { clientId: credential.clientId, refreshToken: credential.refreshToken } : null;

export const backendConfigFromCredential = (settings: WallpaperPreferences, credential: CredentialInput | null): BackendPlaybackProviderConfig | null => {
  if (settings.spotify.provider !== 'backend' || !settings.spotify.backendOrigin || credential?.kind !== 'backend') return null;
  const normalized = normalizeBackendBaseUrl(settings.spotify.backendOrigin);
  return normalized.ok ? { backendUrl: normalized.value, pairingToken: credential.pairingToken } : null;
};

const invalid = (code: 'missing-credentials' | 'invalid-origin' | 'unsupported-provider', message: string): ProviderSelection => ({
  kind: 'invalid',
  error: { kind: 'configuration', code, message }
});
