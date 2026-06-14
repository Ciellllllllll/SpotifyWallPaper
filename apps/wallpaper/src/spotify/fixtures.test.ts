import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { classifyNetworkError, classifySpotifyStatus } from './errors';

const errorFixturesDir = fileURLToPath(new URL('../../../../tests/fixtures/spotify/errors/', import.meta.url));

describe('Spotify error fixtures', () => {
  it('match current error classification behavior', () => {
    const files = readdirSync(errorFixturesDir).filter((file) => file.endsWith('.json'));

    expect(files).toEqual(
      expect.arrayContaining(['401-unauthorized.json', '403-forbidden.json', '429-rate-limited.json', 'network-error.json'])
    );

    for (const file of files) {
      const fixture = JSON.parse(readFileSync(join(errorFixturesDir, file), 'utf8')) as {
        status: number | null;
        headers: Record<string, string>;
        expectedKind: string;
        expectedRetryAfterMs?: number;
      };
      const error =
        fixture.status === null
          ? classifyNetworkError()
          : classifySpotifyStatus(fixture.status, fixture.headers['retry-after']);

      expect(error.kind, file).toBe(fixture.expectedKind);
      if (fixture.expectedRetryAfterMs !== undefined) {
        expect(error.retryAfterMs, file).toBe(fixture.expectedRetryAfterMs);
      }
    }
  });
});
