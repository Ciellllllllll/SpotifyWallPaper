import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { incomingMessageToRequest } from '../src/http.js';
import { createRouter, type RouteHandler } from '../src/router.js';
import { startServers, type RunningServers } from '../src/server.js';
import { runBackend } from '../src/index.js';
import type { DatabasePools } from '../src/db.js';

interface SocketFixture {
  publicPath: string;
  adminPath: string;
  cleanup(): Promise<void>;
}

interface HttpResult {
  status: number;
  body: string;
  headers: Headers;
}

const runningServers: RunningServers[] = [];
const fixtureCleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(runningServers.splice(0).map((servers) => servers.close()));
  await Promise.allSettled(fixtureCleanups.splice(0).map((cleanup) => cleanup()));
});

describe('two-socket HTTP server', () => {
  it('fails before server startup when SPOTIFY_MODE is unknown', async () => {
    let startCalls = 0;

    await expect(
      runBackend(
        {
          SPOTIFY_MODE: 'production',
          PUBLIC_SOCKET_PATH: '/run/spotify-wallpaper/public.sock',
          ADMIN_SOCKET_PATH: '/run/spotify-wallpaper/admin.sock'
        },
        {
          start: async () => {
            startCalls += 1;
            return { close: async () => {} };
          },
          waitForShutdown: async () => {}
        }
      )
    ).rejects.toThrow('SPOTIFY_MODE must be policy_locked or synthetic_test.');
    expect(startCalls).toBe(0);
  });

  it('closes both servers when the process shutdown gate resolves', async () => {
    let closeCalls = 0;

    await runBackend(
      {
        SPOTIFY_MODE: 'policy_locked',
        PUBLIC_SOCKET_PATH: '/run/spotify-wallpaper/public/public.sock',
        ADMIN_SOCKET_PATH: '/run/spotify-wallpaper/admin/admin.sock'
      },
      {
        start: async () => ({
          close: async () => {
            closeCalls += 1;
          }
        }),
        waitForShutdown: async () => {}
      }
    );

    expect(closeCalls).toBe(1);
  });

  it('binds synthetic requests to the trusted configured origin', async () => {
    let requestBaseUrl: string | undefined;
    const pools = {
      primary: { end: async () => {} },
      deletion: { end: async () => {} }
    } as unknown as DatabasePools;

    await runBackend(
      {
        SPOTIFY_MODE: 'synthetic_test',
        PUBLIC_SOCKET_PATH: '/run/spotify-wallpaper/public.sock',
        ADMIN_SOCKET_PATH: '/run/spotify-wallpaper/admin.sock',
        PUBLIC_BASE_URL: 'https://ciel-spotify-wallpaper.duckdns.org',
        PG_SOCKET_DIR: '/run/postgresql',
        OAUTH_STATE_HMAC_KEY: 'A'.repeat(43),
        TOKEN_ENCRYPTION_KEYRING: `{"current":"${'A'.repeat(43)}"}`,
        TOKEN_ENCRYPTION_ACTIVE_KEY_ID: 'current',
        PAIRING_HMAC_KEYRING: `{"current":"${'A'.repeat(43)}"}`,
        PAIRING_HMAC_ACTIVE_KEY_ID: 'current',
        SYNTHETIC_AUTHORIZE_ENDPOINT: 'https://synthetic.invalid/authorize',
        SYNTHETIC_TOKEN_ENDPOINT: 'https://synthetic.invalid/token',
        SYNTHETIC_PLAYBACK_ENDPOINT: 'https://synthetic.invalid/playback',
        PRIVACY_VERSION: '2026-08-31',
        EULA_VERSION: '2026-08-31'
      },
      {
        createPools: async () => pools,
        start: async (options) => {
          requestBaseUrl = options.requestBaseUrl;
          return { close: async () => {} };
        },
        waitForShutdown: async () => {}
      }
    );

    expect(requestBaseUrl).toBe(
      'https://ciel-spotify-wallpaper.duckdns.org'
    );
  });

  it('listens on public/admin sockets and applies mode 0660 to both', async () => {
    const fixture = await socketFixture();
    const appliedModes: Array<[string, number]> = [];
    const servers = await startServers({
      publicSocketPath: fixture.publicPath,
      adminSocketPath: fixture.adminPath,
      router: createRouter({ mode: 'policy_locked' }),
      setSocketMode: async (path, mode) => {
        appliedModes.push([path, mode]);
      }
    });
    runningServers.push(servers);

    const health = await request(fixture.publicPath, 'GET', '/health');
    const lockedAdmin = await request(fixture.adminPath, 'GET', '/setup');

    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({
      ok: true,
      value: { service: 'spotify-wallpaper-backend' }
    });
    expect(lockedAdmin.status).toBe(503);
    expect(appliedModes).toEqual([
      [fixture.publicPath, 0o660],
      [fixture.adminPath, 0o660]
    ]);
  });

  it('reports fixed request dimensions after routing', async () => {
    const fixture = await socketFixture();
    const recorded: Array<{
      socket: string;
      method: string | undefined;
      rawTarget: string | undefined;
      status: number;
      elapsedMs: number;
    }> = [];
    const servers = await startServers({
      publicSocketPath: fixture.publicPath,
      adminSocketPath: fixture.adminPath,
      router: createRouter({ mode: 'policy_locked' }),
      recordRequest: (socket, method, rawTarget, status, elapsedMs) => {
        recorded.push({ socket, method, rawTarget, status, elapsedMs });
      },
      setSocketMode: async () => {}
    });
    runningServers.push(servers);

    await request(fixture.publicPath, 'GET', '/health');

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      socket: 'public',
      method: 'GET',
      rawTarget: '/health',
      status: 200
    });
    expect(recorded[0]?.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('converts an IncomingMessage to a bounded Fetch Request only at dispatch', async () => {
    const fixture = await socketFixture();
    const control: RouteHandler = async (convertedRequest) => {
      expect(convertedRequest).toBeInstanceOf(Request);
      expect(convertedRequest.url).toBe(
        'https://ciel-spotify-wallpaper.duckdns.org/api/control'
      );
      expect(convertedRequest.headers.get('x-test-purpose')).toBe('bounded');
      expect(await convertedRequest.text()).toBe('play');
      return new Response('accepted', { status: 202 });
    };
    const servers = await startServers({
      publicSocketPath: fixture.publicPath,
      adminSocketPath: fixture.adminPath,
      router: createRouter({
        mode: 'synthetic_test',
        handlers: { control }
      }),
      requestBaseUrl: 'https://ciel-spotify-wallpaper.duckdns.org',
      setSocketMode: async () => {}
    });
    runningServers.push(servers);

    const response = await request(
      fixture.publicPath,
      'POST',
      '/api/control',
      'play',
      { 'X-Test-Purpose': 'bounded' }
    );

    expect(response.status).toBe(202);
    expect(response.body).toBe('accepted');
  });

  it('rejects a declared body above the configured bound', async () => {
    const fixture = await socketFixture();
    const servers = await startServers({
      publicSocketPath: fixture.publicPath,
      adminSocketPath: fixture.adminPath,
      router: createRouter({
        mode: 'synthetic_test',
        handlers: { control: () => new Response('must not run') }
      }),
      maxRequestBodyBytes: 3,
      setSocketMode: async () => {}
    });
    runningServers.push(servers);

    const response = await request(
      fixture.publicPath,
      'POST',
      '/api/control',
      'play'
    );

    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects duplicate Authorization headers before dispatch', async () => {
    const fixture = await socketFixture();
    let dispatchCalls = 0;
    const servers = await startServers({
      publicSocketPath: fixture.publicPath,
      adminSocketPath: fixture.adminPath,
      router: createRouter({
        mode: 'synthetic_test',
        handlers: {
          playback: () => {
            dispatchCalls += 1;
            return new Response('must not run');
          }
        }
      }),
      setSocketMode: async () => {}
    });
    runningServers.push(servers);

    const response = await request(
      fixture.publicPath,
      'GET',
      '/api/playback',
      undefined,
      {
        Origin: 'null',
        'X-SWP-Client-IP': '192.0.2.1',
        Authorization: ['Bearer first', 'Bearer second']
      }
    );

    expect(response.status).toBe(400);
    expect(dispatchCalls).toBe(0);
  });

  it('returns the fixed policy response without an interim 100 Continue', async () => {
    const fixture = await socketFixture();
    const servers = await startServers({
      publicSocketPath: fixture.publicPath,
      adminSocketPath: fixture.adminPath,
      router: createRouter({ mode: 'policy_locked' }),
      setSocketMode: async () => {}
    });
    runningServers.push(servers);

    const response = await rawRequest(
      fixture.publicPath,
      'GET /api/playback HTTP/1.1\r\nHost: unix\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n'
    );

    expect(response).not.toContain('HTTP/1.1 100 Continue');
    expect(response).toContain('HTTP/1.1 503');
  });

  it('keeps the fixed policy response for an unsupported expectation', async () => {
    const fixture = await socketFixture();
    const servers = await startServers({
      publicSocketPath: fixture.publicPath,
      adminSocketPath: fixture.adminPath,
      router: createRouter({ mode: 'policy_locked' }),
      setSocketMode: async () => {}
    });
    runningServers.push(servers);

    const response = await rawRequest(
      fixture.publicPath,
      'GET /api/playback HTTP/1.1\r\nHost: unix\r\nExpect: x-swp-unsupported\r\nConnection: close\r\n\r\n'
    );

    expect(response).toContain('HTTP/1.1 503');
    expect(response).not.toContain('HTTP/1.1 417');
  });

  it('closes early fixed responses after accepting a request body', async () => {
    const fixture = await socketFixture();
    const servers = await startServers({
      publicSocketPath: fixture.publicPath,
      adminSocketPath: fixture.adminPath,
      router: createRouter({ mode: 'policy_locked' }),
      setSocketMode: async () => {}
    });
    runningServers.push(servers);

    const response = await rawRequest(
      fixture.publicPath,
      'GET /api/playback HTTP/1.1\r\nHost: unix\r\nContent-Length: 4\r\nConnection: keep-alive\r\n\r\nbody'
    );

    expect(response).toContain('HTTP/1.1 503');
    expect(response).toMatch(/Connection: close/i);
  });

  it('drains bodies for methods whose converted request has no body', async () => {
    const message = Object.assign(new PassThrough(), {
      method: 'GET',
      url: '/health',
      headers: { 'content-length': '4' },
      rawHeaders: []
    }) as unknown as IncomingMessage;

    const converted = incomingMessageToRequest(message, 64);
    message.push(Buffer.from('body'));
    message.push(null);
    expect((await converted).body).toBeNull();
    expect(message.readableEnded).toBe(true);
  });

  it('sends 100 Continue before reading a synthetic request body', async () => {
    const fixture = await socketFixture();
    const servers = await startServers({
      publicSocketPath: fixture.publicPath,
      adminSocketPath: fixture.adminPath,
      router: createRouter({
        mode: 'synthetic_test',
        handlers: {
          control: async (convertedRequest) =>
            new Response(await convertedRequest.text())
        }
      }),
      setSocketMode: async () => {}
    });
    runningServers.push(servers);

    const response = await continueRequest(fixture.publicPath, 'play');

    expect(response.interim).toBe(true);
    expect(response.status).toBe(200);
    expect(response.body).toBe('play');
  });

  it('rejects unsupported HTTP expectations', async () => {
    const fixture = await socketFixture();
    const servers = await startServers({
      publicSocketPath: fixture.publicPath,
      adminSocketPath: fixture.adminPath,
      router: createRouter({ mode: 'policy_locked' }),
      setSocketMode: async () => {}
    });
    runningServers.push(servers);

    const response = await rawRequest(
      fixture.publicPath,
      'GET /health HTTP/1.1\r\nHost: unix\r\nExpect: x-swp-unsupported\r\nConnection: close\r\n\r\n'
    );

    expect(response).toContain('HTTP/1.1 417');
  });

  it('rejects unsupported expectations before unknown-route responses', async () => {
    const fixture = await socketFixture();
    const servers = await startServers({
      publicSocketPath: fixture.publicPath,
      adminSocketPath: fixture.adminPath,
      router: createRouter({ mode: 'policy_locked' }),
      setSocketMode: async () => {}
    });
    runningServers.push(servers);

    for (const requestLine of [
      'GET /missing HTTP/1.1',
      'POST /api/playback HTTP/1.1'
    ]) {
      const response = await rawRequest(
        fixture.publicPath,
        `${requestLine}\r\nHost: unix\r\nExpect: x-swp-unsupported\r\nConnection: close\r\n\r\n`
      );

      expect(response).toContain('HTTP/1.1 417');
      expect(response).not.toContain('HTTP/1.1 404');
      expect(response).toMatch(/Connection: close/i);
    }
  });

  it('dispatches preflight without exposing its request body', async () => {
    const fixture = await socketFixture();
    const servers = await startServers({
      publicSocketPath: fixture.publicPath,
      adminSocketPath: fixture.adminPath,
      router: createRouter({
        mode: 'synthetic_test',
        handlers: {
          playbackOptions: (convertedRequest) => {
            expect(convertedRequest.body).toBeNull();
            return new Response(null, { status: 204 });
          }
        }
      }),
      maxRequestBodyBytes: 4,
      setSocketMode: async () => {}
    });
    runningServers.push(servers);

    const response = await request(
      fixture.publicPath,
      'OPTIONS',
      '/api/playback',
      'body',
      {
        Origin: 'null',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization'
      }
    );

    expect(response.status).toBe(204);
  });

  it('waits for an in-flight response before graceful close resolves', async () => {
    const fixture = await socketFixture();
    let releaseResponse: (() => void) | undefined;
    let markEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const servers = await startServers({
      publicSocketPath: fixture.publicPath,
      adminSocketPath: fixture.adminPath,
      router: createRouter({
        mode: 'synthetic_test',
        handlers: {
          playback: async () => {
            markEntered?.();
            await responseGate;
            return new Response('done');
          }
        }
      }),
      setSocketMode: async () => {}
    });
    runningServers.push(servers);

    const pendingResponse = request(
      fixture.publicPath,
      'GET',
      '/api/playback'
    );
    await entered;
    let closeResolved = false;
    const closing = servers.close().then(() => {
      closeResolved = true;
    });
    const closeState = await Promise.race([
      closing.then(() => 'closed' as const),
      new Promise<'waiting'>((resolve) => setImmediate(() => resolve('waiting')))
    ]);

    expect(closeState).toBe('waiting');
    expect(closeResolved).toBe(false);
    releaseResponse?.();
    expect((await pendingResponse).body).toBe('done');
    await closing;
    expect(closeResolved).toBe(true);
  });
});

async function socketFixture(): Promise<SocketFixture> {
  if (process.platform === 'win32') {
    const nonce = `${process.pid}-${randomUUID()}`;
    return {
      publicPath: `\\\\.\\pipe\\spotify-wallpaper-${nonce}-public`,
      adminPath: `\\\\.\\pipe\\spotify-wallpaper-${nonce}-admin`,
      cleanup: async () => {}
    };
  }

  const directory = await mkdtemp(join(tmpdir(), 'spotify-wallpaper-'));
  const fixture = {
    publicPath: join(directory, 'public.sock'),
    adminPath: join(directory, 'admin.sock'),
    cleanup: () => rm(directory, { recursive: true, force: true })
  };
  fixtureCleanups.push(fixture.cleanup);
  return fixture;
}

function request(
  socketPath: string,
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string | string[]> = {}
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        socketPath,
        agent: false,
        method,
        path,
        headers: {
          ...headers,
          ...(body === undefined
            ? {}
            : { 'Content-Length': Buffer.byteLength(body) })
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('error', reject);
        response.once('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: new Headers(
              Object.entries(response.headers).flatMap(([name, value]) =>
                value === undefined
                  ? []
                  : Array.isArray(value)
                    ? value.map((item) => [name, item] as [string, string])
                    : [[name, String(value)] as [string, string]]
              )
            )
          });
        });
      }
    );
    outgoing.once('error', reject);
    outgoing.end(body);
  });
}

function rawRequest(socketPath: string, requestText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out waiting for raw HTTP response.'));
    }, 1_000);
    const finish = (): void => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('end', finish);
    socket.once('connect', () => socket.end(requestText));
  });
}

function continueRequest(
  socketPath: string,
  body: string
): Promise<{ interim: boolean; status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let interim = false;
    const outgoing = httpRequest(
      {
        socketPath,
        agent: false,
        method: 'POST',
        path: '/api/control',
        headers: {
          Expect: '100-continue',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('error', reject);
        response.once('end', () =>
          resolve({
            interim,
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8')
          })
        );
      }
    );
    outgoing.once('continue', () => {
      interim = true;
      outgoing.end(body);
    });
    outgoing.once('error', reject);
    outgoing.setTimeout(1_000, () => {
      outgoing.destroy(new Error('Timed out waiting for HTTP response.'));
    });
    outgoing.flushHeaders();
  });
}
