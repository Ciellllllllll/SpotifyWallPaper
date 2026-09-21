import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import pages from './pages-config.json';

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
  base: pages.base,
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
