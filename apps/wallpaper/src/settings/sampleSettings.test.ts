import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadSettings } from './loadSettings';

const examplesDir = fileURLToPath(new URL('../../../../examples/settings/', import.meta.url));
const secretValuePattern = /(secret-|access[_-]?token=|refresh[_-]?token=|authorization[_-]?code=|client[_-]?secret=)/i;

describe('sample settings', () => {
  it('keeps example settings parseable and free of credential values', () => {
    const files = readdirSync(examplesDir).filter((file) => file.endsWith('.json'));

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(join(examplesDir, file), 'utf8');
      const loaded = loadSettings(source);

      expect(() => JSON.parse(source), file).not.toThrow();
      expect(source, file).not.toMatch(secretValuePattern);
      expect(loaded.warning ?? '', file).not.toContain('malformed');
      expect(loaded.settings.schemaVersion, file).toBe(1);
    }
  });
});
