const AUTHORIZE_ENDPOINT = 'https://accounts.spotify.com/authorize';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const STORAGE_PREFIX = 'spotify-wallpaper-auth';
const CLIENT_ID_KEY = `${STORAGE_PREFIX}:client-id`;
const VERIFIER_KEY = `${STORAGE_PREFIX}:code-verifier`;
const STATE_KEY = `${STORAGE_PREFIX}:state`;
const CREATED_AT_KEY = `${STORAGE_PREFIX}:created-at`;
const REDIRECT_URI_KEY = `${STORAGE_PREFIX}:redirect-uri`;
const MAX_AUTH_AGE_MS = 10 * 60 * 1000;
const WALLPAPER_ENGINE_TOKEN_PREFIX = 'swpt2.';

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
  | { ok: true; clientId: string; refreshToken: string; expiresIn: number | null }
  | { ok: false; message: string };

export interface AuthStorage {
  setItem(key: string, value: string): void;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

export interface WallpaperEngineTokenPayload {
  clientId: string;
  refreshToken: string;
}

export const buildRedirectUri = (origin: string, basePath: string): string =>
  new URL('callback/', new URL(ensureTrailingSlash(basePath), origin)).toString();

export const encodeWallpaperEngineToken = ({ clientId, refreshToken }: WallpaperEngineTokenPayload): string => {
  const payload = JSON.stringify({
    v: 2,
    clientId: clientId.trim(),
    refreshToken: refreshToken.trim(),
    authorizationId: Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, '0')).join(''),
    authorizedAtMs: Date.now()
  });
  return `${WALLPAPER_ENGINE_TOKEN_PREFIX}${base64UrlEncode(new TextEncoder().encode(payload))}`;
};

export const buildAuthorizeUrl = async (
  config: AuthConfig,
  storage: AuthStorage = sessionStorage
): Promise<string> => {
  if (!config.clientId.trim() || config.clientId.length > 256) throw new Error('Client IDを入力してください。');
  const verifier = generateCodeVerifier();
  const state = generateRandomString(32);
  const challenge = await codeChallenge(verifier);

  storage.setItem(VERIFIER_KEY, verifier);
  storage.setItem(STATE_KEY, state);
  storage.setItem(CREATED_AT_KEY, String(Date.now()));
  storage.setItem(CLIENT_ID_KEY, config.clientId.trim());
  storage.setItem(REDIRECT_URI_KEY, config.redirectUri);

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
  if (['code', 'state', 'error'].some(key => parsed.searchParams.getAll(key).length > 1)) {
    return { code: null, state: null, error: null, errorDescription: null };
  }
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
  storage?: AuthStorage
): Promise<TokenExchangeResult> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    storage ??= sessionStorage;
    const callback = parseCallbackParams(callbackUrl);
    const savedState = storage.getItem(STATE_KEY);
    // An old callback must not consume a newer authorization transaction.
    if (!callback.state || !savedState || callback.state !== savedState) {
      return { ok: false, message: '認可の確認情報が一致しません。最初から認証してください。' };
    }
    const verifier = storage.getItem(VERIFIER_KEY);
    const savedClientId = storedClientId(storage);
    const savedRedirectUri = storage.getItem(REDIRECT_URI_KEY);
    const createdAtRaw = storage.getItem(CREATED_AT_KEY);
    const createdAt = Number(createdAtRaw);
    // Consume synchronously before any await, including the network request.
    clearAuthSession(storage);
    if (callback.error) {
      return { ok: false, message: spotifyAuthorizationErrorMessage(callback.error, callback.errorDescription) };
    }

    if (!callback.code || !callback.state) {
      return { ok: false, message: '認可結果が不足しています。最初から認証してください。' };
    }

    if (!savedState || !verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !createdAtRaw || !Number.isSafeInteger(createdAt) || !savedClientId || savedRedirectUri !== redirectUri || savedClientId !== clientId.trim()) {
      return { ok: false, message: '認可開始時の情報がありません、または変更されました。最初から認証してください。' };
    }

    if (createdAt > Date.now() || Date.now() - createdAt > MAX_AUTH_AGE_MS) {
      return { ok: false, message: '認可セッションの期限が無効です。最初から認証してください。' };
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: callback.code,
      redirect_uri: savedRedirectUri,
      client_id: savedClientId,
      code_verifier: verifier
    });

    const controller = new AbortController();
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 15_000);
    });
    const response = await Promise.race([fetcher(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body,
      signal: controller.signal,
      redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store'
    }), deadline]);

    if (!response.ok) {
      return { ok: false, message: 'SpotifyがToken交換を拒否しました。最初から認証してください。' };
    }

    const payload: unknown = await Promise.race([response.json().catch(() => null), deadline]);
    if (!isTokenPayload(payload)) {
      return { ok: false, message: 'SpotifyのToken応答が不正でした。最初から認証してください。' };
    }

    return {
      ok: true,
      clientId: savedClientId,
      refreshToken: payload.refresh_token,
      expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : null
    };
  } catch {
    return { ok: false, message: '認証通信または一時保存に失敗しました。最初から認証してください。' };
  } finally {
    clearTimeout(timeout);
  }
};

export const clearAuthSession = (storage: AuthStorage = sessionStorage): void => {
  storage.removeItem(CLIENT_ID_KEY);
  storage.removeItem(VERIFIER_KEY);
  storage.removeItem(STATE_KEY);
  storage.removeItem(CREATED_AT_KEY);
  storage.removeItem(REDIRECT_URI_KEY);
};

export const storedClientId = (storage: AuthStorage = sessionStorage): string =>
  storage.getItem(CLIENT_ID_KEY) ?? '';

export const generateCodeVerifier = (): string => generateRandomString(96);

export const codeChallenge = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
};

const generateRandomString = (length: number): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
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
  if (normalizedError === 'access_denied') {
    return 'Spotifyの認可が拒否・取消されました。Development ModeではDashboardのUser Managementも確認し、最初から認証してください。';
  }

  if (normalizedError === 'invalid_request') {
    return 'Spotifyが認可要求を拒否しました。画面に表示されたRedirect URIの登録を確認してください。';
  }

  if (normalizedError === 'server_error') {
    return 'Spotify側でエラーが発生しました。Client IDと画面に表示されたRedirect URIの登録を確認し、最初から認証してください。';
  }

  return 'Spotify認証に失敗しました。アプリ設定を確認し、最初から認証してください。';
};

const isTokenPayload = (value: unknown): value is { refresh_token: string; expires_in?: number } => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.refresh_token === 'string' && record.refresh_token.trim().length > 0 && record.refresh_token.length <= 16384 &&
    (record.expires_in === undefined || (typeof record.expires_in === 'number' && Number.isFinite(record.expires_in) && record.expires_in > 0 && record.expires_in <= 86400));
};
