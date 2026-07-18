import type { ApiResult } from './contracts';
import {
  handleAuthCallback,
  handleAuthStart,
  handleReauthorize
} from './auth';
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
  async fetch(request: Request, _env: Env): Promise<Response> {
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
      return handleAuthStart(request, _env);
    }
    if (request.method === 'GET' && url.pathname === '/auth/callback') {
      return handleAuthCallback(request, _env);
    }
    if (request.method === 'POST' && url.pathname === '/auth/reauthorize') {
      return handleReauthorize(request, _env);
    }

    return notFound();
  }
} satisfies ExportedHandler<Env>;
