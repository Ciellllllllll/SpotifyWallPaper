import type { ApiResult } from './contracts';
import {
  handleAuthCallback,
  handleAuthStart,
  handleReauthorize
} from './auth';
import { handleApiRequest } from './api';
import {
  purgeExpiredOAuthSessions,
  reconcileDeletionTombstones,
  type DeletionReconciliationResult
} from './db';
import {
  recordRequestMetric,
  recordScheduledMetric
} from './metrics';
import { privacyPage, setupPage, termsPage } from './pages';

interface HealthValue {
  service: 'spotify-wallpaper-backend';
}

const notFound = (): Response => {
  const body: ApiResult<never> = {
    ok: false,
    error: {
      kind: 'unavailable',
      message: 'Route not found.',
      status: 404
    }
  };
  return Response.json(body, { status: 404 });
};

type RouteHandler = (request: Request, env: Env) => Promise<Response>;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return fetchWithBoundary(request, env);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    context: ExecutionContext
  ): Promise<void> {
    context.waitUntil(runDeletionReconciler(env));
  }
} satisfies ExportedHandler<Env>;

export async function fetchWithBoundary(
  request: Request,
  env: Env,
  route: RouteHandler = routeRequest
): Promise<Response> {
  const startedAtMs = Date.now();
  try {
    const response = await route(request, env);
    safeRecordRequestMetric(env, request, response, Date.now() - startedAtMs);
    return response;
  } catch {
    const response = Response.json(
      {
        ok: false,
        error: {
          kind: 'unavailable',
          message: 'The backend is temporarily unavailable.',
          status: 500
        }
      } satisfies ApiResult<never>,
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Security-Policy':
            "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY'
        }
      }
    );
    safeRecordRequestMetric(env, request, response, Date.now() - startedAtMs);
    return response;
  }
}

async function routeRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      const body: ApiResult<HealthValue> = {
        ok: true,
        value: {
          service: 'spotify-wallpaper-backend'
        }
      };
      return Response.json(body);
    }
    if (request.method === 'GET' && url.pathname === '/setup') {
      return setupPage(env);
    }
    if (request.method === 'GET' && url.pathname === '/privacy') {
      return privacyPage();
    }
    if (request.method === 'GET' && url.pathname === '/terms') {
      return termsPage();
    }
    if (request.method === 'POST' && url.pathname === '/auth/start') {
      return handleAuthStart(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/auth/callback') {
      return handleAuthCallback(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/auth/reauthorize') {
      return handleReauthorize(request, env);
    }

    const apiResponse = await handleApiRequest(request, env);
    if (apiResponse !== null) {
      return apiResponse;
    }
    return notFound();
}

async function runDeletionReconciler(env: Env): Promise<void> {
  try {
    await purgeExpiredOAuthSessions(env.DB, Date.now());
    const result = await reconcileDeletionTombstones(
      env.DB,
      env.DELETION_DB,
      Date.now()
    );
    recordScheduledMetric(
      env,
      result.failedCount === 0 ? 'success' : 'partial_failure',
      result
    );
  } catch {
    const failedResult: DeletionReconciliationResult = {
      attemptedCount: 0,
      reconciledCount: 0,
      failedCount: 0,
      pendingCount: 0,
      oldestPendingAgeMs: 0,
      maxRetryCount: 0
    };
    recordScheduledMetric(env, 'failed', failedResult);
  }
}

function safeRecordRequestMetric(
  env: Env,
  request: Request,
  response: Response,
  elapsedMs: number
): void {
  try {
    recordRequestMetric(env, request, response, elapsedMs);
  } catch {
    // Metrics are best-effort and must not escape the Worker boundary.
  }
}
