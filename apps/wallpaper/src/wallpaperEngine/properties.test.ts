import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyWallpaperPreferencesPatch } from '@spotify-wallpaper/shared-types';
import { defaultSettings } from '../settings/defaultSettings';
import { parseWallpaperProperties, registerWallpaperPropertyListener } from './properties';

const encodeWallpaperEngineToken = (clientId: string, refreshToken: string): string => {
  const json = JSON.stringify({ v: 1, clientId, refreshToken });
  return encodeWallpaperEngineTokenBytes(new TextEncoder().encode(json));
};

const encodeWallpaperEngineTokenBytes = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `swpt1.${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
};

const backendPairingToken = `swpb1.${'A'.repeat(22)}.${'A'.repeat(43)}`;

afterEach(() => vi.unstubAllEnvs());

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
    expect(result.patch.spotify).toEqual({ provider: 'direct' });
  });

  it('auto-detects an swpb1 token and uses the release-configured backend', () => {
    vi.stubEnv('VITE_SPOTIFY_BACKEND_ORIGIN', 'https://api.wallpaper.example');

    const result = parseWallpaperProperties({
      spotify_refresh_token: { value: backendPairingToken }
    }, 'direct');

    expect(result.patch.spotify).toEqual({
      provider: 'backend',
      backendOrigin: 'https://api.wallpaper.example'
    });
    expect(result.credential).toEqual({
      kind: 'replace',
      value: { kind: 'backend', pairingToken: backendPairingToken }
    });
    expect(JSON.stringify(result.patch)).not.toContain(backendPairingToken);
    expect(result.warning).toBeNull();
  });

  it('selects direct mode from swpt1 even when the previous provider was backend', () => {
    const result = parseWallpaperProperties({
      spotify_refresh_token: { value: encodeWallpaperEngineToken('bundled-client-id', 'bundled-refresh-token') }
    }, 'backend');

    expect(result.patch.spotify).toEqual({ provider: 'direct' });
    expect(result.credential).toEqual({
      kind: 'replace',
      value: { kind: 'direct', clientId: 'bundled-client-id', refreshToken: 'bundled-refresh-token' }
    });
  });

  it('keeps swpb1 selected but reports a safe warning when this build has no backend origin', () => {
    const result = parseWallpaperProperties({
      spotify_refresh_token: { value: backendPairingToken },
      spotify_backend_url: { value: 'http://127.0.0.1:49320/' }
    });

    expect(result.patch.spotify).toEqual({ provider: 'backend', backendOrigin: '' });
    expect(result.credential).toEqual({
      kind: 'replace',
      value: { kind: 'backend', pairingToken: backendPairingToken }
    });
    expect(result.warning).toBe('Spotify backend is unavailable in this build.');
    expect(result.warning).not.toContain(backendPairingToken);
    const merged = applyWallpaperPreferencesPatch({
      ...defaultSettings,
      spotify: { ...defaultSettings.spotify, provider: 'backend', backendOrigin: 'http://127.0.0.1:49320/' }
    }, result.patch);
    expect(merged.spotify.backendOrigin).toBeUndefined();
  });

  it('ignores malformed unified tokens and clears credentials only for an empty field', () => {
    const malformed = parseWallpaperProperties({
      spotify_client_id: { value: 'client-id' },
      spotify_refresh_token: { value: 'swpt1.not-valid-base64' }
    });
    expect(malformed.credential).toEqual({ kind: 'retain' });
    expect(malformed.patch.spotify).toBeUndefined();
    expect(malformed.warning).toBe('Spotify Token format is invalid.');
    expect(malformed.warning).not.toContain('swpt1.not-valid-base64');
    expect(parseWallpaperProperties({ spotify_refresh_token: { value: '' } }).credential).toEqual({ kind: 'clear' });
    expect(parseWallpaperProperties({ spotify_pairing_token: { value: '' } }).credential).toEqual({ kind: 'clear' });
  });

  it('rejects a non-canonical swpb1 token without replacing credentials', () => {
    const nonCanonicalToken = `swpb1.${'A'.repeat(22)}.${'B'.repeat(43)}`;
    const result = parseWallpaperProperties({
      spotify_refresh_token: { value: nonCanonicalToken }
    });

    expect(result.credential).toEqual({ kind: 'retain' });
    expect(result.patch.spotify).toBeUndefined();
    expect(result.warning).toBe('Spotify Token format is invalid.');
    expect(result.warning).not.toContain(nonCanonicalToken);
  });

  it('retains the current credential when swpt1 contains malformed UTF-8', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, clientId: 'client-id', refreshToken: 'refresh-token' }));
    const clientValueStart = bytes.indexOf('c'.charCodeAt(0), bytes.indexOf('c'.charCodeAt(0)) + 1);
    bytes[clientValueStart] = 0x80;
    const malformedToken = encodeWallpaperEngineTokenBytes(bytes);

    const result = parseWallpaperProperties({ spotify_refresh_token: { value: malformedToken } });

    expect(result.credential).toEqual({ kind: 'retain' });
    expect(result.patch.spotify).toBeUndefined();
    expect(result.warning).toBe('Spotify Token format is invalid.');
    expect(result.warning).not.toContain(malformedToken);
  });

  it('does not revive hidden provider settings after an invalid unified token update', () => {
    vi.stubEnv('VITE_SPOTIFY_BACKEND_ORIGIN', 'https://api.wallpaper.example');
    const results: Array<ReturnType<typeof parseWallpaperProperties> & { settings?: typeof defaultSettings }> = [];
    let currentSettings = defaultSettings;
    const target = {} as Window;
    registerWallpaperPropertyListener(
      (result) => {
        results.push(result);
        currentSettings = result.settings ?? currentSettings;
      },
      target,
      () => currentSettings.spotify.provider,
      () => currentSettings
    );

    target.wallpaperPropertyListener?.applyUserProperties?.({
      settings_json: {
        value: JSON.stringify({
          schemaVersion: 2,
          spotify: { provider: 'direct', backendOrigin: 'http://127.0.0.1:49320/' }
        })
      },
      spotify_playback_provider: { value: 'direct' },
      spotify_backend_url: { value: 'http://127.0.0.1:49320/' },
      spotify_refresh_token: { value: backendPairingToken }
    });
    target.wallpaperPropertyListener?.applyUserProperties?.({
      spotify_refresh_token: { value: 'swpb1.invalid' }
    });

    expect(results[0].settings?.spotify).toMatchObject({
      provider: 'backend',
      backendOrigin: 'https://api.wallpaper.example'
    });
    expect(results[1].credential).toEqual({ kind: 'retain' });
    expect(results[1].patch.spotify).toBeUndefined();
    expect(results[1].settings?.spotify).toMatchObject({
      provider: 'backend',
      backendOrigin: 'https://api.wallpaper.example'
    });
  });

  it('keeps credentials outside the v2 preference patch', () => {
    const merged = applyWallpaperPreferencesPatch(defaultSettings, { debug: { enabled: true }, spotify: { provider: 'mock' } });

    expect(merged.debug.enabled).toBe(true);
    expect(merged.spotify.provider).toBe('mock');
    expect(JSON.stringify(merged)).not.toMatch(/clientId|refreshToken|pairingToken|hasRefreshToken/i);
  });

  it('parses finite visualizer slider values, including zero, in one partial patch', () => {
    const result = parseWallpaperProperties({
      visualizer_intensity: { value: 0 },
      visualizer_sensitivity: { value: 1.75 },
      visualizer_smoothing: { value: 0.2 },
      visualizer_decay: { value: 0.8 }
    });

    expect(result.patch.visualizer).toEqual({
      intensity: 0,
      sensitivity: 1.75,
      smoothing: 0.2,
      decay: 0.8
    });
  });

  it('parses the visualizer position property and ignores unsupported values', () => {
    expect(parseWallpaperProperties({ visualizer_position: { value: 'bottom-up' } }).patch.visualizer).toEqual({
      position: 'bottom-up'
    });
    expect(parseWallpaperProperties({ visualizer_position: { value: 'sideways' } }).patch.visualizer).toBeUndefined();
  });

  it('parses the glowing object toggle and ignores invalid values', () => {
    expect(parseWallpaperProperties({ glowing_objects_enabled: { value: false } }).patch.visualizer).toEqual({
      glowingObjectsEnabled: false
    });
    expect(parseWallpaperProperties({ glowing_objects_enabled: { value: true } }).patch.visualizer).toEqual({
      glowingObjectsEnabled: true
    });
    expect(parseWallpaperProperties({ glowing_objects_enabled: { value: 'false' } }).patch.visualizer).toBeUndefined();
  });

  it('ignores non-finite and non-numeric visualizer slider values', () => {
    const result = parseWallpaperProperties({
      visualizer_intensity: { value: Number.NaN },
      visualizer_sensitivity: { value: Number.POSITIVE_INFINITY },
      visualizer_smoothing: { value: '0.2' }
    });

    expect(result.patch.visualizer).toBeUndefined();
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

  it('does not reapply hidden Spotify properties during an unrelated callback', () => {
    const results: Array<ReturnType<typeof parseWallpaperProperties> & { settings?: typeof defaultSettings }> = [];
    let currentSettings = defaultSettings;
    const target = {} as Window;
    registerWallpaperPropertyListener(
      (result) => {
        results.push(result);
        currentSettings = result.settings ?? currentSettings;
      },
      target,
      () => currentSettings.spotify.provider,
      () => currentSettings
    );

    target.wallpaperPropertyListener?.applyUserProperties?.({
      spotify_playback_provider: { value: 'direct' },
      spotify_backend_url: { value: 'http://127.0.0.1:49320/' }
    });
    currentSettings = {
      ...currentSettings,
      spotify: { ...currentSettings.spotify, provider: 'backend', backendOrigin: 'https://api.wallpaper.example' }
    };
    target.wallpaperPropertyListener?.applyUserProperties?.({ debug_enabled: { value: true } });

    expect(results[1].patch.spotify).toBeUndefined();
    expect(results[1].settings?.spotify).toMatchObject({
      provider: 'backend',
      backendOrigin: 'https://api.wallpaper.example'
    });
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
