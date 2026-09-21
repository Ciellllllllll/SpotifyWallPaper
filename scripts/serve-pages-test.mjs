// Local artifact test server. Never logs request URLs (callbacks contain secrets).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
const root = resolve('apps/spotify-auth/pages');
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:1431');
    if (!url.pathname.startsWith('/SpotifyWallPaper/')) throw Error();
    let path = resolve(root, '.' + decodeURIComponent(url.pathname.slice('/SpotifyWallPaper'.length)));
    if (!path.startsWith(root + sep)) throw Error();
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    const body = await readFile(path);
    response.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' })[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
}).listen(1431, '127.0.0.1');
