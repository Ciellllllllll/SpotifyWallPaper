import { describe, expect, it, vi, afterEach } from 'vitest';
import { BackendPlaybackProvider } from './providers/backendProvider';
import type { WallpaperEngineProperties } from '../wallpaperEngine/types';
import { parseWallpaperProperties, registerWallpaperPropertyListener } from '../wallpaperEngine/properties';

afterEach(() => vi.unstubAllEnvs());
describe('retired public backend', () => {
  it('never sends credentials to the former build-time public origin', async () => {
    vi.stubEnv('VITE_SPOTIFY_BACKEND_ORIGIN', 'https://api.wallpaper.example');
    const fetcher = vi.fn();
    const provider = new BackendPlaybackProvider({ backendUrl: 'https://api.wallpaper.example', pairingToken: 'test-only' }, fetcher);
    expect((await provider.pollAt(0)).ok).toBe(false);
    expect((await provider.controlAt({ type: 'next' }, 0)).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('retains direct credentials and settings when old pairing data is replayed', () => {
    const result = parseWallpaperProperties({
      spotify_refresh_token: { value: `swpb1.${'A'.repeat(22)}.${'A'.repeat(43)}` },
      spotify_playback_provider: { value: 'backend' },
      debug_enabled: { value: true }
    }, 'direct');
    expect(result.credential).toEqual({ kind: 'retain' });
    expect(result.patch.spotify).toBeUndefined();
    expect(result.patch.debug).toEqual({ enabled: true });
    expect(result.warning).toBe('Public Spotify backend has been retired. Reauthorize using the GitHub Pages authentication page.');
  });
});


it.each<WallpaperEngineProperties>([{}, { spotify_playback_provider: { value: 'backend' }, spotify_backend_url: { value: 'https://api.wallpaper.example' } }])('retains direct authorization when the old dedicated pairing field is replayed', (properties) => {
  const result = parseWallpaperProperties({ ...properties, spotify_pairing_token: { value: `swpb1.${'A'.repeat(22)}.${'A'.repeat(43)}` } }, 'direct');
  expect(result.credential).toEqual({ kind: 'retain' });
  expect(result.patch.spotify).toBeUndefined();
  expect(result.warning).toContain('Reauthorize using the GitHub Pages');
});


it('retains simultaneous legacy replay but lets a later explicit empty field disconnect', () => {
  const results: Array<ReturnType<typeof parseWallpaperProperties>> = [];
  const target = {} as Window;
  registerWallpaperPropertyListener(result => results.push(result), target, () => 'direct');
  target.wallpaperPropertyListener?.applyUserProperties?.({
    spotify_refresh_token: { value: '' },
    spotify_pairing_token: { value: `swpb1.${'A'.repeat(22)}.${'A'.repeat(43)}` },
    spotify_playback_provider: { value: 'backend' }
  });
  expect(results[0].credential).toEqual({ kind: 'retain' });
  expect(results[0].patch.spotify).toBeUndefined();
  target.wallpaperPropertyListener?.applyUserProperties?.({ spotify_refresh_token: { value: '' } });
  expect(results[1].credential).toEqual({ kind: 'clear' });
});
