import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import worker from '../src/index';

const baseUrl = 'http://127.0.0.1:8787';

describe('public API CORS', () => {
  it.each(['null', 'http://127.0.0.1:5173'])(
    'allows the explicit wallpaper origin %s',
    async (origin) => {
      const response = await worker.fetch(
        new Request(`${baseUrl}/api/playback`, {
          method: 'OPTIONS',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'authorization'
          }
        }),
        env
      );

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(response.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
      expect(response.headers.get('access-control-allow-headers')).toBe(
        'authorization, content-type'
      );
      expect(response.headers.get('access-control-allow-credentials')).toBeNull();
      expect(response.headers.get('vary')).toBe('Origin');
    }
  );

  it('does not reflect or process arbitrary origins and headers', async () => {
    const origin = 'https://attacker.example';
    const response = await worker.fetch(
      new Request(`${baseUrl}/api/control`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, x-attacker'
        }
      }),
      env
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('rejects actual API requests without an allowed Origin', async () => {
    const response = await worker.fetch(
      new Request(`${baseUrl}/api/playback`, {
        headers: {
          Authorization: 'Bearer malformed'
        }
      }),
      env
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
