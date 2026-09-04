import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  createRouter,
  type RouteHandler,
  type RouteId,
  type SocketKind
} from '../src/router.js';

const request = (
  method: string,
  url: string,
  poisonHeaders = false
): IncomingMessage => {
  const message = { method, url };
  if (poisonHeaders) {
    Object.defineProperty(message, 'headers', {
      get(): never {
        throw new Error('headers were inspected');
      }
    });
  }
  return message as unknown as IncomingMessage;
};

const handler = (id: RouteId): RouteHandler => (convertedRequest) => {
  expect(convertedRequest).toBeInstanceOf(Request);
  return new Response(id, { status: 200 });
};

const requestFactory = (method: string, url: string): (() => Promise<Request>) =>
  async () => new Request(`http://unix${url}`, { method });

describe('public/admin router', () => {
  const syntheticRouter = () =>
    createRouter({
      mode: 'synthetic_test',
      handlers: {
        authCallback: handler('authCallback'),
        playback: handler('playback'),
        control: handler('control'),
        account: handler('account'),
        playbackOptions: handler('playbackOptions'),
        controlOptions: handler('controlOptions'),
        setup: handler('setup'),
        authStart: handler('authStart'),
        authConfirmGet: handler('authConfirmGet'),
        authConfirmPost: handler('authConfirmPost'),
        reauthorize: handler('reauthorize')
      }
    });

  it.each([
    ['public', 'GET', '/auth/callback?code=synthetic', 'authCallback'],
    ['public', 'GET', '/api/playback', 'playback'],
    ['public', 'POST', '/api/control', 'control'],
    ['public', 'DELETE', '/api/account', 'account'],
    ['public', 'OPTIONS', '/api/playback', 'playbackOptions'],
    ['public', 'OPTIONS', '/api/control', 'controlOptions'],
    ['admin', 'GET', '/setup', 'setup'],
    ['admin', 'POST', '/auth/start', 'authStart'],
    ['admin', 'GET', '/auth/confirm', 'authConfirmGet'],
    ['admin', 'POST', '/auth/confirm', 'authConfirmPost'],
    ['admin', 'POST', '/auth/reauthorize', 'reauthorize']
  ] as const)(
    'dispatches the exact %s socket allowlist entry %s %s',
    async (socket, method, url, routeId) => {
      const response = await syntheticRouter()(
        socket,
        request(method, url),
        requestFactory(method, url)
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(routeId);
    }
  );

  it('serves DB-independent health and legal routes', async () => {
    const route = syntheticRouter();
    const health = await route('public', request('GET', '/health'));
    const privacy = await route('public', request('GET', '/privacy'));
    const terms = await route('public', request('GET', '/terms'));

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      ok: true,
      value: { service: 'spotify-wallpaper-backend' }
    });
    expect(await privacy.text()).toContain('Privacy Notice For The Public Backend');
    expect(await terms.text()).toContain('Public Backend Beta EULA');
  });

  it.each([
    ['public', 'GET', '/setup'],
    ['admin', 'GET', '/api/playback'],
    ['public', 'GET', '/api/playback/'],
    ['public', 'GET', '/api/%70layback'],
    ['public', 'GET', '/privacy/'],
    ['public', 'GET', '/privacy?view=full'],
    ['public', 'HEAD', '/health'],
    ['admin', 'POST', '/auth/start/'],
    ['admin', 'GET', '/auth/%63onfirm']
  ] as const)(
    'default-denies wrong socket/path/method target %s %s %s',
    async (socket, method, url) => {
      const response = await syntheticRouter()(
        socket as SocketKind,
        request(method, url)
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        ok: false,
        error: {
          kind: 'unavailable',
          message: 'Route not found.',
          status: 404
        }
      });
    }
  );

  it('returns one early no-store 503 for every allowed Spotify route', async () => {
    let lateDependencyCalls = 0;
    let requestFactoryCalls = 0;
    const touchesLateDependencies: RouteHandler = () => {
      lateDependencyCalls += 1;
      throw new Error('late dependency was touched');
    };
    const lockedRouter = createRouter({
      mode: 'policy_locked',
      handlers: Object.fromEntries(
        [
          'authCallback',
          'playback',
          'control',
          'account',
          'playbackOptions',
          'controlOptions',
          'setup',
          'authStart',
          'authConfirmGet',
          'authConfirmPost',
          'reauthorize'
        ].map((id) => [id, touchesLateDependencies])
      )
    });
    const targets = [
      ['public', 'GET', '/auth/callback?code=never-read'],
      ['public', 'GET', '/api/playback'],
      ['public', 'OPTIONS', '/api/playback'],
      ['public', 'POST', '/api/control'],
      ['public', 'OPTIONS', '/api/control'],
      ['public', 'DELETE', '/api/account'],
      ['admin', 'GET', '/setup'],
      ['admin', 'POST', '/auth/start'],
      ['admin', 'GET', '/auth/confirm'],
      ['admin', 'POST', '/auth/confirm'],
      ['admin', 'POST', '/auth/reauthorize']
    ] as const;
    const bodies: string[] = [];

    for (const [socket, method, url] of targets) {
      const response = await lockedRouter(
        socket,
        request(method, url, true),
        async () => {
          requestFactoryCalls += 1;
          throw new Error('request headers/body were converted');
        }
      );
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      bodies.push(await response.text());
    }

    expect(new Set(bodies)).toEqual(
      new Set([
        JSON.stringify({
          ok: false,
          error: {
            kind: 'unavailable',
            message: 'Spotify routes are disabled by policy.',
            status: 503
          }
        })
      ])
    );
    expect(lateDependencyCalls).toBe(0);
    expect(requestFactoryCalls).toBe(0);
  });

  it('rejects disallowed methods before the policy lock', async () => {
    const lockedRouter = createRouter({ mode: 'policy_locked' });
    const responses = await Promise.all([
      lockedRouter('public', request('PATCH', '/auth/callback', true)),
      lockedRouter('public', request('POST', '/api/playback', true)),
      lockedRouter('admin', request('DELETE', '/setup', true)),
      lockedRouter('admin', request('GET', '/auth/start', true))
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404, 404
    ]);
  });

  it('classifies wrong-socket and encoded targets before the policy lock', async () => {
    const lockedRouter = createRouter({ mode: 'policy_locked' });
    const responses = await Promise.all([
      lockedRouter('public', request('GET', '/setup', true)),
      lockedRouter('admin', request('GET', '/api/playback', true)),
      lockedRouter('public', request('GET', '/api/%70layback', true)),
      lockedRouter('admin', request('GET', '/auth/confirm/', true))
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404, 404
    ]);
  });
});
