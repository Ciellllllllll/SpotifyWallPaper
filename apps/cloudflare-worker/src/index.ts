import type { ApiResult } from './contracts';
import {
  handleAuthCallback,
  handleAuthStart,
  handleReauthorize
} from './auth';
import { handleApiRequest } from './api';
import { reconcileDeletionTombstones } from './db';
import { setupPage } from './pages';

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      return setupPage();
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
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    context: ExecutionContext
  ): Promise<void> {
    context.waitUntil(reconcileDeletionTombstones(env.DB, env.DELETION_DB, Date.now()));
  }
} satisfies ExportedHandler<Env>;
