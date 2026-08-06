import { describe, expect, it } from 'vitest';
import { applyWallpaperPreferencesPatch } from '@spotify-wallpaper/shared-types';
import { defaultSettings } from '../settings/defaultSettings';
import { parseWallpaperProperties, registerWallpaperPropertyListener } from './properties';

const encodeWallpaperEngineToken = (clientId: string, refreshToken: string): string => {
  const json = JSON.stringify({ v: 1, clientId, refreshToken });
  let binary = '';
  for (const byte of new TextEncoder().encode(json)) binary += String.fromCharCode(byte);
  return `swpt1.${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
};

describe('Wallpaper Engine property adapter', () => {
  it('parses preferences separately from backend credential input', () => {
    const result = parseWallpaperProperties({
      spotify_playback_provider: { value: 'backend' },
      spotify_backend_url: { value: 'https://localhost:49320/' },
      spotify_pairing_token: { value: 'secret-pairing-token' },
      selected_preset: { value: 'Bottom Player' },
      debug_enabled: { value: true }
    });

    expect(result.patch.spotify).toEqual({ provider: 'backend', backendOrigin: 'https://localhost:49320/' });
    expect(result.credential).toEqual({ kind: 'replace', value: { kind: 'backend', pairingToken: 'secret-pairing-token' } });
    expect(JSON.stringify(result.patch)).not.toMatch(/secret-pairing-token|pairingToken/i);
    expect(result.patch.layout?.preset).toBe('Bottom Player');
    expect(result.patch.debug?.enabled).toBe(true);
    expect(result.safetyGateOpen).toBe(true);
  });

  it('ignores credentials embedded in settings JSON', () => {
    const result = parseWallpaperProperties({
      settings_json: {
        value: JSON.stringify({
          schemaVersion: 1,
          spotify: { playbackProvider: 'direct', clientId: 'json-client', refreshToken: 'json-refresh-token', hasRefreshToken: true },
          debug: { enabled: true }
        })
      }
    });

    expect(result.patch).toEqual({});
    expect(result.settingsReplacement?.spotify.provider).toBe('direct');
    expect(result.settingsReplacement?.debug.enabled).toBe(true);
    expect(JSON.stringify(result.patch)).not.toMatch(/json-client|json-refresh-token|clientId|refreshToken/i);
    expect(result.credential).toEqual({ kind: 'retain' });
  });

  it('accepts direct credentials only from explicit Wallpaper Engine properties', () => {
    const result = parseWallpaperProperties({
      spotify_playback_provider: { value: 'direct' },
      spotify_client_id: { value: 'property-client' },
      spotify_refresh_token: { value: 'property-refresh-token' }
    });

    expect(result.credential).toEqual({ kind: 'replace', value: { kind: 'direct', clientId: 'property-client', refreshToken: 'property-refresh-token' } });
    expect(result.patch.spotify).toEqual({ provider: 'direct' });
  });

  it('parses the one-shot swpt1 property into the direct credential update', () => {
    const result = parseWallpaperProperties({
      spotify_refresh_token: { value: encodeWallpaperEngineToken('bundled-client-id', 'bundled-refresh-token') }
    });

    expect(result.credential).toEqual({ kind: 'replace', value: { kind: 'direct', clientId: 'bundled-client-id', refreshToken: 'bundled-refresh-token' } });
    expect(result.patch.spotify).toBeUndefined();
  });

  it('fails closed for malformed or cleared credential properties', () => {
    expect(parseWallpaperProperties({
      spotify_client_id: { value: 'client-id' },
      spotify_refresh_token: { value: 'swpt1.not-valid-base64' }
    }).credential).toEqual({ kind: 'clear' });
    expect(parseWallpaperProperties({ spotify_pairing_token: { value: '' } }).credential).toEqual({ kind: 'clear' });
  });

  it('keeps credentials outside the v2 preference patch', () => {
    const merged = applyWallpaperPreferencesPatch(defaultSettings, { debug: { enabled: true }, spotify: { provider: 'mock' } });

    expect(merged.debug.enabled).toBe(true);
    expect(merged.spotify.provider).toBe('mock');
    expect(JSON.stringify(merged)).not.toMatch(/clientId|refreshToken|pairingToken|hasRefreshToken/i);
  });

  it('accumulates partial Wallpaper Engine callbacks into a complete snapshot', () => {
    const results: ReturnType<typeof parseWallpaperProperties>[] = [];
    const target = {} as Window;
    registerWallpaperPropertyListener((result) => results.push(result), target);
    target.wallpaperPropertyListener?.applyUserProperties?.({ spotify_playback_provider: { value: 'backend' } });
    target.wallpaperPropertyListener?.applyUserProperties?.({
      spotify_backend_url: { value: 'http://127.0.0.1:49320/' },
      spotify_pairing_token: { value: 'pairing-token' }
    });

    expect(results).toHaveLength(2);
    expect(results[1].patch.spotify).toMatchObject({ provider: 'backend', backendOrigin: 'http://127.0.0.1:49320/' });
    expect(results[1].credential).toEqual({ kind: 'replace', value: { kind: 'backend', pairingToken: 'pairing-token' } });
  });

  it('closes the safety gate for future settings and keeps it closed for later callbacks', () => {
    const results: ReturnType<typeof parseWallpaperProperties>[] = [];
    const target = {} as Window;
    registerWallpaperPropertyListener((result) => results.push(result), target);
    target.wallpaperPropertyListener?.applyUserProperties?.({
      settings_json: { value: JSON.stringify({ schemaVersion: 99, spotify: { provider: 'direct' } }) }
    });
    target.wallpaperPropertyListener?.applyUserProperties?.({
      spotify_playback_provider: { value: 'direct' },
      spotify_client_id: { value: 'client' },
      spotify_refresh_token: { value: 'refresh' }
    });
    expect(results[0].safetyGateOpen).toBe(false);
    expect(results[1].safetyGateOpen).toBe(false);
  });

  it('resolves competing credential fields using the current provider, never arrival order', () => {
    const properties = {
      spotify_client_id: { value: 'direct-client' },
      spotify_refresh_token: { value: 'direct-refresh' },
      spotify_pairing_token: { value: 'backend-pairing' }
    };

    expect(parseWallpaperProperties(properties, 'direct').credential).toEqual({
      kind: 'replace',
      value: { kind: 'direct', clientId: 'direct-client', refreshToken: 'direct-refresh' }
    });
    expect(parseWallpaperProperties(properties, 'backend').credential).toEqual({
      kind: 'replace',
      value: { kind: 'backend', pairingToken: 'backend-pairing' }
    });
    expect(parseWallpaperProperties(properties).credential).toEqual({ kind: 'clear' });
  });

  it('selects provider from property patch, then settings replacement, then host hint', () => {
    const credentials = {
      spotify_client_id: { value: 'direct-client' },
      spotify_refresh_token: { value: 'direct-refresh' },
      spotify_pairing_token: { value: 'backend-pairing' }
    };
    const replacementSelected = parseWallpaperProperties({
      ...credentials,
      settings_json: { value: JSON.stringify({ schemaVersion: 2, spotify: { provider: 'direct' } }) }
    }, 'backend');
    const patchSelected = parseWallpaperProperties({
      ...credentials,
      settings_json: { value: JSON.stringify({ schemaVersion: 2, spotify: { provider: 'direct' } }) },
      spotify_playback_provider: { value: 'backend' }
    }, 'direct');

    expect(replacementSelected.credential).toEqual({
      kind: 'replace',
      value: { kind: 'direct', clientId: 'direct-client', refreshToken: 'direct-refresh' }
    });
    expect(patchSelected.credential).toEqual({
      kind: 'replace',
      value: { kind: 'backend', pairingToken: 'backend-pairing' }
    });
  });

  it('uses settings_json as a complete preference replacement, including optional fields', () => {
    const base = {
      ...defaultSettings,
      spotify: { ...defaultSettings.spotify, provider: 'backend' as const, backendOrigin: 'https://api.wallpaper.example' }
    };
    const result = parseWallpaperProperties({
      settings_json: { value: JSON.stringify({ schemaVersion: 2, spotify: { provider: 'mock' }, player: { displayMode: 'album-details' } }) }
    });
    const merged = applyWallpaperPreferencesPatch(result.settingsReplacement ?? base, result.patch);

    expect(merged.spotify.provider).toBe('mock');
    expect(merged.spotify.backendOrigin).toBeUndefined();
    expect(merged.player.displayMode).toBe('album-details');
  });

  it('applies individual properties over a complete settings JSON replacement', () => {
    const results: Array<ReturnType<typeof parseWallpaperProperties> & { settings?: typeof defaultSettings }> = [];
    const target = {} as Window;
    registerWallpaperPropertyListener(
      (result) => results.push(result),
      target,
      () => 'backend',
      () => defaultSettings
    );

    target.wallpaperPropertyListener?.applyUserProperties?.({
      settings_json: { value: JSON.stringify({ schemaVersion: 2, spotify: { provider: 'mock' }, debug: { enabled: false } }) },
      spotify_playback_provider: { value: 'direct' },
      debug_enabled: { value: true }
    });

    expect(results[0].settings?.spotify.provider).toBe('direct');
    expect(results[0].settings?.debug.enabled).toBe(true);
    expect(results[0].patch.spotify?.provider).toBe('direct');
    expect(results[0].settingsReplacement?.spotify.provider).toBe('mock');
  });
});
