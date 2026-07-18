import type { ApiResult, Env } from './contracts';

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

    return notFound();
  }
} satisfies ExportedHandler<Env>;
