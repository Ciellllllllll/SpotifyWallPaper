import {
  createOAuthState,
  decodeBase64Url,
  decryptSecret,
  encodeBase64Url,
  encryptSecret,
  keyedDigest,
  parseSecretKeyring,
  randomBase64Url,
  verifySetupProof
} from './crypto';
import {
  consumeOAuthSession,
  createCredential,
  findCredentialByPairingToken,
  isDeletionTombstoned,
  insertOAuthSession,
  reauthorizeCredential
} from './db';
import {
  isSetupSameOrigin,
  readBoundedBytes,
  readBoundedText
} from './http';
import { callbackPage, fixedError } from './pages';
import {
  activePairingKey,
  generatePairingToken,
  pairingDigest,
  parsePairingToken
} from './pairing';

const authorizeEndpoint = 'https://accounts.spotify.com/authorize';
const tokenEndpoint = 'https://accounts.spotify.com/api/token';
const oauthCookieName = 'swpb_oauth';
const oauthLifetimeMs = 10 * 60 * 1000;
const spotifyScopes = [
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state'
].join(' ');
const clientIdPattern = /^[A-Za-z0-9]{16,64}$/;
const authorizationCodePattern = /^[\x21-\x7E]{1,2048}$/;

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

type TokenExchangeResult =
  | { ok: true; tokens: TokenResponse }
  | {
      ok: false;
      failure:
        | 'token-rejected'
        | 'token-client'
        | 'token-rate-limited'
        | 'token-unavailable'
        | 'token-response'
        | 'token-scopes'
        | 'token-network';
    };

export async function handleAuthStart(request: Request, env: Env): Promise<Response> {
  const form = await readAuthStartForm(request);
  if (
    !isSetupSameOrigin(request, env) &&
    !(await hasValidSetupProof(form?.setupProof, env))
  ) {
    return fixedError(403, 'Same-origin setup is required.');
  }
  const rateLimit = await checkAuthRateLimit(request, env);
  if (rateLimit !== 'allowed') {
    return rateLimit === 'limited'
      ? authRateLimited()
      : fixedError(503, 'Spotify authorization could not start.');
  }

  if (form === null) {
    return fixedError(400, 'Valid setup input and legal acceptance are required.');
  }

  try {
    const authorization = await createAuthorizationSession(env, form.spotifyClientId, null);
    const headers = new Headers({
      'Cache-Control': 'no-store',
      Location: authorization.authorizeUrl,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    });
    headers.append('Set-Cookie', authorization.cookie);
    return new Response(null, {
      status: 303,
      headers
    });
  } catch {
    return fixedError(500, 'Spotify authorization could not start.');
  }
}

export async function handleReauthorize(request: Request, env: Env): Promise<Response> {
  if (!isSetupSameOrigin(request, env)) {
    return fixedError(403, 'Same-origin setup is required.');
  }
  const rateLimit = await checkAuthRateLimit(request, env);
  if (rateLimit !== 'allowed') {
    return rateLimit === 'limited'
      ? authRateLimited()
      : fixedError(503, 'Spotify reauthorization could not start.');
  }

  const token = bearerToken(request);
  if (token === null) {
    return fixedError(401, 'A valid Pairing Token is required.');
  }
  if (!(await readLegalAcceptance(request))) {
    return fixedError(400, 'Legal acceptance is required.');
  }

  try {
    const parsed = parsePairingToken(token);
    if (
      parsed === null ||
      (await isDeletionTombstoned(env.DELETION_DB, parsed.publicId))
    ) {
      return fixedError(401, 'A valid Pairing Token is required.');
    }
    const pairingKeyring = parseSecretKeyring(env.PAIRING_HMAC_KEYRING);
    const credential = await findCredentialByPairingToken(env.DB, token, pairingKeyring);
    if (credential === null) {
      return fixedError(401, 'A valid Pairing Token is required.');
    }

    const authorization = await createAuthorizationSession(
      env,
      credential.spotifyClientId,
      credential.publicId
    );
    return Response.json(
      {
        ok: true,
        value: {
          authorizeUrl: authorization.authorizeUrl
        }
      },
      {
        headers: {
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'Set-Cookie': authorization.cookie,
          'X-Content-Type-Options': 'nosniff'
        }
      }
    );
  } catch {
    return fixedError(500, 'Spotify reauthorization could not start.');
  }
}

export async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  const rateLimit = await checkAuthRateLimit(request, env);
  if (rateLimit !== 'allowed') {
    return rateLimit === 'limited'
      ? authRateLimited()
      : fixedError(503, 'Spotify authorization could not complete.');
  }
  const callback = parseCallback(request);
  if (callback === null) {
    return callbackPage(400, 'error', undefined, 'browser');
  }

  try {
    const stateDigest = await keyedDigest(
      callback.state,
      'oauth-state',
      env.OAUTH_STATE_HMAC_KEY
    );
    const browserDigest =
      callback.browserNonce === null
        ? null
        : await keyedDigest(callback.browserNonce, 'oauth-browser', env.OAUTH_STATE_HMAC_KEY);
    const nowMs = Date.now();
    const session = await consumeOAuthSession(
      env.DB,
      stateDigest,
      browserDigest,
      nowMs,
      true
    );
    if (session === null) {
      return callbackPage(400, 'error', undefined, 'browser');
    }
    if (callback.denied) {
      return callbackPage(400, 'error', undefined, 'spotify');
    }
    if (
      session.credentialPublicId !== null &&
      (await isDeletionTombstoned(env.DELETION_DB, session.credentialPublicId))
    ) {
      return callbackPage(400, 'error', undefined, 'browser');
    }

    const encryptionKeyring = parseSecretKeyring(env.TOKEN_ENCRYPTION_KEYRING);
    const verifier = await decryptSecret(
      session.codeVerifier,
      {
        recordId: session.stateDigest,
        spotifyClientId: session.spotifyClientId,
        fieldName: 'code_verifier'
      },
      encryptionKeyring
    );
    const tokenExchange = await exchangeAuthorizationCode(
      callback.code,
      verifier,
      session.spotifyClientId,
      redirectUri(env)
    );
    if (!tokenExchange.ok) {
      return callbackPage(502, 'error', undefined, tokenExchange.failure);
    }
    const tokens = tokenExchange.tokens;

    const accessTokenExpiresAtMs = nowMs + tokens.expiresInSeconds * 1000;
    if (session.credentialPublicId === null) {
      const pairing = generatePairingToken();
      const pairingKeyring = parseSecretKeyring(env.PAIRING_HMAC_KEYRING);
      const pairingKey = activePairingKey(
        pairingKeyring,
        env.PAIRING_HMAC_ACTIVE_KEY_ID
      );
      const [digest, refreshToken, accessToken] = await Promise.all([
        pairingDigest(pairing.publicId, pairing.secret, pairingKey),
        encryptSecret(
          tokens.refreshToken,
          {
            recordId: pairing.publicId,
            spotifyClientId: session.spotifyClientId,
            fieldName: 'refresh_token'
          },
          env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID,
          encryptionKeyring
        ),
        encryptSecret(
          tokens.accessToken,
          {
            recordId: pairing.publicId,
            spotifyClientId: session.spotifyClientId,
            fieldName: 'access_token'
          },
          env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID,
          encryptionKeyring
        )
      ]);
      await createCredential(env.DB, {
        publicId: pairing.publicId,
        pairingDigest: digest,
        pairingKeyId: env.PAIRING_HMAC_ACTIVE_KEY_ID,
        spotifyClientId: session.spotifyClientId,
        refreshToken,
        accessToken,
        accessTokenExpiresAtMs,
        refreshAuthorizedAtMs: nowMs,
        nowMs
      });
      return callbackPage(200, 'authorized', pairing.token);
    }

    const [refreshToken, accessToken] = await Promise.all([
      encryptSecret(
        tokens.refreshToken,
        {
          recordId: session.credentialPublicId,
          spotifyClientId: session.spotifyClientId,
          fieldName: 'refresh_token'
        },
        env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID,
        encryptionKeyring
      ),
      encryptSecret(
        tokens.accessToken,
        {
          recordId: session.credentialPublicId,
          spotifyClientId: session.spotifyClientId,
          fieldName: 'access_token'
        },
        env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID,
        encryptionKeyring
      )
    ]);
    const updated = await reauthorizeCredential(env.DB, {
      publicId: session.credentialPublicId,
      spotifyClientId: session.spotifyClientId,
      refreshToken,
      accessToken,
      accessTokenExpiresAtMs,
      refreshAuthorizedAtMs: nowMs,
      nowMs
    });
    return updated
      ? callbackPage(200, 'reauthorized')
      : callbackPage(400, 'error', undefined, 'browser');
  } catch {
    return callbackPage(500, 'error', undefined, 'server');
  }
}

async function createAuthorizationSession(
  env: Env,
  spotifyClientId: string,
  credentialPublicId: string | null
): Promise<{ authorizeUrl: string; cookie: string }> {
  const state = createOAuthState();
  const browserNonce = randomBase64Url(32);
  const verifier = randomBase64Url(64);
  const [stateDigest, browserDigest, challenge] = await Promise.all([
    keyedDigest(state, 'oauth-state', env.OAUTH_STATE_HMAC_KEY),
    keyedDigest(browserNonce, 'oauth-browser', env.OAUTH_STATE_HMAC_KEY),
    pkceChallenge(verifier)
  ]);
  const encryptionKeyring = parseSecretKeyring(env.TOKEN_ENCRYPTION_KEYRING);
  const codeVerifier = await encryptSecret(
    verifier,
    {
      recordId: stateDigest,
      spotifyClientId,
      fieldName: 'code_verifier'
    },
    env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID,
    encryptionKeyring
  );
  const nowMs = Date.now();
  await insertOAuthSession(env.DB, {
    stateDigest,
    browserDigest,
    spotifyClientId,
    credentialPublicId,
    codeVerifier,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + oauthLifetimeMs
  });

  const authorizeUrl = new URL(authorizeEndpoint);
  authorizeUrl.search = new URLSearchParams({
    client_id: spotifyClientId,
    response_type: 'code',
    redirect_uri: redirectUri(env),
    state,
    scope: spotifyScopes,
    code_challenge_method: 'S256',
    code_challenge: challenge
  }).toString();

  return {
    authorizeUrl: authorizeUrl.toString(),
    cookie: `${oauthCookieName}=${browserNonce}; Path=/auth/callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax`
  };
}

async function readAuthStartForm(
  request: Request
): Promise<{ spotifyClientId: string; setupProof: string } | null> {
  try {
    if (
      request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !==
      'application/x-www-form-urlencoded'
    ) {
      return null;
    }

    const bytes = await readBoundedBytes(request, 2048);
    if (bytes === null) {
      return null;
    }
    const body = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true
    }).decode(bytes);
    const form = new URLSearchParams(body);
    if (
      [...form.keys()].some(
        (key) =>
          key !== 'spotifyClientId' && key !== 'legalAccepted' && key !== 'setupProof'
      ) ||
      form.getAll('spotifyClientId').length !== 1 ||
      form.getAll('legalAccepted').length !== 1 ||
      form.getAll('setupProof').length !== 1 ||
      form.get('legalAccepted') !== 'yes'
    ) {
      return null;
    }
    const spotifyClientId = form.get('spotifyClientId');
    const setupProof = form.get('setupProof');
    if (
      spotifyClientId === null ||
      !clientIdPattern.test(spotifyClientId) ||
      setupProof === null
    ) {
      return null;
    }
    return { spotifyClientId, setupProof };
  } catch {
    return null;
  }
}

async function hasValidSetupProof(setupProof: string | undefined, env: Env): Promise<boolean> {
  return setupProof !== undefined && (await verifySetupProof(setupProof, env.OAUTH_STATE_HMAC_KEY));
}

async function readLegalAcceptance(request: Request): Promise<boolean> {
  try {
    if (
      request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !==
      'application/x-www-form-urlencoded'
    ) {
      return false;
    }
    const bytes = await readBoundedBytes(request, 256);
    if (bytes === null) {
      return false;
    }
    const body = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true
    }).decode(bytes);
    const form = new URLSearchParams(body);
    return (
      [...form.keys()].every((key) => key === 'legalAccepted') &&
      form.getAll('legalAccepted').length === 1 &&
      form.get('legalAccepted') === 'yes'
    );
  } catch {
    return false;
  }
}

function parseCallback(request: Request): {
  state: string;
  browserNonce: string | null;
  code: string;
  denied: boolean;
} | null {
  const url = new URL(request.url);
  const allowedKeys = new Set(['code', 'error', 'state']);
  if ([...url.searchParams.keys()].some((key) => !allowedKeys.has(key))) {
    return null;
  }
  const states = url.searchParams.getAll('state');
  const codes = url.searchParams.getAll('code');
  const errors = url.searchParams.getAll('error');
  if (
    states.length !== 1 ||
    (codes.length === 1) === (errors.length === 1) ||
    codes.length > 1 ||
    errors.length > 1
  ) {
    return null;
  }

  const state = states[0];
  const code = codes[0] ?? '';
  const browserNonce = readCookie(request.headers.get('Cookie'), oauthCookieName);
  try {
    decodeBase64Url(state, 32);
    if (typeof browserNonce === 'string') {
      decodeBase64Url(browserNonce, 32);
    }
  } catch {
    return null;
  }
  if (codes.length === 1 && !authorizationCodePattern.test(code)) {
    return null;
  }

  return {
    state,
    browserNonce: browserNonce ?? null,
    code,
    denied: errors.length === 1
  };
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  spotifyClientId: string,
  callbackUri: string
): Promise<TokenExchangeResult> {
  try {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: spotifyClientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUri,
        code_verifier: verifier
      }).toString(),
      redirect: 'error'
    });
    if (response.status === 400) {
      return { ok: false, failure: 'token-rejected' };
    }
    if (response.status === 401) {
      return { ok: false, failure: 'token-client' };
    }
    if (response.status === 429) {
      return { ok: false, failure: 'token-rate-limited' };
    }
    if (!response.ok) {
      return { ok: false, failure: 'token-unavailable' };
    }

    const text = await readBoundedText(response, 32_768);
    if (text === null) {
      return { ok: false, failure: 'token-response' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, failure: 'token-response' };
    }
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
      return { ok: false, failure: 'token-response' };
    }
    const body = parsed as Record<string, unknown>;
    if (
      !boundedToken(body.access_token) ||
      !boundedToken(body.refresh_token) ||
      body.token_type !== 'Bearer' ||
      !Number.isInteger(body.expires_in) ||
      (body.expires_in as number) < 1 ||
      (body.expires_in as number) > 86_400
    ) {
      return { ok: false, failure: 'token-response' };
    }
    if (!hasExactSpotifyScopes(body.scope)) {
      return { ok: false, failure: 'token-scopes' };
    }
    return {
      ok: true,
      tokens: {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresInSeconds: body.expires_in as number
      }
    };
  } catch {
    return { ok: false, failure: 'token-network' };
  }
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('Authorization');
  if (
    authorization === null ||
    !authorization.startsWith('Bearer ') ||
    authorization.length > 300
  ) {
    return null;
  }
  const token = authorization.slice('Bearer '.length);
  return token.length > 0 ? token : null;
}

function redirectUri(env: Env): string {
  const base = new URL(env.PUBLIC_BASE_URL);
  if (
    base.username !== '' ||
    base.password !== '' ||
    base.search !== '' ||
    base.hash !== '' ||
    (base.pathname !== '' && base.pathname !== '/')
  ) {
    throw new Error('Invalid public base URL.');
  }
  return `${base.origin}/auth/callback`;
}

function readCookie(header: string | null, name: string): string | null | undefined {
  if (header === null) {
    return undefined;
  }
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  return values.length === 0
    ? undefined
    : values.length === 1 && values[0] !== ''
      ? values[0]
      : null;
}

function boundedToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 8192;
}

function hasExactSpotifyScopes(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const scopes = value.trim().split(/\s+/);
  const required = spotifyScopes.split(' ');
  return (
    scopes.length === required.length &&
    new Set(scopes).size === required.length &&
    required.every((scope) => scopes.includes(scope))
  );
}

async function checkAuthRateLimit(
  request: Request,
  env: Env
): Promise<'allowed' | 'limited' | 'unavailable'> {
  try {
    const connectingIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const result = await env.AUTH_RATE_LIMITER.limit({
      key: `auth:${connectingIp.slice(0, 64)}`
    });
    return result.success ? 'allowed' : 'limited';
  } catch {
    return 'unavailable';
  }
}

function authRateLimited(): Response {
  return Response.json(
    {
      ok: false,
      error: {
        kind: 'rate_limited',
        message: 'Too many authorization requests.',
        status: 429,
        retryAfterMs: 60_000
      }
    },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Retry-After': '60',
        'X-Content-Type-Options': 'nosniff'
      }
    }
  );
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  return encodeBase64Url(new Uint8Array(digest));
}
