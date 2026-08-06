import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('./worker-configuration.d.ts', import.meta.url);
const source = await readFile(path, 'utf8');
const normalized = `${source
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .join('\n')
  .trimEnd()}\n`;

await writeFile(path, normalized, 'utf8');
