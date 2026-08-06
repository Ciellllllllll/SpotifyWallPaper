import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('release preview origin', () => {
  it('uses the same strict loopback origin allowed by the public Worker', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.preview).toBe(
      'vite preview --host 127.0.0.1 --port 5173 --strictPort'
    );
  });
});
