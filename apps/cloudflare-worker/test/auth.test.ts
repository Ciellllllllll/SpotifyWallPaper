import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import eulaDocument from '../../../docs/eula.md?raw';
import privacyDocument from '../../../docs/privacy.md?raw';
import worker from '../src/index';

const baseUrl = 'http://127.0.0.1:8787';
const clientId = '0123456789abcdef0123456789abcdef';
const requiredScope =
  'user-read-playback-state user-read-currently-playing user-modify-playback-state';
const securityHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff'
};

beforeEach(async () => {
  vi.unstubAllGlobals();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM spotify_backoff'),
    env.DB.prepare('DELETE FROM oauth_sessions'),
    env.DB.prepare('DELETE FROM credentials')
  ]);
});

describe('GET /setup', () => {
  it('returns a non-persistent same-origin setup page', async () => {
    const response = await callWorker(new Request(`${baseUrl}/setup`));
    const html = await response.text();

    expect(response.status).toBe(200);
    expectSecurityHeaders(response, html, true);
    expect(html).toContain('action="/auth/start"');
    expect(html).toContain('name="spotifyClientId"');
    expect(html).toContain('name="legalAccepted"');
    expect(html).toContain('name="setupProof"');
    expect(html).toMatch(
      /name="setupProof" value="\d{13}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}"/
    );
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('active Spotify Premium');
    expect(html).toContain('one Client ID per developer');
    expect(html).toContain('five authenticated users');
    expect(html).toContain('grandfathered');
    expect(html).toContain('id="pairing-token"');
    expect(html).toContain("input.value = ''");
    expect(html).toContain("Authorization: `Bearer ${token}`");
    expect(html).toContain("method: 'DELETE'");
    expect(html).toContain("fetch('/api/account'");
    expect(html).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
  });
});

describe('GET /privacy and /terms', () => {
  it('publishes hardened pre-authorization privacy and EULA pages', async () => {
    const privacy = await callWorker(new Request(`${baseUrl}/privacy`));
    const privacyHtml = await privacy.text();
    const terms = await callWorker(new Request(`${baseUrl}/terms`));
    const termsHtml = await terms.text();

    expect(privacy.status).toBe(200);
    expectSecurityHeaders(privacy, privacyHtml);
    expect(privacyHtml).toContain('swpb_oauth');
    expect(privacyHtml).toContain('strictly necessary');
    expect(privacyHtml).toContain('ten minutes');
    expect(privacyHtml).toContain('third-party tracking');
    expect(privacyHtml).toContain('href="/terms"');
    expect(extractLegalDocument(privacyHtml)).toBe(privacyDocument.trim());

    expect(terms.status).toBe(200);
    expectSecurityHeaders(terms, termsHtml);
    expect(termsHtml).toContain('no warranties on behalf of Spotify');
    expect(termsHtml).toContain('modify or create derivative works');
    expect(termsHtml).toContain('decompile, reverse engineer, or disassemble');
    expect(termsHtml).toContain('Spotify is a third-party beneficiary');
    expect(extractLegalDocument(termsHtml)).toBe(eulaDocument.trim());
  });
});

describe('POST /auth/start', () => {
  it('rejects requests without a valid setup proof, malformed, and caller-expanded requests', async () => {
    expect(
      (await startAuth({ origin: 'https://attacker.example', setupProof: null })).response.status
    ).toBe(403);
    expect(
      (
        await startAuth({
          origin: 'https://attacker.example',
          setupProof: null
        })
      ).response.status
    ).toBe(403);
    expect((await startAuth({ origin: null, setupProof: null })).response.status).toBe(403);
    expect(
      (
        await startAuth({
          origin: null,
          setupProof: 'A'.repeat(101)
        })
      ).response.status
    ).toBe(403);
    expect((await startAuth({ clientId: '' })).response.status).toBe(400);
    expect((await startAuth({ clientId: 'not valid!' })).response.status).toBe(400);
    expect((await startAuth({ extra: 'scope=user-read-email' })).response.status).toBe(400);
  });

  it('accepts a setup proof when Origin is absent', async () => {
    const started = await startAuth({ origin: null });

    expect(started.response.status).toBe(303);
  });

  it('accepts a setup proof when Chrome sends Origin null without a Cookie', async () => {
    const started = await startAuth({ origin: 'null' });

    expect(started.response.status).toBe(303);
  });

  it('accepts a setup proof when Chrome sends a nonstandard Origin', async () => {
    const started = await startAuth({ origin: 'chrome-extension://example' });

    expect(started.response.status).toBe(303);
  });

  it('requires explicit privacy and EULA acceptance before creating a session', async () => {
    const started = await startAuth({ legalAccepted: false });

    expect(started.response.status).toBe(400);
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM oauth_sessions').first('count')
    ).toBe(0);
  });

  it('creates a fixed PKCE authorization request and encrypted session', async () => {
    const started = await startAuth();
    const location = new URL(requiredHeader(started.response, 'location'));
    const cookie = requiredHeader(started.response, 'set-cookie');

    expect(started.response.status).toBe(303);
    expect(location.origin).toBe('https://accounts.spotify.com');
    expect(location.pathname).toBe('/authorize');
    expect(location.searchParams.get('client_id')).toBe(clientId);
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('redirect_uri')).toBe(`${baseUrl}/auth/callback`);
    expect(location.searchParams.get('scope')).toBe(
      requiredScope
    );
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie).toContain(
      'swpb_oauth='
    );
    expect(cookie).toMatch(
      /swpb_oauth=[A-Za-z0-9_-]{43}; Path=\/auth\/callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax/
    );

    const session = await env.DB.prepare('SELECT * FROM oauth_sessions').first<
      Record<string, string | number | null>
    >();
    expect(session).not.toBeNull();
    expect(session?.state_digest).not.toBe(location.searchParams.get('state'));
    expect(session?.browser_digest).not.toBe(cookieValue(cookie));
    expect(session?.spotify_client_id).toBe(clientId);
    expect(session?.code_verifier_ciphertext).not.toContain(
      location.searchParams.get('code_challenge')
    );
    expect(Number(session?.expires_at_ms) - Number(session?.created_at_ms)).toBe(600_000);
  });
});

describe('GET /auth/callback', () => {
  it('completes PKCE when an opaque-origin browser omits the callback cookie', async () => {
    const started = await startAuth();
    mockTokenExchange(validTokenResponse());

    const response = await callWorker(
      new Request(
        `${baseUrl}/auth/callback?code=opaque-origin-code&state=${encodeURIComponent(started.state)}`
      )
    );

    expect(response.status).toBe(200);
  });

  it('exchanges PKCE, stores encrypted tokens, and reveals one Pairing Token', async () => {
    const started = await startAuth();
    const exchange = mockTokenExchange({
      access_token: 'spotify-access-token',
      refresh_token: 'spotify-refresh-token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: requiredScope
    });

    const response = await callback(started, 'authorization-code');
    const html = await response.text();

    expect(response.status).toBe(200);
    expectSecurityHeaders(response, html);
    expect(html).toContain("history.replaceState({}, '', '/setup/complete')");
    expect(html).toMatch(/swpb1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/);
    expect(html).not.toContain('authorization-code');
    expect(html).not.toContain(started.state);
    expect(requiredHeader(response, 'set-cookie')).toContain('Max-Age=0');

    expect(exchange).toHaveBeenCalledOnce();
    const init = exchange.mock.calls[0]?.[1] as RequestInit;
    const body = new URLSearchParams(init.body as string);
    expect(exchange.mock.calls[0]?.[0]).toBe('https://accounts.spotify.com/api/token');
    expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(body.get('client_id')).toBe(clientId);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('authorization-code');
    expect(body.get('redirect_uri')).toBe(`${baseUrl}/auth/callback`);
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{86}$/);
    await expect(pkceChallenge(body.get('code_verifier')!)).resolves.toBe(started.challenge);

    const credential = await env.DB.prepare('SELECT * FROM credentials').first<
      Record<string, string | number | null>
    >();
    const stored = JSON.stringify(credential);
    expect(stored).not.toContain('spotify-access-token');
    expect(stored).not.toContain('spotify-refresh-token');
    expect(stored).not.toMatch(/swpb1\./);
    expect(credential?.auth_status).toBe('active');
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM oauth_sessions').first('count')
    ).toBe(0);
  });

  it('rejects browser mismatch and replay without exposing callback values', async () => {
    const started = await startAuth();
    mockTokenExchange(validTokenResponse());
    const mismatch = await callWorker(
      new Request(
        `${baseUrl}/auth/callback?code=${encodeURIComponent('sensitive-code')}&state=${started.state}`,
        {
          headers: {
            Cookie: 'swpb_oauth=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
          }
        }
      )
    );
    const mismatchHtml = await mismatch.text();
    expect(mismatch.status).toBe(400);
    expectSecurityHeaders(mismatch, mismatchHtml);
    expect(mismatchHtml).toContain('Browser verification expired or was blocked.');
    expect(mismatchHtml).not.toContain('sensitive-code');
    expect(mismatchHtml).not.toContain(started.state);

    const success = await callback(started, 'valid-code');
    expect(success.status).toBe(200);
    const replay = await callback(started, 'replayed-code');
    const replayHtml = await replay.text();
    expect(replay.status).toBe(400);
    expect(replayHtml).not.toContain('replayed-code');
    expect(replayHtml).not.toContain(started.state);
  });

  it('rejects malformed callback cookies instead of treating them as missing', async () => {
    const started = await startAuth();
    const exchange = mockTokenExchange(validTokenResponse());

    const response = await callWorker(
      new Request(
        `${baseUrl}/auth/callback?code=duplicate-cookie-code&state=${encodeURIComponent(started.state)}`,
        { headers: { Cookie: 'swpb_oauth=first; swpb_oauth=second' } }
      )
    );

    expect(response.status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('redacts Spotify denial and malformed token responses', async () => {
    const denied = await startAuth();
    const denialResponse = await callWorker(
      new Request(`${baseUrl}/auth/callback?error=access_denied&state=${denied.state}`, {
        headers: { Cookie: `swpb_oauth=${denied.browserNonce}` }
      })
    );
    const denialHtml = await denialResponse.text();
    expect(denialResponse.status).toBe(400);
    expect(denialHtml).toContain('Spotify did not complete authorization.');
    expect(denialHtml).not.toContain('access_denied');
    expect(denialHtml).not.toContain(denied.state);

    const malformed = await startAuth();
    mockTokenExchange({
      access_token: 'access-without-refresh',
      token_type: 'Bearer',
      expires_in: 3600
    });
    const malformedResponse = await callback(malformed, 'malformed-response-code');
    const malformedHtml = await malformedResponse.text();
    expect(malformedResponse.status).toBe(502);
    expect(malformedHtml).toContain('Spotify login was accepted, but access could not be completed.');
    expect(malformedHtml).not.toContain('access-without-refresh');
    expect(malformedHtml).not.toContain('malformed-response-code');
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM credentials').first('count')).toBe(0);
  });

  it('rejects an expired session before contacting Spotify', async () => {
    const expired = await startAuth();
    await env.DB.prepare(
      'UPDATE oauth_sessions SET created_at_ms = 0, expires_at_ms = 1'
    ).run();
    const exchange = mockTokenExchange(validTokenResponse());

    const response = await callback(expired, 'expired-session-code');
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
    expect(html).not.toContain('expired-session-code');
    expect(html).not.toContain(expired.state);
  });

  it('rate limits callbacks before hashing or writing D1 and returns no callback values', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const limitedEnv = {
      ...env,
      AUTH_RATE_LIMITER: { limit }
    } as unknown as Env;
    const response = await worker.fetch(
      new Request(
        `${baseUrl}/auth/callback?code=sensitive-callback-code&state=sensitive-state`,
        {
          headers: {
            Cookie: 'swpb_oauth=sensitive-browser-nonce',
            'CF-Connecting-IP': '192.0.2.20'
          }
        }
      ),
      limitedEnv
    );
    const body = await response.text();

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(limit).toHaveBeenCalledWith({ key: 'auth:192.0.2.20' });
    expect(body).not.toContain('sensitive-callback-code');
    expect(body).not.toContain('sensitive-state');
    expect(body).not.toContain('sensitive-browser-nonce');
  });

  it('rejects a token response missing any requested scope', async () => {
    const started = await startAuth();
    mockTokenExchange({
      ...validTokenResponse(),
      scope: 'user-read-playback-state user-read-currently-playing'
    });

    const response = await callback(started, 'insufficient-scope-code');
    const html = await response.text();

    expect(response.status).toBe(502);
    expect(html).not.toContain('insufficient-scope-code');
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM credentials').first('count')).toBe(0);
  });

  it('cancels an undeclared multibyte token response after the byte limit', async () => {
    const started = await startAuth();
    const cancelled = vi.fn();
    const multibyteChunk = new TextEncoder().encode('界'.repeat(6_000));
    let remainingChunks = 3;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (remainingChunks-- > 0) {
                controller.enqueue(multibyteChunk);
                return;
              }
              controller.close();
            },
            cancel: cancelled
          }),
          {
            headers: { 'Content-Type': 'application/json' }
          }
        )
      )
    );

    const response = await callback(started, 'oversized-response-code');

    expect(response.status).toBe(502);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM credentials').first('count')).toBe(0);
  });
});

describe('POST /auth/reauthorize', () => {
  it('rate limits session creation before writing D1', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const limitedEnv = {
      ...env,
      AUTH_RATE_LIMITER: { limit }
    } as unknown as Env;
    const before = await env.DB.prepare('SELECT COUNT(*) AS count FROM oauth_sessions').first<
      number
    >('count');

    const response = await worker.fetch(
      new Request(`${baseUrl}/auth/start`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'CF-Connecting-IP': '192.0.2.10',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ spotifyClientId: clientId })
      }),
      limitedEnv
    );
    const after = await env.DB.prepare('SELECT COUNT(*) AS count FROM oauth_sessions').first<
      number
    >('count');

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(limit).toHaveBeenCalledWith({ key: 'auth:192.0.2.10' });
    expect(after).toBe(before);
  });

  it('requires both same origin and a valid Bearer Pairing Token', async () => {
    const crossOrigin = await callWorker(
      new Request(`${baseUrl}/auth/reauthorize`, {
        method: 'POST',
        headers: {
          Origin: 'https://attacker.example',
          Authorization: 'Bearer malformed'
        }
      })
    );
    const malformed = await callWorker(
      new Request(`${baseUrl}/auth/reauthorize`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          Authorization: 'Bearer malformed',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ legalAccepted: 'yes' })
      })
    );

    expect(crossOrigin.status).toBe(403);
    expect(malformed.status).toBe(401);
  });

  it('requires renewed privacy and EULA acceptance before creating a session', async () => {
    const initial = await startAuth();
    mockTokenExchange(validTokenResponse());
    const initialResponse = await callback(initial, 'initial-consent-code');
    const pairingToken = (await initialResponse.text()).match(
      /swpb1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/
    )?.[0];
    expect(pairingToken).toBeDefined();

    const response = await callWorker(
      new Request(`${baseUrl}/auth/reauthorize`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          Authorization: `Bearer ${pairingToken}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams()
      })
    );

    expect(response.status).toBe(400);
  });

  it('retains the existing Pairing Token identity and does not emit a replacement', async () => {
    const initial = await startAuth();
    mockTokenExchange(validTokenResponse());
    const initialResponse = await callback(initial, 'initial-code');
    const initialHtml = await initialResponse.text();
    const pairingToken = initialHtml.match(
      /swpb1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/
    )?.[0];
    expect(pairingToken).toBeDefined();
    vi.unstubAllGlobals();

    const reauthorization = await callWorker(
      new Request(`${baseUrl}/auth/reauthorize`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          Authorization: `Bearer ${pairingToken}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ legalAccepted: 'yes' })
      })
    );
    const reauthorizationBody = await reauthorization.json<{
      ok: boolean;
      value: { authorizeUrl: string };
    }>();
    expect(reauthorization.status).toBe(200);
    expect(reauthorizationBody.ok).toBe(true);
    const authorizeUrl = new URL(reauthorizationBody.value.authorizeUrl);
    const state = authorizeUrl.searchParams.get('state')!;
    const browserNonce = cookieValue(requiredHeader(reauthorization, 'set-cookie'));

    const missingCookie = await callWorker(
      new Request(`${baseUrl}/auth/callback?code=reauthorization-code&state=${state}`)
    );
    expect(missingCookie.status).toBe(400);

    mockTokenExchange({
      ...validTokenResponse(),
      access_token: 'replacement-access',
      refresh_token: 'replacement-refresh'
    });
    const callbackResponse = await callWorker(
      new Request(`${baseUrl}/auth/callback?code=reauthorization-code&state=${state}`, {
        headers: { Cookie: `swpb_oauth=${browserNonce}` }
      })
    );
    const callbackHtml = await callbackResponse.text();

    expect(callbackResponse.status).toBe(200);
    expect(callbackHtml).not.toMatch(/swpb1\./);
    const parsedPublicId = pairingToken!.split('.')[1];
    const credential = await env.DB.prepare(
      'SELECT public_id, token_version, auth_status FROM credentials'
    ).first<{ public_id: string; token_version: number; auth_status: string }>();
    expect(credential).toEqual({
      public_id: parsedPublicId,
      token_version: 2,
      auth_status: 'active'
    });
  });
});

interface StartedAuthorization {
  response: Response;
  state: string;
  challenge: string;
  browserNonce: string;
}

async function startAuth(options: {
  origin?: string | null;
  clientId?: string;
  extra?: string;
  legalAccepted?: boolean;
  fetchSite?: string;
  setupProof?: string | null;
} = {}): Promise<StartedAuthorization> {
  const setup = await setupProof();
  const body = new URLSearchParams({ spotifyClientId: options.clientId ?? clientId });
  if (options.setupProof !== null) {
    body.set('setupProof', options.setupProof ?? setup);
  }
  if (options.legalAccepted !== false) {
    body.set('legalAccepted', 'yes');
  }
  if (options.extra !== undefined) {
    const [key, value] = options.extra.split('=');
    body.set(key, value);
  }

  const headers = new Headers({
    'Content-Type': 'application/x-www-form-urlencoded'
  });
  if (options.origin !== null) {
    headers.set('Origin', options.origin ?? baseUrl);
  }
  if (options.fetchSite !== undefined) {
    headers.set('Sec-Fetch-Site', options.fetchSite);
  }

  const response = await callWorker(
    new Request(`${baseUrl}/auth/start`, {
      method: 'POST',
      headers,
      body
    })
  );
  const location = response.headers.get('location');
  const cookie = response.headers.get('set-cookie');
  const authorizeUrl = location === null ? null : new URL(location);
  return {
    response,
    state: authorizeUrl?.searchParams.get('state') ?? '',
    challenge: authorizeUrl?.searchParams.get('code_challenge') ?? '',
    browserNonce: cookie === null ? '' : cookieValue(cookie)
  };
}

async function setupProof(): Promise<string> {
  const response = await callWorker(new Request(`${baseUrl}/setup`));
  const html = await response.text();
  return html.match(/name="setupProof" value="([A-Za-z0-9_.-]+)"/)?.[1] ?? '';
}

async function callback(started: StartedAuthorization, code: string): Promise<Response> {
  return callWorker(
    new Request(
      `${baseUrl}/auth/callback?code=${encodeURIComponent(code)}&state=${started.state}`,
      {
        headers: { Cookie: `swpb_oauth=${started.browserNonce}` }
      }
    )
  );
}

function validTokenResponse() {
  return {
    access_token: 'spotify-access-token',
    refresh_token: 'spotify-refresh-token',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: requiredScope
  };
}

function mockTokenExchange(body: Record<string, unknown>) {
  const mock = vi.fn(async (_input: string | Request | URL, _init?: RequestInit) =>
    Response.json(body, {
      headers: { 'Content-Type': 'application/json' }
    })
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

function callWorker(request: Request): Promise<Response> {
  return worker.fetch(request, env);
}

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  expect(value).not.toBeNull();
  return value!;
}

function cookieValue(setCookie: string): string {
  return setCookie.match(/^swpb_oauth=([^;]+)/)?.[1] ?? '';
}

function expectSecurityHeaders(response: Response, html: string, setup = false): void {
  for (const [name, value] of Object.entries(securityHeaders)) {
    expect(response.headers.get(name)).toBe(value);
  }
  const nonce = html.match(/<(?:script|style) nonce="([A-Za-z0-9_-]{22})"/)?.[1];
  expect(nonce).toBeDefined();
  expect(html).not.toMatch(/<(?:script|style)(?! nonce=)/);
  expect(response.headers.get('content-security-policy')).toBe(
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'${setup ? "; connect-src 'self'" : ''}`
  );
  expect(response.headers.get('content-security-policy')).not.toContain("'unsafe-inline'");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function extractLegalDocument(html: string): string {
  const encoded = html.match(/<pre id="legal-document">([\s\S]*?)<\/pre>/)?.[1];
  expect(encoded).toBeDefined();
  return encoded!
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .trim();
}
