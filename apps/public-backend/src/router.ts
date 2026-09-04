import type { IncomingMessage } from 'node:http';
import type { SpotifyMode } from './config.js';
import { apiError } from './http.js';
import { healthPage, privacyPage, termsPage } from './pages.js';

export type SocketKind = 'public' | 'admin';

export type RouteId =
  | 'authCallback'
  | 'playback'
  | 'control'
  | 'account'
  | 'playbackOptions'
  | 'controlOptions'
  | 'setup'
  | 'authStart'
  | 'authConfirmGet'
  | 'authConfirmPost'
  | 'reauthorize';

export type RouteHandler = (
  request: Request
) => Response | Promise<Response>;

export type RequestFactory = () => Request | Promise<Request>;

export type Router = (
  socket: SocketKind,
  request: IncomingMessage,
  requestFactory?: RequestFactory,
  rejectUnsupportedExpectation?: boolean
) => Promise<Response>;

interface RouterOptions {
  mode: SpotifyMode;
  handlers?: Partial<Record<RouteId, RouteHandler>>;
}

type BuiltinRoute = 'health' | 'privacy' | 'terms';

interface RouteDefinition {
  spotify: boolean;
  methods: Readonly<Record<string, RouteId | BuiltinRoute>>;
}

const publicRoutes: Readonly<Record<string, RouteDefinition>> = {
  '/health': { spotify: false, methods: { GET: 'health' } },
  '/privacy': { spotify: false, methods: { GET: 'privacy' } },
  '/terms': { spotify: false, methods: { GET: 'terms' } },
  '/auth/callback': {
    spotify: true,
    methods: { GET: 'authCallback' }
  },
  '/api/playback': {
    spotify: true,
    methods: { GET: 'playback', OPTIONS: 'playbackOptions' }
  },
  '/api/control': {
    spotify: true,
    methods: { POST: 'control', OPTIONS: 'controlOptions' }
  },
  '/api/account': {
    spotify: true,
    methods: { DELETE: 'account' }
  }
};

const adminRoutes: Readonly<Record<string, RouteDefinition>> = {
  '/setup': { spotify: true, methods: { GET: 'setup' } },
  '/auth/start': { spotify: true, methods: { POST: 'authStart' } },
  '/auth/confirm': {
    spotify: true,
    methods: { GET: 'authConfirmGet', POST: 'authConfirmPost' }
  },
  '/auth/reauthorize': {
    spotify: true,
    methods: { POST: 'reauthorize' }
  }
};

export function createRouter({
  mode,
  handlers = {}
}: RouterOptions): Router {
  return async (
    socket,
    request,
    requestFactory,
    rejectUnsupportedExpectation = false
  ) => {
    const path = classifyRawTarget(request.url);
    const definition =
      path === null
        ? undefined
        : (socket === 'public' ? publicRoutes : adminRoutes)[path];
    const route = definition?.methods[request.method ?? ''];
    if (mode === 'policy_locked' && definition?.spotify && route !== undefined) {
      return policyLocked();
    }
    if (rejectUnsupportedExpectation) {
      return unsupportedExpectation();
    }
    if (definition === undefined || route === undefined) {
      return notFound();
    }
    if (route === 'health') {
      return healthPage();
    }
    if (route === 'privacy') {
      return privacyPage();
    }
    if (route === 'terms') {
      return termsPage();
    }
    const handler = handlers[route];
    if (handler === undefined) {
      return notImplemented();
    }
    return handler(
      await (requestFactory ?? (() => minimalRequest(request)))()
    );
  };
}

function minimalRequest(request: IncomingMessage): Request {
  return new Request(`http://unix${request.url ?? '/'}`, {
    method: request.method ?? 'GET'
  });
}

function classifyRawTarget(rawTarget: string | undefined): string | null {
  if (
    rawTarget === undefined ||
    !rawTarget.startsWith('/') ||
    rawTarget.length > 4096
  ) {
    return null;
  }
  const queryIndex = rawTarget.indexOf('?');
  const path =
    queryIndex === -1 ? rawTarget : rawTarget.slice(0, queryIndex);
  if (path.includes('%') || path.includes('#')) {
    return null;
  }
  if (queryIndex !== -1 && path !== '/auth/callback') {
    return null;
  }
  return path;
}

function policyLocked(): Response {
  return apiError(
    503,
    'unavailable',
    'Spotify routes are disabled by policy.'
  );
}

function notFound(): Response {
  return apiError(404, 'unavailable', 'Route not found.');
}

function notImplemented(): Response {
  return apiError(501, 'unavailable', 'Route is not implemented.');
}

function unsupportedExpectation(): Response {
  return new Response(null, {
    status: 417,
    headers: {
      'Cache-Control': 'no-store',
      Connection: 'close'
    }
  });
}
