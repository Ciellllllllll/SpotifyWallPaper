import {
  classifyConfirmationProof,
  classifySetupProof,
  createConfirmationProof,
  createOAuthState,
  createSetupProof,
  decodeBase64Url,
  decryptSecret,
  digestProtocolValue,
  encodeBase64Url,
  encryptSecret,
  MAX_ENCRYPTED_SECRET_PLAINTEXT_BYTES,
  randomBase64Url,
  type EncryptedSecret,
  type SecretKeyring
} from './crypto.js';
import type {
  CallbackConfirmation,
  Credential,
  CredentialInput,
  OAuthSession,
  OAuthSessionInput,
  ReauthorizeCredentialInput,
  SetupSession,
  SetupSessionInput
} from './db.js';
import {
  discardBoundedBody,
  readBoundedBytes,
  readBoundedText
} from './http.js';
import { canonicalIssuer, readSingleCookie } from './issuer.js';
import {
  activePairingKey,
  generatePairingToken,
  pairingDigest,
  parsePairingToken
} from './pairing.js';
import { FixedWindowLimiter } from './rate-limit.js';
import type { CredentialLock } from './credential-lock.js';

const SETUP_COOKIE = '__Host-swp-setup';
const OAUTH_COOKIE = '__Host-swp-oauth-v2';
const CONFIRM_COOKIE = '__Host-swp-confirm';
const SCOPES = [
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state'
].join(' ');

type ConfirmationSecrets = {
  authorizationCode: EncryptedSecret;
  codeVerifier: EncryptedSecret;
};

export type AuthStore = {
  createSetupSession(input: SetupSessionInput): Promise<boolean>;
  consumeSetupSession(
    sessionId: string,
    browserDigest: string,
    expiresAtMs: number,
    nowMs: number
  ): Promise<SetupSession | null>;
  insertOAuthSession(input: OAuthSessionInput): Promise<void>;
  consumeOAuthSession(
    stateDigest: string,
    browserDigest: string,
    nowMs: number
  ): Promise<OAuthSession | null>;
  moveOAuthSessionToConfirmation(
    input: {
      stateDigest: string;
      confirmationId: string;
      browserDigest: string;
      createdAtMs: number;
      expiresAtMs: number;
    },
    encryptSecrets: (
      session: OAuthSession,
      confirmationId: string
    ) => Promise<ConfirmationSecrets>
  ): Promise<CallbackConfirmation | null>;
  findCallbackConfirmation(
    browserDigest: string,
    nowMs: number
  ): Promise<Pick<CallbackConfirmation, 'confirmationId' | 'expiresAtMs'> | null>;
  consumeCallbackConfirmation(
    confirmationId: string,
    browserDigest: string,
    expiresAtMs: number,
    nowMs: number
  ): Promise<CallbackConfirmation | null>;
  isDeletionTombstoned(publicId: string): Promise<boolean>;
  findCredentialByPairingToken(
    token: string,
    keyring: SecretKeyring
  ): Promise<Credential | null>;
  createCredential(input: CredentialInput): Promise<void>;
  reauthorizeCredential(input: ReauthorizeCredentialInput): Promise<boolean>;
};

export interface AuthDependencies {
  store: AuthStore;
  oauthHmacKey: string;
  encryptionKeyring: SecretKeyring;
  encryptionActiveKeyId: string;
  pairingKeyring: SecretKeyring;
  pairingActiveKeyId: string;
  publicBaseUrl: string;
  authorizeEndpoint: string;
  tokenEndpoint: string;
  fetch: typeof fetch;
  credentialLock: CredentialLock;
  now: () => number;
  privacyVersion: string;
  eulaVersion: string;
}

export interface AuthHandlers {
  setup(request: Request): Promise<Response>;
  authStart(request: Request): Promise<Response>;
  authCallback(request: Request): Promise<Response>;
  authConfirmGet(request: Request): Promise<Response>;
  authConfirmPost(request: Request): Promise<Response>;
  reauthorize(request: Request): Promise<Response>;
}

type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
};

export function createAuthHandlers(dependencies: AuthDependencies): AuthHandlers {
  const authLimiter = new FixedWindowLimiter(20, 4096, dependencies.now);
  const dbLimiter = new FixedWindowLimiter(6000, 4096, dependencies.now);
  const publicOrigin = validatedOrigin(dependencies.publicBaseUrl);
  const redirectUri = publicOrigin + '/auth/callback';

  async function limit(request: Request): Promise<string | Response> {
    const issuer = canonicalIssuer(request.headers.get('X-SWP-Client-IP') ?? '');
    if (issuer === null) return fixedError(400, 'REQUEST_INVALID');
    const digest = await digestProtocolValue(
      'setup-issuer-v2',
      issuer,
      dependencies.oauthHmacKey
    );
    const broad = dbLimiter.take(digest);
    const narrow = authLimiter.take(digest);
    if (broad.allowed && narrow.allowed) return digest;
    return rateLimited(
      !broad.allowed
        ? broad.retryAfterSeconds
        : !narrow.allowed
          ? narrow.retryAfterSeconds
          : 60
    );
  }

  async function authorizationSession(
    spotifyClientId: string,
    credentialPublicId: string | null
  ): Promise<{ authorizeUrl: string; cookie: string }> {
    const state = createOAuthState();
    const browserNonce = randomBase64Url(32);
    const verifier = randomBase64Url(64);
    const [stateDigest, browserDigest, challenge] = await Promise.all([
      digestProtocolValue('oauth-state-v2', state, dependencies.oauthHmacKey),
      digestProtocolValue(
        'oauth-browser-v2',
        browserNonce,
        dependencies.oauthHmacKey
      ),
      pkceChallenge(verifier)
    ]);
    const codeVerifier = await encryptSecret(
      verifier,
      {
        recordId: stateDigest,
        spotifyClientId,
        fieldName: 'code_verifier'
      },
      dependencies.encryptionActiveKeyId,
      dependencies.encryptionKeyring
    );
    const nowMs = dependencies.now();
    await dependencies.store.insertOAuthSession({
      stateDigest,
      browserDigest,
      spotifyClientId,
      credentialPublicId,
      codeVerifier,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + 600_000
    });
    const url = new URL(dependencies.authorizeEndpoint);
    url.search = new URLSearchParams({
      client_id: spotifyClientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
      scope: SCOPES,
      code_challenge_method: 'S256',
      code_challenge: challenge
    }).toString();
    return {
      authorizeUrl: url.toString(),
      cookie: setCookie(OAUTH_COOKIE, browserNonce, 600, 'Lax')
    };
  }

  async function finish(session: OAuthSession, code: string): Promise<Response> {
    const complete = async (): Promise<Response> => {
      if (
        session.credentialPublicId !== null &&
        (await dependencies.store.isDeletionTombstoned(session.credentialPublicId))
      ) {
        return callbackPage(400, 'AUTHORIZATION_INVALID');
      }
      const verifier = await decryptSecret(
        session.codeVerifier,
        {
          recordId: session.stateDigest,
          spotifyClientId: session.spotifyClientId,
          fieldName: 'code_verifier'
        },
        dependencies.encryptionKeyring
      );
      const tokens = await exchangeCode(
        code,
        verifier,
        session.spotifyClientId,
        redirectUri,
        dependencies
      );
      return tokens === null
        ? callbackPage(502, 'TOKEN_EXCHANGE_FAILED')
        : persistTokens(session, tokens, dependencies);
    };
    return session.credentialPublicId === null
      ? complete()
      : dependencies.credentialLock(session.credentialPublicId, complete);
  }

  return {
    async setup(request) {
      const issuerDigest = await limit(request);
      if (issuerDigest instanceof Response) return issuerDigest;
      const previous = readSingleCookie(request.headers.get('Cookie'), SETUP_COOKIE);
      const browserNonce = randomBase64Url(32);
      const sessionId = randomBase64Url(16);
      const nowMs = dependencies.now();
      const [browserDigest, previousBrowserDigest] = await Promise.all([
        digestProtocolValue(
          'setup-browser-v2',
          browserNonce,
          dependencies.oauthHmacKey
        ),
        previous.kind === 'valid'
          ? digestProtocolValue(
              'setup-browser-v2',
              previous.value,
              dependencies.oauthHmacKey
            )
          : Promise.resolve(null)
      ]);
      const expiresAtMs = nowMs + 600_000;
      const inserted = await dependencies.store.createSetupSession({
        sessionId,
        browserDigest,
        issuerDigest,
        previousBrowserDigest,
        privacyVersion: dependencies.privacyVersion,
        eulaVersion: dependencies.eulaVersion,
        createdAtMs: nowMs,
        expiresAtMs
      });
      if (!inserted) return rateLimited(60);
      const proof = await createSetupProof(
        sessionId,
        expiresAtMs,
        dependencies.oauthHmacKey
      );
      const response = setupPage(proof);
      response.headers.append(
        'Set-Cookie',
        setCookie(SETUP_COOKIE, browserNonce, 600, 'Strict')
      );
      return response;
    },

    async authStart(request) {
      const limited = await limit(request);
      if (limited instanceof Response) return limited;
      if (!sameOrigin(request, publicOrigin)) {
        return clearCookieResponse(
          fixedError(403, 'SAME_ORIGIN_REQUIRED'),
          SETUP_COOKIE
        );
      }
      const form = await exactForm(request, [
        'spotifyClientId',
        'setupProof',
        'legalAccepted'
      ]);
      const cookie = readSingleCookie(request.headers.get('Cookie'), SETUP_COOKIE);
      const proof = await classifySetupProof(
        form?.get('setupProof') ?? '',
        dependencies.oauthHmacKey,
        dependencies.now()
      );
      const clientId = form?.get('spotifyClientId') ?? '';
      if (
        form?.get('legalAccepted') !== 'yes' ||
        !/^[A-Za-z0-9]{16,64}$/u.test(clientId) ||
        cookie.kind !== 'valid' ||
        proof === null
      ) {
        return clearCookieResponse(fixedError(400, 'SETUP_INVALID'), SETUP_COOKIE);
      }
      const browserDigest = await digestProtocolValue(
        'setup-browser-v2',
        cookie.value,
        dependencies.oauthHmacKey
      );
      const session = await dependencies.store.consumeSetupSession(
        proof.sessionId,
        browserDigest,
        proof.expiresAtMs,
        dependencies.now()
      );
      if (
        session === null ||
        session.privacyVersion !== dependencies.privacyVersion ||
        session.eulaVersion !== dependencies.eulaVersion
      ) {
        return clearCookieResponse(fixedError(400, 'SETUP_INVALID'), SETUP_COOKIE);
      }
      const authorization = await authorizationSession(clientId, null);
      const response = new Response(null, {
        status: 303,
        headers: { ...SAFE_HEADERS, Location: authorization.authorizeUrl }
      });
      response.headers.append('Set-Cookie', clearCookie(SETUP_COOKIE, 'Strict'));
      response.headers.append('Set-Cookie', authorization.cookie);
      return response;
    },

    async authCallback(request) {
      const limited = await limit(request);
      if (limited instanceof Response) return limited;
      const callback = parseCallback(request);
      if (callback === null) return callbackPage(400, 'CALLBACK_INVALID');
      const stateDigest = await digestProtocolValue(
        'oauth-state-v2',
        callback.state,
        dependencies.oauthHmacKey
      );
      const cookie = readSingleCookie(request.headers.get('Cookie'), OAUTH_COOKIE);
      if (cookie.kind === 'invalid') return callbackPage(400, 'CALLBACK_INVALID');
      if (cookie.kind === 'missing') {
        if (callback.code === null) return callbackPage(400, 'CALLBACK_INVALID');
        const confirmationId = randomBase64Url(16);
        const confirmationCookie = randomBase64Url(32);
        const nowMs = dependencies.now();
        const browserDigest = await digestProtocolValue(
          'oauth-confirm-browser-v1',
          confirmationCookie,
          dependencies.oauthHmacKey
        );
        const moved = await dependencies.store.moveOAuthSessionToConfirmation(
          {
            stateDigest,
            confirmationId,
            browserDigest,
            createdAtMs: nowMs,
            expiresAtMs: nowMs + 300_000
          },
          async (session, boundId) => {
            const verifier = await decryptSecret(
              session.codeVerifier,
              {
                recordId: session.stateDigest,
                spotifyClientId: session.spotifyClientId,
                fieldName: 'code_verifier'
              },
              dependencies.encryptionKeyring
            );
            return {
              authorizationCode: await encryptSecret(
                callback.code as string,
                confirmationContext(boundId, session.spotifyClientId, 'authorizationCode'),
                dependencies.encryptionActiveKeyId,
                dependencies.encryptionKeyring
              ),
              codeVerifier: await encryptSecret(
                verifier,
                confirmationContext(boundId, session.spotifyClientId, 'pkceVerifier'),
                dependencies.encryptionActiveKeyId,
                dependencies.encryptionKeyring
              )
            };
          }
        );
        if (moved === null) return callbackPage(400, 'CALLBACK_INVALID');
        const response = new Response(null, {
          status: 303,
          headers: { ...SAFE_HEADERS, Location: '/auth/confirm' }
        });
        response.headers.append(
          'Set-Cookie',
          setCookie(CONFIRM_COOKIE, confirmationCookie, 300, 'Lax')
        );
        return response;
      }
      try {
        const browserDigest = await digestProtocolValue(
          'oauth-browser-v2',
          cookie.value,
          dependencies.oauthHmacKey
        );
        const session = await dependencies.store.consumeOAuthSession(
          stateDigest,
          browserDigest,
          dependencies.now()
        );
        if (session === null || callback.code === null) {
          return clearCookieResponse(
            callbackPage(400, 'CALLBACK_INVALID'),
            OAUTH_COOKIE
          );
        }
        return clearCookieResponse(await finish(session, callback.code), OAUTH_COOKIE);
      } catch {
        return clearCookieResponse(
          callbackPage(500, 'CALLBACK_FAILED'),
          OAUTH_COOKIE
        );
      }
    },

    async authConfirmGet(request) {
      const limited = await limit(request);
      if (limited instanceof Response) return limited;
      const cookie = readSingleCookie(request.headers.get('Cookie'), CONFIRM_COOKIE);
      if (cookie.kind !== 'valid') return callbackPage(400, 'CONFIRMATION_INVALID');
      const browserDigest = await digestProtocolValue(
        'oauth-confirm-browser-v1',
        cookie.value,
        dependencies.oauthHmacKey
      );
      const row = await dependencies.store.findCallbackConfirmation(
        browserDigest,
        dependencies.now()
      );
      if (row === null) return callbackPage(400, 'CONFIRMATION_INVALID');
      const proof = await createConfirmationProof(
        row.confirmationId,
        row.expiresAtMs,
        dependencies.oauthHmacKey
      );
      return formPage(
        'Confirm Spotify authorization',
        '/auth/confirm',
        '<input type="hidden" name="confirmationProof" value="' +
          proof +
          '">' +
          legalControl()
      );
    },

    async authConfirmPost(request) {
      const limited = await limit(request);
      if (limited instanceof Response) return limited;
      if (!sameOrigin(request, publicOrigin)) {
        return clearCookieResponse(
          fixedError(403, 'SAME_ORIGIN_REQUIRED'),
          CONFIRM_COOKIE
        );
      }
      const form = await exactForm(request, ['confirmationProof', 'legalAccepted']);
      const cookie = readSingleCookie(request.headers.get('Cookie'), CONFIRM_COOKIE);
      const proof = await classifyConfirmationProof(
        form?.get('confirmationProof') ?? '',
        dependencies.oauthHmacKey,
        dependencies.now()
      );
      if (
        form?.get('legalAccepted') !== 'yes' ||
        cookie.kind !== 'valid' ||
        proof === null
      ) {
        return clearCookieResponse(
          callbackPage(400, 'CONFIRMATION_INVALID'),
          CONFIRM_COOKIE
        );
      }
      try {
        const browserDigest = await digestProtocolValue(
          'oauth-confirm-browser-v1',
          cookie.value,
          dependencies.oauthHmacKey
        );
        const confirmation = await dependencies.store.consumeCallbackConfirmation(
          proof.confirmationId,
          browserDigest,
          proof.expiresAtMs,
          dependencies.now()
        );
        if (confirmation === null) {
          return clearCookieResponse(
            callbackPage(400, 'CONFIRMATION_INVALID'),
            CONFIRM_COOKIE
          );
        }
        const [code, verifier] = await Promise.all([
          decryptSecret(
            confirmation.authorizationCode,
            confirmationContext(
              confirmation.confirmationId,
              confirmation.spotifyClientId,
              'authorizationCode'
            ),
            dependencies.encryptionKeyring
          ),
          decryptSecret(
            confirmation.codeVerifier,
            confirmationContext(
              confirmation.confirmationId,
              confirmation.spotifyClientId,
              'pkceVerifier'
            ),
            dependencies.encryptionKeyring
          )
        ]);
        const tokens = await exchangeCode(
          code,
          verifier,
          confirmation.spotifyClientId,
          redirectUri,
          dependencies
        );
        const response =
          tokens === null
            ? callbackPage(502, 'TOKEN_EXCHANGE_FAILED')
            : await persistTokens(
                confirmationAsInitialSession(confirmation),
                tokens,
                dependencies
              );
        return clearCookieResponse(response, CONFIRM_COOKIE);
      } catch {
        return clearCookieResponse(
          callbackPage(500, 'CONFIRMATION_FAILED'),
          CONFIRM_COOKIE
        );
      }
    },

    async reauthorize(request) {
      const limited = await limit(request);
      if (limited instanceof Response) return limited;
      if (!sameOrigin(request, publicOrigin)) {
        return fixedError(403, 'SAME_ORIGIN_REQUIRED');
      }
      const form = await exactForm(request, ['legalAccepted']);
      const token = bearer(request);
      const parsed = token === null ? null : parsePairingToken(token);
      if (form?.get('legalAccepted') !== 'yes' || token === null || parsed === null) {
        return fixedError(401, 'PAIRING_TOKEN_INVALID');
      }
      return dependencies.credentialLock(parsed.publicId, async () => {
        if (await dependencies.store.isDeletionTombstoned(parsed.publicId)) {
          return fixedError(401, 'PAIRING_TOKEN_INVALID');
        }
        const credential = await dependencies.store.findCredentialByPairingToken(
          token,
          dependencies.pairingKeyring
        );
        if (credential === null) return fixedError(401, 'PAIRING_TOKEN_INVALID');
        const authorization = await authorizationSession(
          credential.spotifyClientId,
          credential.publicId
        );
        const response = Response.json(
          { ok: true, value: { authorizeUrl: authorization.authorizeUrl } },
          { headers: SAFE_HEADERS }
        );
        response.headers.append('Set-Cookie', authorization.cookie);
        return response;
      });
    }
  };
}

async function persistTokens(
  session: OAuthSession,
  tokens: TokenResponse,
  dependencies: AuthDependencies
): Promise<Response> {
  const nowMs = dependencies.now();
  const expiresAtMs = nowMs + tokens.expiresInSeconds * 1000;
  if (session.credentialPublicId === null) {
    const pairing = generatePairingToken();
    const pairingKey = activePairingKey(
      dependencies.pairingKeyring,
      dependencies.pairingActiveKeyId
    );
    const [digest, refreshToken, accessToken] = await Promise.all([
      pairingDigest(pairing.publicId, pairing.secret, pairingKey),
      encryptCredentialToken(
        tokens.refreshToken,
        pairing.publicId,
        session.spotifyClientId,
        'refresh_token',
        dependencies
      ),
      encryptCredentialToken(
        tokens.accessToken,
        pairing.publicId,
        session.spotifyClientId,
        'access_token',
        dependencies
      )
    ]);
    await dependencies.store.createCredential({
      publicId: pairing.publicId,
      pairingDigest: digest,
      pairingKeyId: dependencies.pairingActiveKeyId,
      spotifyClientId: session.spotifyClientId,
      refreshToken,
      accessToken,
      accessTokenExpiresAtMs: expiresAtMs,
      refreshAuthorizedAtMs: nowMs,
      nowMs
    });
    return tokenPage(pairing.token);
  }
  const [refreshToken, accessToken] = await Promise.all([
    encryptCredentialToken(
      tokens.refreshToken,
      session.credentialPublicId,
      session.spotifyClientId,
      'refresh_token',
      dependencies
    ),
    encryptCredentialToken(
      tokens.accessToken,
      session.credentialPublicId,
      session.spotifyClientId,
      'access_token',
      dependencies
    )
  ]);
  const updated = await dependencies.store.reauthorizeCredential({
    publicId: session.credentialPublicId,
    spotifyClientId: session.spotifyClientId,
    refreshToken,
    accessToken,
    accessTokenExpiresAtMs: expiresAtMs,
    refreshAuthorizedAtMs: nowMs,
    nowMs
  });
  return updated
    ? callbackPage(200, 'REAUTHORIZED')
    : callbackPage(400, 'AUTHORIZATION_INVALID');
}

function encryptCredentialToken(
  value: string,
  publicId: string,
  spotifyClientId: string,
  fieldName: 'access_token' | 'refresh_token',
  dependencies: AuthDependencies
): Promise<EncryptedSecret> {
  return encryptSecret(
    value,
    { recordId: publicId, spotifyClientId, fieldName },
    dependencies.encryptionActiveKeyId,
    dependencies.encryptionKeyring
  );
}

async function exchangeCode(
  code: string,
  verifier: string,
  spotifyClientId: string,
  redirectUri: string,
  dependencies: AuthDependencies
): Promise<TokenResponse | null> {
  try {
    const response = await dependencies.fetch(dependencies.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: spotifyClientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier
      }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      await discardBoundedBody(response, 32_768);
      return null;
    }
    const text = await readBoundedText(response, 32_768);
    if (text === null) return null;
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
      return null;
    }
    const value = parsed as Record<string, unknown>;
    if (
      !boundedToken(value.access_token) ||
      !boundedToken(value.refresh_token) ||
      value.token_type !== 'Bearer' ||
      !Number.isInteger(value.expires_in) ||
      (value.expires_in as number) < 1 ||
      (value.expires_in as number) > 86_400 ||
      !exactScopes(value.scope)
    ) {
      return null;
    }
    return {
      accessToken: value.access_token,
      refreshToken: value.refresh_token,
      expiresInSeconds: value.expires_in as number
    };
  } catch {
    return null;
  }
}

function confirmationContext(
  confirmationId: string,
  spotifyClientId: string,
  fieldName: 'authorizationCode' | 'pkceVerifier'
) {
  return {
    kind: 'confirmation' as const,
    recordId: confirmationId,
    spotifyClientId,
    fieldName
  };
}

function confirmationAsInitialSession(row: CallbackConfirmation): OAuthSession {
  return {
    stateDigest: '',
    browserDigest: '',
    spotifyClientId: row.spotifyClientId,
    credentialPublicId: null,
    codeVerifier: row.codeVerifier,
    createdAtMs: row.createdAtMs,
    expiresAtMs: row.expiresAtMs,
    consumedAtMs: null
  };
}

function parseCallback(request: Request): { state: string; code: string | null } | null {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !['code', 'error', 'state'].includes(key))) {
    return null;
  }
  const states = params.getAll('state');
  const codes = params.getAll('code');
  const errors = params.getAll('error');
  if (
    states.length !== 1 ||
    codes.length > 1 ||
    errors.length > 1 ||
    (codes.length === 1) === (errors.length === 1)
  ) {
    return null;
  }
  const match = /^swpo2\.([A-Za-z0-9_-]{43})$/u.exec(states[0] ?? '');
  if (match === null) return null;
  try {
    decodeBase64Url(match[1], 32);
  } catch {
    return null;
  }
  const code = codes[0] ?? null;
  if (code !== null && !/^[\x21-\x7e]{1,2048}$/u.test(code)) return null;
  return { state: states[0], code };
}

async function exactForm(
  request: Request,
  keys: readonly string[]
): Promise<URLSearchParams | null> {
  try {
    if (
      request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !==
      'application/x-www-form-urlencoded'
    ) {
      return null;
    }
    const bytes = await readBoundedBytes(request, 4096);
    if (bytes === null) return null;
    const form = new URLSearchParams(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    );
    return [...form.keys()].some((key) => !keys.includes(key)) ||
      keys.some((key) => form.getAll(key).length !== 1)
      ? null
      : form;
  } catch {
    return null;
  }
}

function validatedOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('Invalid public base URL.');
  }
  return url.origin;
}

function sameOrigin(request: Request, expected: string): boolean {
  return new URL(request.url).origin === expected && request.headers.get('Origin') === expected;
}

function bearer(request: Request): string | null {
  const value = request.headers.get('Authorization');
  return value !== null &&
    value.startsWith('Bearer ') &&
    value.length > 7 &&
    value.length <= 300
    ? value.slice(7)
    : null;
}

function setCookie(
  name: string,
  value: string,
  maxAge: number,
  sameSite: 'Lax' | 'Strict'
): string {
  return (
    name +
    '=' +
    value +
    '; Path=/; Max-Age=' +
    maxAge +
    '; HttpOnly; Secure; SameSite=' +
    sameSite
  );
}

function clearCookie(name: string, sameSite: 'Lax' | 'Strict'): string {
  return (
    name +
    '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=' +
    sameSite
  );
}

function clearCookieResponse(response: Response, name: string): Response {
  response.headers.append(
    'Set-Cookie',
    clearCookie(name, name === SETUP_COOKIE ? 'Strict' : 'Lax')
  );
  return response;
}

const SAFE_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

function formPage(title: string, action: string, fields: string): Response {
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' +
    title +
    '</title></head><body><main><h1>' +
    title +
    '</h1><form method="post" action="' +
    action +
    '">' +
    fields +
    '<button type="submit">Continue</button></form></main></body></html>';
  return new Response(html, {
    headers: { ...SAFE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' }
  });
}

function setupPage(proof: string): Response {
  const nonce = randomBase64Url(16);
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotify setup</title></head><body><main><h1>Spotify setup</h1>
<form method="post" action="/auth/start"><label>Spotify Client ID <input name="spotifyClientId" required minlength="16" maxlength="64" pattern="[A-Za-z0-9]+"></label><input type="hidden" name="setupProof" value="${proof}">${legalControl()}<button type="submit">Authorize Spotify</button></form>
<form id="reauthorize-form"><label>Existing Pairing Token <input id="reauthorize-token" type="password" autocomplete="off" required></label>${legalControl()}<button type="submit">Reauthorize Spotify</button></form>
<form id="delete-account-form"><label>Pairing Token to delete <input id="delete-token" type="password" autocomplete="off" required></label><button type="submit">Delete backend account</button></form>
<p id="setup-status" aria-live="polite"></p></main><script nonce="${nonce}">
const status=document.getElementById('setup-status');
document.getElementById('reauthorize-form').addEventListener('submit',async(event)=>{event.preventDefault();const input=document.getElementById('reauthorize-token');let token=input.value;input.value='';try{const response=await fetch('/auth/reauthorize',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({legalAccepted:'yes'}),credentials:'same-origin',redirect:'error',referrerPolicy:'no-referrer'});token='';if(!response.ok)throw new Error();const body=await response.json();if(!body.ok||typeof body.value?.authorizeUrl!=='string')throw new Error();location.assign(body.value.authorizeUrl)}catch{token='';status.textContent='Reauthorization could not start.'}});
document.getElementById('delete-account-form').addEventListener('submit',async(event)=>{event.preventDefault();const input=document.getElementById('delete-token');let token=input.value;input.value='';try{const response=await fetch('/api/account',{method:'DELETE',headers:{Authorization:'Bearer '+token},credentials:'same-origin',redirect:'error',referrerPolicy:'no-referrer'});token='';if(!response.ok)throw new Error();status.textContent='Backend account deleted.'}catch{token='';status.textContent='Backend account could not be deleted.'}});
</script></body></html>`,
    {
      headers: {
        ...SAFE_HEADERS,
        'Content-Security-Policy':
          `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; ` +
          "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        'Content-Type': 'text/html; charset=utf-8'
      }
    }
  );
}

function legalControl(): string {
  return '<label><input type="checkbox" name="legalAccepted" value="yes" required> I accept the <a href="/privacy">Privacy Notice</a> and <a href="/terms">EULA</a>.</label>';
}

function tokenPage(pairingToken: string): Response {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' +
      'Spotify authorized</title></head><body><main><h1>Spotify authorized</h1>' +
      '<p>Copy this Pairing Token now. It will not be shown again.</p><pre>' +
      escapeHtml(pairingToken) +
      '</pre></main></body></html>',
    {
      status: 200,
      headers: { ...SAFE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' }
    }
  );
}

function callbackPage(status: number, code: string): Response {
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' +
      'Spotify authorization</title></head><body><main><h1>' +
      (status < 400 ? 'Authorization complete' : 'Authorization failed') +
      '</h1><p><code>' +
      escapeHtml(code) +
      '</code></p></main></body></html>',
    {
      status,
      headers: { ...SAFE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' }
    }
  );
}

function fixedError(status: number, code: string): Response {
  return Response.json(
    {
      ok: false,
      error: {
        kind: status === 429 ? 'rate_limited' : 'unavailable',
        status,
        code
      }
    },
    { status, headers: SAFE_HEADERS }
  );
}

function rateLimited(retryAfterSeconds: number): Response {
  const response = fixedError(429, 'RATE_LIMITED');
  response.headers.set('Retry-After', String(retryAfterSeconds));
  return response;
}

function boundedToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <=
      MAX_ENCRYPTED_SECRET_PLAINTEXT_BYTES
  );
}

function exactScopes(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const actual = value.trim().split(/\s+/u);
  const expected = SCOPES.split(' ');
  return (
    actual.length === expected.length &&
    new Set(actual).size === expected.length &&
    expected.every((scope) => actual.includes(scope))
  );
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  return encodeBase64Url(new Uint8Array(digest));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
