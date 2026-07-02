const AUTHORIZE_ENDPOINT = 'https://accounts.spotify.com/authorize';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const STORAGE_PREFIX = 'spotify-wallpaper-auth';
const CLIENT_ID_KEY = `${STORAGE_PREFIX}:client-id`;
const VERIFIER_KEY = `${STORAGE_PREFIX}:code-verifier`;
const STATE_KEY = `${STORAGE_PREFIX}:state`;
const CREATED_AT_KEY = `${STORAGE_PREFIX}:created-at`;
const MAX_AUTH_AGE_MS = 10 * 60 * 1000;

export const SPOTIFY_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state'
] as const;

export interface AuthConfig {
  clientId: string;
  redirectUri: string;
}

export interface CallbackParams {
  code: string | null;
  state: string | null;
  error: string | null;
  errorDescription: string | null;
}

export type TokenExchangeResult =
  | { ok: true; refreshToken: string; expiresIn: number | null }
  | { ok: false; message: string };

export interface AuthStorage {
  setItem(key: string, value: string): void;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

export const buildRedirectUri = (origin: string, basePath: string): string =>
  new URL('callback', new URL(ensureTrailingSlash(basePath), origin)).toString();

export const buildAuthorizeUrl = async (
  config: AuthConfig,
  storage: AuthStorage = sessionStorage
): Promise<string> => {
  const verifier = generateCodeVerifier();
  const state = generateRandomString(32);
  const challenge = await codeChallenge(verifier);

  storage.setItem(VERIFIER_KEY, verifier);
  storage.setItem(STATE_KEY, state);
  storage.setItem(CREATED_AT_KEY, String(Date.now()));
  storage.setItem(CLIENT_ID_KEY, config.clientId.trim());

  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId.trim());
  url.searchParams.set('scope', SPOTIFY_SCOPES.join(' '));
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('state', state);
  return url.toString();
};

export const parseCallbackParams = (url: string): CallbackParams => {
  const parsed = new URL(url);
  return {
    code: parsed.searchParams.get('code'),
    state: parsed.searchParams.get('state'),
    error: parsed.searchParams.get('error'),
    errorDescription: parsed.searchParams.get('error_description')
  };
};

export const exchangeCallbackForToken = async (
  callbackUrl: string,
  clientId: string,
  redirectUri: string,
  fetcher: typeof fetch = fetch,
  storage: AuthStorage = sessionStorage
): Promise<TokenExchangeResult> => {
  const callback = parseCallbackParams(callbackUrl);
  try {
    if (callback.error) {
      return { ok: false, message: spotifyAuthorizationErrorMessage(callback.error, callback.errorDescription) };
    }

    if (!callback.code || !callback.state) {
      return { ok: false, message: 'Spotify callback did not include an authorization result.' };
    }

    const savedState = storage.getItem(STATE_KEY);
    const verifier = storage.getItem(VERIFIER_KEY);
    const createdAt = Number.parseInt(storage.getItem(CREATED_AT_KEY) ?? '', 10);
    if (!savedState || !verifier || !Number.isFinite(createdAt)) {
      return { ok: false, message: 'Authorization session was not found. Start authorization again.' };
    }

    if (Date.now() - createdAt > MAX_AUTH_AGE_MS) {
      return { ok: false, message: 'Authorization session expired. Start authorization again.' };
    }

    if (callback.state !== savedState) {
      return { ok: false, message: 'Authorization state did not match. Start authorization again.' };
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: callback.code,
      redirect_uri: redirectUri,
      client_id: clientId.trim(),
      code_verifier: verifier
    });

    const response = await fetcher(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body
    });

    if (!response.ok) {
      return { ok: false, message: 'Spotify token exchange was rejected.' };
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!isTokenPayload(payload)) {
      return { ok: false, message: 'Spotify token response was malformed.' };
    }

    return {
      ok: true,
      refreshToken: payload.refresh_token,
      expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : null
    };
  } catch {
    return { ok: false, message: 'Spotify token request failed.' };
  } finally {
    clearAuthSession(storage);
  }
};

export const clearAuthSession = (storage: AuthStorage = sessionStorage): void => {
  storage.removeItem(CLIENT_ID_KEY);
  storage.removeItem(VERIFIER_KEY);
  storage.removeItem(STATE_KEY);
  storage.removeItem(CREATED_AT_KEY);
};

export const storedClientId = (storage: AuthStorage = sessionStorage): string =>
  storage.getItem(CLIENT_ID_KEY) ?? '';

export const sanitizeErrorMessage = (message: string): string =>
  message
    .replace(/access[_-]?token=[^&\s]+/gi, 'access_token=[redacted]')
    .replace(/refresh[_-]?token=[^&\s]+/gi, 'refresh_token=[redacted]')
    .replace(/code=[^&\s]+/gi, 'code=[redacted]');

export const generateCodeVerifier = (): string => generateRandomString(96);

export const codeChallenge = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
};

const generateRandomString = (length: number): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
};

const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const ensureTrailingSlash = (value: string): string => (value.endsWith('/') ? value : `${value}/`);

const spotifyAuthorizationErrorMessage = (error: string, description: string | null): string => {
  const normalizedError = error.toLowerCase();
  const normalizedDescription = description?.toLowerCase() ?? '';

  if (normalizedError === 'access_denied') {
    if (normalizedDescription.includes('user') || normalizedDescription.includes('developer')) {
      return 'Spotify rejected authorization. If the app is in Development mode, add this Spotify account under Spotify Dashboard > User Management, then start again.';
    }

    return 'Spotify authorization was denied or cancelled. Start again and choose Agree on the Spotify authorization screen.';
  }

  if (normalizedError === 'invalid_request') {
    return 'Spotify rejected the authorization request. Check that the Spotify Redirect URI exactly matches https://ciellllllllll.github.io/SpotifyWallPaper/spotify-auth/callback.';
  }

  if (normalizedError === 'server_error') {
    return 'Spotify returned server_error before issuing a code. In Spotify Dashboard, confirm this Client ID belongs to the app and add https://ciellllllllll.github.io/SpotifyWallPaper/spotify-auth/callback under Redirect URIs exactly.';
  }

  return `Spotify returned authorization error: ${error}. Check the Spotify app settings and start again.`;
};

const isTokenPayload = (value: unknown): value is { refresh_token: string; expires_in?: number } => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.refresh_token === 'string' && record.refresh_token.length > 0;
};
