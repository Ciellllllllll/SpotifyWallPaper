import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const dist = 'apps/spotify-auth/dist';
const out = 'apps/spotify-auth/pages';
const authOut = join(out, 'spotify-auth');
const pages = JSON.parse(readFileSync(new URL('./pages-config.json', import.meta.url), 'utf8'));
const root = resolve('.');
if (!resolve(out).startsWith(root + sep) || resolve(out) !== resolve('apps/spotify-auth/pages')) throw new Error('Invalid Pages output.');
// Static allowlist; never publish an arbitrary directory copied from the repository.
function validate(directory, assets = false) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) throw new Error('Pages input link rejected.');
    if (info.isDirectory() && !assets && ['assets', 'callback'].includes(name)) validate(path, name === 'assets');
    else if (!info.isFile() || !(assets ? /^[A-Za-z0-9_-]+\.(js|css)$/.test(name) : ['index.html', '404.html'].includes(name))) throw new Error('Unexpected Pages input.');
  }
}
validate(dist);

rmSync(out, { recursive: true, force: true });
mkdirSync(authOut, { recursive: true });
cpSync(dist, authOut, { recursive: true });
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="referrer" content="no-referrer"><title>Spotify Wallpaper Auth</title></head><body><a href="${pages.base}">Spotify認証ページを開く</a></body></html>`
);
