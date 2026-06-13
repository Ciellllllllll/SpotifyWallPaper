import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../settings/defaultSettings';
import { applySettingsPatch, parseWallpaperProperties } from './properties';

describe('Wallpaper Engine property adapter', () => {
  it('parses basic Wallpaper Engine properties into a settings patch', () => {
    const result = parseWallpaperProperties({
      spotify_client_id: { value: 'client-id' },
      spotify_refresh_token: { value: 'secret-refresh-token' },
      selected_preset: { value: 'Bottom Player' },
      visualizer_enabled: { value: false },
      lyrics_enabled: { value: true },
      performance_mode: { value: 'low-power' },
      debug_enabled: { value: true }
    });

    expect(result.warning).toBeNull();
    expect(result.patch).toMatchObject({
      spotify: {
        clientId: 'client-id',
        refreshToken: 'secret-refresh-token',
        hasRefreshToken: true
      },
      layout: { preset: 'Bottom Player' },
      visualizer: { enabled: false },
      lyrics: { enabled: true },
      performance: { mode: 'low-power' },
      debug: { enabled: true }
    });
  });

  it('merges settings JSON with explicit property overrides', () => {
    const result = parseWallpaperProperties({
      settings_json: {
        value: JSON.stringify({
          spotify: {
            clientId: 'json-client',
            refreshToken: 'json-refresh-token'
          },
          debug: {
            enabled: false
          }
        })
      },
      debug_enabled: { value: true }
    });
    const merged = applySettingsPatch(defaultSettings, result.patch);

    expect(merged.spotify.clientId).toBe('json-client');
    expect(merged.spotify.refreshToken).toBe('json-refresh-token');
    expect(merged.debug.enabled).toBe(true);
  });

  it('applies background and theme settings from pasted settings JSON', () => {
    const result = parseWallpaperProperties({
      settings_json: {
        value: JSON.stringify({
          theme: {
            mode: 'custom',
            textColor: '#101820',
            autoReadability: false,
            customPrimaryColor: '#f2aa4c'
          },
          background: {
            mode: 'solid-color',
            opacity: 0.44,
            blurPx: 14,
            solidColor: '#222831'
          }
        })
      }
    });
    const merged = applySettingsPatch(defaultSettings, result.patch);

    expect(result.warning).toBeNull();
    expect(merged.theme).toMatchObject({
      mode: 'custom',
      textColor: '#101820',
      autoReadability: false,
      customPrimaryColor: '#f2aa4c'
    });
    expect(merged.background).toMatchObject({
      mode: 'solid-color',
      opacity: 0.44,
      blurPx: 14,
      solidColor: '#222831'
    });
  });

  it('applies visualizer tuning settings from pasted settings JSON', () => {
    const result = parseWallpaperProperties({
      settings_json: {
        value: JSON.stringify({
          visualizer: {
            enabled: true,
            mode: 'waveform-line',
            intensity: 1.4,
            sensitivity: 1.6,
            barCount: 40,
            colorMode: 'accent'
          }
        })
      }
    });
    const merged = applySettingsPatch(defaultSettings, result.patch);

    expect(merged.visualizer).toMatchObject({
      enabled: true,
      mode: 'waveform-line',
      intensity: 1.4,
      sensitivity: 1.6,
      barCount: 40,
      colorMode: 'accent'
    });
  });

  it('applies lyrics settings from pasted settings JSON', () => {
    const result = parseWallpaperProperties({
      settings_json: {
        value: JSON.stringify({
          lyrics: {
            enabled: true,
            sourceText: '[00:01.00]One',
            mode: 'context',
            offsetMs: 1200,
            showMissingState: false
          }
        })
      }
    });
    const merged = applySettingsPatch(defaultSettings, result.patch);

    expect(merged.lyrics).toMatchObject({
      enabled: true,
      sourceText: '[00:01.00]One',
      mode: 'context',
      offsetMs: 1200,
      showMissingState: false
    });
  });

  it('falls back safely for malformed settings JSON without exposing token-like values in warnings', () => {
    const result = parseWallpaperProperties({
      settings_json: { value: '{secret-refresh-token' }
    });

    expect(result.warning).toContain('malformed');
    expect(result.warning).not.toContain('secret-refresh-token');
  });
});
