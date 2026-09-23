import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { describe, expect, it } from 'vitest';

describe('release preview origin', () => {
  it('keeps the release preview on the fixed loopback origin', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { scripts?: Record<string, string> };

    const command = packageJson.scripts?.preview?.split(/\s+/) ?? [];

    expect(command.slice(0, 2)).toEqual(['vite', 'preview']);
    const { values } = parseArgs({
      args: command.slice(2),
      options: {
        host: { type: 'string' },
        port: { type: 'string' },
        strictPort: { type: 'boolean' }
      },
      strict: false
    });
    expect(values).toMatchObject({ host: '127.0.0.1', port: '5173', strictPort: true });
  });
});
