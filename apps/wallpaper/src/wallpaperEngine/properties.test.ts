import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../settings/defaultSettings';
import { applySettingsPatch, parseWallpaperProperties } from './properties';

const encodeWallpaperEngineToken = (clientId: string, refreshToken: string): string => {
  const json = JSON.stringify({ v: 1, clientId, refreshToken });
  let binary = '';
  for (const byte of new TextEncoder().encode(json)) {
    binary += String.fromCharCode(byte);
  }
  return `swpt1.${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
};

describe('Wallpaper Engine property adapter', () => {
  it('parses basic Wallpaper Engine properties into a settings patch', () => {
    const result = parseWallpaperProperties({
      spotify_client_id: { value: 'client-id' },
      spotify_refresh_token: { value: 'secret-refresh-token' },
      selected_preset: { value: 'Bottom Player' },
      background_mode: { value: 'solid-color' },
      theme_mode: { value: 'fallback' },
      album_art_visible: { value: false },
      track_text_visible: { value: true },
      player_visible: { value: true },
      player_controls_enabled: { value: false },
      player_show_device: { value: false },
      player_show_volume: { value: true },
      player_show_shuffle_repeat: { value: false },
      seekbar_visible: { value: true },
      seekbar_style: { value: 'album-ring' },
      visualizer_enabled: { value: false },
      visualizer_mode: { value: 'waveform-line' },
      lyrics_enabled: { value: true },
      lyrics_mode: { value: 'context' },
      transitions_enabled: { value: true },
      transition_preset: { value: 'blur-fade' },
      clock_enabled: { value: true },
      clock_hour12: { value: true },
      clock_show_seconds: { value: true },
      clock_show_date: { value: true },
      clock_show_weekday: { value: false },
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
      background: { mode: 'solid-color' },
      theme: { mode: 'fallback' },
      albumArt: { visible: false },
      text: { visible: true },
      player: {
        visible: true,
        controlsEnabled: false,
        showDevice: false,
        showVolume: true,
        showShuffleRepeat: false
      },
      seekbar: { visible: true, style: 'album-ring' },
      visualizer: { enabled: false, mode: 'waveform-line' },
      lyrics: { enabled: true, mode: 'context' },
      transitions: { enabled: true, preset: 'blur-fade' },
      clock: {
        enabled: true,
        hour12: true,
        showSeconds: true,
        showDate: true,
        showWeekday: false
      },
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

  it('accepts a single Wallpaper Engine token in the refresh token property', () => {
    const result = parseWallpaperProperties({
      spotify_refresh_token: { value: encodeWallpaperEngineToken('bundled-client-id', 'bundled-refresh-token') }
    });

    expect(result.warning).toBeNull();
    expect(result.patch.spotify).toEqual({
      clientId: 'bundled-client-id',
      refreshToken: 'bundled-refresh-token',
      hasRefreshToken: true
    });
  });

  it('does not treat malformed Wallpaper Engine token bundles as raw refresh tokens', () => {
    const result = parseWallpaperProperties({
      spotify_client_id: { value: 'client-id' },
      spotify_refresh_token: { value: 'swpt1.not-valid-base64' }
    });

    expect(result.warning).toBeNull();
    expect(result.patch.spotify).toEqual({
      clientId: 'client-id',
      refreshToken: '',
      hasRefreshToken: false
    });
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

  it('applies transition settings from pasted settings JSON', () => {
    const result = parseWallpaperProperties({
      settings_json: {
        value: JSON.stringify({
          transitions: {
            enabled: true,
            preset: 'blur-fade',
            durationMs: 900,
            easing: 'ease-in-out',
            background: true,
            albumArt: false,
            text: true,
            lyrics: false,
            visualizer: true,
            reduceMotion: true
          }
        })
      }
    });
    const merged = applySettingsPatch(defaultSettings, result.patch);

    expect(merged.transitions).toMatchObject({
      enabled: true,
      preset: 'blur-fade',
      durationMs: 900,
      easing: 'ease-in-out',
      albumArt: false,
      lyrics: false,
      visualizer: true,
      reduceMotion: true
    });
  });

  it('applies player, seekbar, and clock settings from pasted settings JSON', () => {
    const result = parseWallpaperProperties({
      settings_json: {
        value: JSON.stringify({
          player: {
            visible: true,
            controlsEnabled: false,
            showDevice: false,
            showVolume: true,
            showShuffleRepeat: false
          },
          seekbar: {
            visible: true,
            style: 'album-ring'
          },
          clock: {
            enabled: true,
            hour12: true,
            showSeconds: true,
            showDate: true,
            showWeekday: true,
            fontSizePx: 48,
            fontWeight: 800,
            letterSpacingPx: 2,
            opacity: 0.8,
            colorMode: 'fixed',
            fixedColor: '#abcdef'
          }
        })
      }
    });
    const merged = applySettingsPatch(defaultSettings, result.patch);

    expect(merged.player).toMatchObject({
      controlsEnabled: false,
      showDevice: false,
      showVolume: true,
      showShuffleRepeat: false
    });
    expect(merged.seekbar.style).toBe('album-ring');
    expect(merged.clock).toMatchObject({
      hour12: true,
      showSeconds: true,
      showDate: true,
      showWeekday: true,
      fontSizePx: 48,
      fontWeight: 800,
      letterSpacingPx: 2,
      opacity: 0.8,
      colorMode: 'fixed',
      fixedColor: '#abcdef'
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
