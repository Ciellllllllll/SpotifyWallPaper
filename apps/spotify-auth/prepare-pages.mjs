import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'apps/spotify-auth/dist';
const out = 'apps/spotify-auth/pages';
const authOut = join(out, 'spotify-auth');

rmSync(out, { recursive: true, force: true });
mkdirSync(authOut, { recursive: true });
cpSync(dist, authOut, { recursive: true });
writeFileSync(
  join(out, 'index.html'),
  '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="refresh" content="0; url=/SpotifyWallPaper/spotify-auth/"><title>Spotify Wallpaper Auth</title></head><body><a href="/SpotifyWallPaper/spotify-auth/">Open Spotify Wallpaper Auth</a></body></html>'
);
