import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('GET /health', () => {
  it('returns a redacted service response', async () => {
    const response = await SELF.fetch('https://worker.test/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      value: {
        service: 'spotify-wallpaper-backend'
      }
    });
  });

  it('returns a redacted envelope for unknown routes', async () => {
    const response = await SELF.fetch('https://worker.test/not-found');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        kind: 'unavailable',
        message: 'Route not found.',
        status: 404
      }
    });
  });
});
