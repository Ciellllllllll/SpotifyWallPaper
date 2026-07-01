import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const githubPagesFallback = (): Plugin => ({
  name: 'github-pages-fallback',
  closeBundle() {
    const dist = resolve(__dirname, 'dist');
    const index = resolve(dist, 'index.html');
    const fallback = resolve(dist, '404.html');
    const callback = resolve(dist, 'callback', 'index.html');

    mkdirSync(dirname(callback), { recursive: true });
    copyFileSync(index, fallback);
    copyFileSync(index, callback);
  }
});

export default defineConfig({
  base: process.env.VITE_AUTH_BASE_PATH ?? '/SpotifyWallPaper/spotify-auth/',
  plugins: [githubPagesFallback()],
  server: {
    host: '127.0.0.1',
    port: 1430,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
