import { existsSync } from 'node:fs';

const required = [
  'apps/wallpaper/public/wasm/spotify_wallpaper_visual_core.js',
  'apps/wallpaper/public/wasm/spotify_wallpaper_visual_core_bg.wasm'
];
const missing = required.filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error(`WASM parity requires generated artifacts: ${missing.join(', ')}`);
  process.exit(1);
}
