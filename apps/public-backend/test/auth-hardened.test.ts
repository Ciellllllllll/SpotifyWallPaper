import { describe, expect, it, vi } from 'vitest';

import {
  createAuthHandlers,
  type AuthDependencies,
  type AuthStore
} from '../src/auth.js';
import {
  createConfirmationProof,
  digestProtocolValue,
  encryptSecret,
  randomBase64Url,
  type SecretKeyring
} from '../src/crypto.js';
import { createCredentialLock } from '../src/credential-lock.js';
import type {
  CallbackConfirmation,
  OAuthSession,
  SetupSessionInput
} from '../src/db.js';

const hmacKey = 'ggggggggggggggggggggggggggggggggggggggggggg';
const encryptionKeyring: SecretKeyring = {
  current: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
};
const pairingKeyring: SecretKeyring = {
  current: 'QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ'
};
const publicBaseUrl = 'https://ciel-spotify-wallpaper.duckdns.org';
const state = `swpo2.${'A'.repeat(43)}`;
const oauthCookie = 'A'.repeat(43);

const request = (
  path: string,
  init: RequestInit = {},
  cookie?: string
): Request =>
  new Request(`${publicBaseUrl}${path}`, {
    ...init,
    headers: {
      'X-SWP-Client-IP': '192.0.2.1',
      ...(cookie === undefined ? {} : { Cookie: cookie }),
      ...Object.fromEntries(new Headers(init.headers))
    }
  });

async function oauthSession(credentialPublicId: string | null): Promise<OAuthSession> {
  const stateDigest = await digestProtocolValue('oauth-state-v2', state, hmacKey);
  return {
    stateDigest,
    browserDigest: await digestProtocolValue(
      'oauth-browser-v2',
      oauthCookie,
      hmacKey
    ),
    spotifyClientId: 'ClientId123456789',
    credentialPublicId,
    codeVerifier: await encryptSecret(
      'verifier-value',
      {
        recordId: stateDigest,
        spotifyClientId: 'ClientId123456789',
        fieldName: 'code_verifier'
      },
      'current',
      encryptionKeyring
    ),
    createdAtMs: 1_700_000_000_000,
    expiresAtMs: 1_700_000_600_000,
    consumedAtMs: null
  };
}

function baseStore(overrides: Partial<AuthStore> = {}): AuthStore {
  const unavailable = async (): Promise<never> => {
    throw new Error('unexpected store call');
  };
  return {
    createSetupSession: unavailable,
    consumeSetupSession: unavailable,
    insertOAuthSession: unavailable,
    consumeOAuthSession: unavailable,
    moveOAuthSessionToConfirmation: unavailable,
    findCallbackConfirmation: unavailable,
    consumeCallbackConfirmation: unavailable,
    isDeletionTombstoned: unavailable,
    findCredentialByPairingToken: unavailable,
    createCredential: unavailable,
    reauthorizeCredential: unavailable,
    ...overrides
  } as AuthStore;
}

function dependencies(store: AuthStore, fetchImpl: typeof fetch): AuthDependencies {
  return {
    store,
    oauthHmacKey: hmacKey,
    encryptionKeyring,
    encryptionActiveKeyId: 'current',
    pairingKeyring,
    pairingActiveKeyId: 'current',
    publicBaseUrl,
    authorizeEndpoint: 'https://accounts.spotify.test/authorize',
    tokenEndpoint: 'https://accounts.spotify.test/api/token',
    fetch: fetchImpl,
    credentialLock: createCredentialLock(),
    now: () => 1_700_000_100_000,
    privacyVersion: '2026-08-31',
    eulaVersion: '2026-08-31'
  };
}

const tokenResponse = (): Response =>
  Response.json({
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    token_type: 'Bearer',
    expires_in: 3600,
    scope:
      'user-read-playback-state user-read-currently-playing user-modify-playback-state'
  });

describe('hardened callback paths', () => {
  it('moves an initial Cookie-less callback to pending confirmation without exchange', async () => {
    const session = await oauthSession(null);
    const move = vi.fn(async (_input, encryptSecrets) => {
      const secrets = await encryptSecrets(session, _input.confirmationId);
      return {
        confirmationId: _input.confirmationId,
        browserDigest: 'D'.repeat(43),
        spotifyClientId: session.spotifyClientId,
        authorizationCode: secrets.authorizationCode,
        codeVerifier: secrets.codeVerifier,
        createdAtMs: 1_700_000_100_000,
        expiresAtMs: 1_700_000_400_000
      } satisfies CallbackConfirmation;
    });
    const fetchImpl = vi.fn(async () => {
      throw new Error('must not exchange');
    }) as unknown as typeof fetch;
    const handlers = createAuthHandlers(
      dependencies(baseStore({ moveOAuthSessionToConfirmation: move }), fetchImpl)
    );

    const response = await handlers.authCallback(
      request(`/auth/callback?code=authorization-code&state=${state}`)
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/auth/confirm');
    expect(response.headers.get('Set-Cookie')).toContain('__Host-swp-confirm=');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(move).toHaveBeenCalledTimes(1);
  });

  it('exchanges an initial callback once only with the exact OAuth Cookie', async () => {
    const session = await oauthSession(null);
    const consume = vi
      .fn<() => Promise<OAuthSession | null>>()
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(null);
    const createCredential = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => tokenResponse()) as unknown as typeof fetch;
    const handlers = createAuthHandlers(
      dependencies(
        baseStore({
          consumeOAuthSession: consume,
          createCredential
        }),
        fetchImpl
      )
    );
    const callback = () =>
      request(
        `/auth/callback?code=authorization-code&state=${state}`,
        {},
        `__Host-swp-oauth-v2=${oauthCookie}`
      );

    const first = await handlers.authCallback(callback());
    const second = await handlers.authCallback(callback());

    expect(first.status).toBe(200);
    expect(await first.text()).toContain('swpb1.');
    expect(second.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(createCredential).toHaveBeenCalledTimes(1);
  });

  it('clears the OAuth Cookie when consumed callback persistence fails', async () => {
    const session = await oauthSession(null);
    const consume = vi.fn(async () => session);
    const createCredential = vi.fn(async () => {
      throw new Error('storage failure');
    });
    const handlers = createAuthHandlers(
      dependencies(
        baseStore({ consumeOAuthSession: consume, createCredential }),
        vi.fn(async () => tokenResponse()) as unknown as typeof fetch
      )
    );

    const response = await handlers.authCallback(
      request(
        `/auth/callback?code=authorization-code&state=${state}`,
        {},
        `__Host-swp-oauth-v2=${oauthCookie}`
      )
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('Set-Cookie')).toContain(
      '__Host-swp-oauth-v2=; Path=/; Max-Age=0'
    );
    expect(consume).toHaveBeenCalledOnce();
    expect(createCredential).toHaveBeenCalledOnce();
  });

  it('consumes a failed token exchange response body', async () => {
    const session = await oauthSession(null);
    const consume = vi.fn(async () => session);
    let consumed = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        consumed = true;
        controller.enqueue(new TextEncoder().encode('upstream details'));
        controller.close();
      }
    });
    const fetchImpl = vi.fn(
      async () => new Response(body, { status: 500 })
    ) as unknown as typeof fetch;
    const handlers = createAuthHandlers(
      dependencies(
        baseStore({ consumeOAuthSession: consume }),
        fetchImpl
      )
    );

    const response = await handlers.authCallback(
      request(
        `/auth/callback?code=authorization-code&state=${state}`,
        {},
        `__Host-swp-oauth-v2=${oauthCookie}`
      )
    );

    expect(response.status).toBe(502);
    expect(consumed).toBe(true);
  });

  it('cancels an oversized successful token response before parsing', async () => {
    const session = await oauthSession(null);
    const consume = vi.fn(async () => session);
    const cancel = vi.fn(async () => undefined);
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Length': '32769' }),
      body: { cancel }
    } as unknown as Response;
    const handlers = createAuthHandlers(
      dependencies(
        baseStore({ consumeOAuthSession: consume }),
        vi.fn(async () => response) as unknown as typeof fetch
      )
    );

    const result = await handlers.authCallback(
      request(
        `/auth/callback?code=authorization-code&state=${state}`,
        {},
        `__Host-swp-oauth-v2=${oauthCookie}`
      )
    );

    expect(result.status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels a successful token response when its reader fails', async () => {
    const session = await oauthSession(null);
    const consume = vi.fn(async () => session);
    const cancel = vi.fn(async () => undefined);
    const reader = {
      read: vi.fn(async () => {
        throw new Error('body read failed');
      }),
      cancel,
      releaseLock: vi.fn()
    };
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: { getReader: () => reader }
    } as unknown as Response;
    const handlers = createAuthHandlers(
      dependencies(
        baseStore({ consumeOAuthSession: consume }),
        vi.fn(async () => response) as unknown as typeof fetch
      )
    );

    const result = await handlers.authCallback(
      request(
        `/auth/callback?code=authorization-code&state=${state}`,
        {},
        `__Host-swp-oauth-v2=${oauthCookie}`
      )
    );

    expect(result.status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('never rescues reauthorization through Cookie-less confirmation', async () => {
    const move = vi.fn(async () => null);
    const fetchImpl = vi.fn(async () => tokenResponse()) as unknown as typeof fetch;
    const handlers = createAuthHandlers(
      dependencies(baseStore({ moveOAuthSessionToConfirmation: move }), fetchImpl)
    );

    const response = await handlers.authCallback(
      request(`/auth/callback?code=authorization-code&state=${state}`)
    );

    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reauthorizes the same Pairing identity without issuing a new token', async () => {
    const session = await oauthSession('AAAAAAAAAAAAAAAAAAAAAA');
    const reauthorizeCredential = vi.fn(async () => true);
    const handlers = createAuthHandlers(
      dependencies(
        baseStore({
          consumeOAuthSession: async () => session,
          isDeletionTombstoned: async () => false,
          reauthorizeCredential
        }),
        vi.fn(async () => tokenResponse()) as unknown as typeof fetch
      )
    );

    const response = await handlers.authCallback(
      request(
        `/auth/callback?code=authorization-code&state=${state}`,
        {},
        `__Host-swp-oauth-v2=${oauthCookie}`
      )
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('REAUTHORIZED');
    expect(html).not.toContain('swpb1.');
    expect(reauthorizeCredential).toHaveBeenCalledWith(
      expect.objectContaining({ publicId: 'AAAAAAAAAAAAAAAAAAAAAA' })
    );
  });

  it('does not exchange a reauthorization code after deletion completes', async () => {
    const publicId = 'AAAAAAAAAAAAAAAAAAAAAA';
    const session = await oauthSession(publicId);
    const credentialLock = createCredentialLock();
    let tombstoned = false;
    const deletionStarted = deferred<void>();
    const finishDeletion = deferred<void>();
    const fetchImpl = vi.fn(async () => tokenResponse()) as unknown as typeof fetch;
    const authDependencies = dependencies(
      baseStore({
        consumeOAuthSession: async () => session,
        isDeletionTombstoned: async () => tombstoned
      }),
      fetchImpl
    );
    authDependencies.credentialLock = credentialLock;
    const handlers = createAuthHandlers(authDependencies);

    const deletion = credentialLock(publicId, async () => {
      tombstoned = true;
      deletionStarted.resolve();
      await finishDeletion.promise;
    });
    await deletionStarted.promise;
    const callback = handlers.authCallback(
      request(
        `/auth/callback?code=authorization-code&state=${state}`,
        {},
        `__Host-swp-oauth-v2=${oauthCookie}`
      )
    );
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();

    finishDeletion.resolve();
    await deletion;
    expect((await callback).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('setup and confirmation protocol', () => {
  it('binds one setup form to its strict Cookie and consumes it once', async () => {
    let created: SetupSessionInput | null = null;
    const inserted = vi.fn(async () => undefined);
    const store = baseStore({
      createSetupSession: async (input) => {
        created = input;
        return true;
      },
      consumeSetupSession: async (sessionId, browserDigest, expiresAtMs) => {
        if (
          created === null ||
          sessionId !== created.sessionId ||
          browserDigest !== created.browserDigest ||
          expiresAtMs !== created.expiresAtMs
        ) {
          return null;
        }
        return { ...created };
      },
      insertOAuthSession: inserted
    });
    const handlers = createAuthHandlers(
      dependencies(store, vi.fn() as unknown as typeof fetch)
    );

    const setup = await handlers.setup(request('/setup'));
    const html = await setup.text();
    const cookie = setup.headers
      .get('Set-Cookie')
      ?.match(/__Host-swp-setup=([A-Za-z0-9_-]{43})/)?.[1];
    const proof = html.match(/name="setupProof" value="([^"]+)"/)?.[1];
    expect(setup.status).toBe(200);
    expect(setup.headers.get('Set-Cookie')).toContain(
      'Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Strict'
    );
    expect(cookie).toBeDefined();
    expect(proof).toBeDefined();
    expect(html).toContain('id="reauthorize-form"');
    expect(html).toContain("fetch('/auth/reauthorize'");
    expect(html).toContain("fetch('/api/account'");
    expect(html).toContain("method:'DELETE'");
    expect(html).toContain('aria-live="polite"');
    const nonce = html.match(/<script nonce="([A-Za-z0-9_-]{22})">/)?.[1];
    expect(nonce).toBeDefined();
    expect(setup.headers.get('Content-Security-Policy')).toContain(
      `script-src 'nonce-${nonce}'`
    );
    expect(setup.headers.get('Content-Security-Policy')).toContain(
      "connect-src 'self'"
    );

    const body = new URLSearchParams({
      spotifyClientId: 'ClientId123456789',
      setupProof: proof!,
      legalAccepted: 'yes'
    }).toString();
    const started = await handlers.authStart(
      request(
        '/auth/start',
        {
          method: 'POST',
          headers: {
            Origin: publicBaseUrl,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body
        },
        '__Host-swp-setup=' + cookie
      )
    );

    expect(started.status).toBe(303);
    expect(started.headers.get('Location')).toContain(
      'https://accounts.spotify.test/authorize?'
    );
    expect(started.headers.get('Set-Cookie')).toContain('__Host-swp-oauth-v2=');
    expect(inserted).toHaveBeenCalledTimes(1);
  });

  it('keeps confirmation GET read-only and consumes the exact proof/Cookie on POST', async () => {
    const confirmationId = randomBase64Url(16);
    const confirmationCookie = randomBase64Url(32);
    const browserDigest = await digestProtocolValue(
      'oauth-confirm-browser-v1',
      confirmationCookie,
      hmacKey
    );
    const confirmation: CallbackConfirmation = {
      confirmationId,
      browserDigest,
      spotifyClientId: 'ClientId123456789',
      authorizationCode: await encryptSecret(
        'authorization-code',
        {
          kind: 'confirmation',
          recordId: confirmationId,
          spotifyClientId: 'ClientId123456789',
          fieldName: 'authorizationCode'
        },
        'current',
        encryptionKeyring
      ),
      codeVerifier: await encryptSecret(
        'verifier-value',
        {
          kind: 'confirmation',
          recordId: confirmationId,
          spotifyClientId: 'ClientId123456789',
          fieldName: 'pkceVerifier'
        },
        'current',
        encryptionKeyring
      ),
      createdAtMs: 1_700_000_100_000,
      expiresAtMs: 1_700_000_400_000
    };
    const find = vi.fn(async () => confirmation);
    const consume = vi.fn(async () => confirmation);
    const createCredential = vi.fn(async () => undefined);
    const handlers = createAuthHandlers(
      dependencies(
        baseStore({
          findCallbackConfirmation: find,
          consumeCallbackConfirmation: consume,
          createCredential
        }),
        vi.fn(async () => tokenResponse()) as unknown as typeof fetch
      )
    );
    const cookie = '__Host-swp-confirm=' + confirmationCookie;

    const page = await handlers.authConfirmGet(
      request('/auth/confirm', {}, cookie)
    );
    const proof = (await page.text()).match(
      /name="confirmationProof" value="([^"]+)"/
    )?.[1];
    expect(page.status).toBe(200);
    expect(proof).toBe(
      await createConfirmationProof(
        confirmationId,
        confirmation.expiresAtMs,
        hmacKey
      )
    );
    expect(find).toHaveBeenCalledTimes(1);
    expect(consume).not.toHaveBeenCalled();

    const confirmed = await handlers.authConfirmPost(
      request(
        '/auth/confirm',
        {
          method: 'POST',
          headers: {
            Origin: publicBaseUrl,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            confirmationProof: proof!,
            legalAccepted: 'yes'
          })
        },
        cookie
      )
    );
    expect(confirmed.status).toBe(200);
    expect(await confirmed.text()).toContain('swpb1.');
    expect(consume).toHaveBeenCalledTimes(1);
    expect(createCredential).toHaveBeenCalledTimes(1);
  });

  it('clears a confirmation Cookie when atomic consumption rejects it', async () => {
    const confirmationId = randomBase64Url(16);
    const expiresAtMs = 1_700_000_400_000;
    const proof = await createConfirmationProof(
      confirmationId,
      expiresAtMs,
      hmacKey
    );
    const consume = vi.fn(async () => null);
    const handlers = createAuthHandlers(
      dependencies(
        baseStore({ consumeCallbackConfirmation: consume }),
        vi.fn(async () => tokenResponse()) as unknown as typeof fetch
      )
    );

    const response = await handlers.authConfirmPost(
      request(
        '/auth/confirm',
        {
          method: 'POST',
          headers: {
            Origin: publicBaseUrl,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            confirmationProof: proof,
            legalAccepted: 'yes'
          })
        },
        '__Host-swp-confirm=' + oauthCookie
      )
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Set-Cookie')).toContain(
      '__Host-swp-confirm=; Path=/; Max-Age=0'
    );
    expect(consume).toHaveBeenCalledOnce();
  });

  it('clears a consumed confirmation Cookie when decryption fails', async () => {
    const confirmationId = randomBase64Url(16);
    const confirmationCookie = oauthCookie;
    const spotifyClientId = 'ClientId123456789';
    const expiresAtMs = 1_700_000_400_000;
    const proof = await createConfirmationProof(
      confirmationId,
      expiresAtMs,
      hmacKey
    );
    const confirmation: CallbackConfirmation = {
      confirmationId,
      browserDigest: await digestProtocolValue(
        'oauth-confirm-browser-v1',
        confirmationCookie,
        hmacKey
      ),
      spotifyClientId,
      authorizationCode: await encryptSecret(
        'authorization-code',
        {
          kind: 'confirmation',
          recordId: confirmationId,
          spotifyClientId,
          fieldName: 'authorizationCode'
        },
        'current',
        encryptionKeyring
      ),
      codeVerifier: await encryptSecret(
        'verifier-value',
        {
          kind: 'confirmation',
          recordId: 'wrong-confirmation',
          spotifyClientId,
          fieldName: 'pkceVerifier'
        },
        'current',
        encryptionKeyring
      ),
      createdAtMs: 1_700_000_100_000,
      expiresAtMs
    };
    const consume = vi.fn(async () => confirmation);
    const handlers = createAuthHandlers(
      dependencies(
        baseStore({ consumeCallbackConfirmation: consume }),
        vi.fn(async () => tokenResponse()) as unknown as typeof fetch
      )
    );

    const response = await handlers.authConfirmPost(
      request(
        '/auth/confirm',
        {
          method: 'POST',
          headers: {
            Origin: publicBaseUrl,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            confirmationProof: proof,
            legalAccepted: 'yes'
          })
        },
        `__Host-swp-confirm=${confirmationCookie}`
      )
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('Set-Cookie')).toContain(
      '__Host-swp-confirm=; Path=/; Max-Age=0'
    );
    expect(consume).toHaveBeenCalledOnce();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
