import { describe, expect, it } from 'vitest';
import type { LayoutPresetName } from './view';
import {
  applyWallpaperPreferencesPatch,
  clonePresetItems,
  defaultLayoutPreset,
  defaultWallpaperPreferences,
  layoutPresets,
  layoutPresetNames,
  migrateWallpaperSettingsToV2,
  repairWallpaperPreferences,
  serializeWallpaperPreferences,
  type WallpaperPreferencesPatch
} from './settings';

const forbiddenKeys = /(clientId|clientSecret|refreshToken|pairingToken|hasRefreshToken|accessToken|authorizationCode|oauthState|pkceVerifier)/i;

describe('WallpaperPreferences v2', () => {
  it('applies category patches without losing unchanged preferences', () => {
    const base = defaultWallpaperPreferences();
    base.theme.textColor = '#123456';
    base.visualizer.smoothing = 0.81;

    const patched = applyWallpaperPreferencesPatch(base, {
      background: { opacity: 0.4 },
      player: { controlsEnabled: false }
    });

    expect(patched.background.opacity).toBe(0.4);
    expect(patched.player.controlsEnabled).toBe(false);
    expect(patched.theme.textColor).toBe('#123456');
    expect(patched.visualizer.smoothing).toBe(0.81);
  });

  it('replaces layout items, repairs ranges, and strips unknown or credential fields', () => {
    const base = defaultWallpaperPreferences();
    base.layout.items.trackText.width = 913;
    base.spotify.backendOrigin = 'https://backend.example';
    const replacementItems = clonePresetItems('Minimal');
    replacementItems.albumArt.x = 17;
    const patch = {
      schemaVersion: 99,
      spotify: {
        backendOrigin: undefined,
        refreshToken: 'secret-refresh-token'
      },
      layout: { items: replacementItems },
      visualizer: { barCount: 999 },
      unknownCategory: { enabled: true }
    } as unknown as WallpaperPreferencesPatch;

    const patched = applyWallpaperPreferencesPatch(base, patch);

    expect(patched.schemaVersion).toBe(2);
    expect(patched.spotify.backendOrigin).toBeUndefined();
    expect(patched.layout.items.albumArt.x).toBe(17);
    expect(patched.layout.items.trackText.width).toBe(replacementItems.trackText.width);
    expect(patched.visualizer.barCount).toBe(160);
    expect(JSON.stringify(patched)).not.toMatch(forbiddenKeys);
    expect(patched).not.toHaveProperty('unknownCategory');
  });

  it('has mock and album-only defaults without credential fields', () => {
    const preferences = defaultWallpaperPreferences();

    expect(preferences.schemaVersion).toBe(2);
    expect(preferences.spotify).toMatchObject({
      provider: 'mock',
      pollIntervalPlayingMs: 1000,
      pollIntervalPausedMs: 3000
    });
    expect(preferences.spotify).not.toHaveProperty('clientId');
    expect(preferences.player.displayMode).toBe('album-only');
    expect(preferences.layout.preset).toBe(defaultLayoutPreset);
  });

  it('migrates v1 display preferences and drops all credential fields', () => {
    const result = migrateWallpaperSettingsToV2({
      schemaVersion: 1,
      spotify: {
        playbackProvider: 'backend',
        backendUrl: 'https://backend.example.test/',
        clientId: 'client-id',
        refreshToken: 'refresh-token',
        pairingToken: 'pairing-token',
        hasRefreshToken: true,
        pollIntervalPlayingMs: 250
      },
      layout: {
        preset: 'Bottom Player'
      },
      player: {
        visible: false
      }
    });

    expect(result.status).toBe('migrated');
    expect(result.reauthorizationRequired).toBe(true);
    expect(result.preferences.schemaVersion).toBe(2);
    expect(result.preferences.spotify).toMatchObject({
      provider: 'backend',
      backendOrigin: 'https://backend.example.test/',
      pollIntervalPlayingMs: 500
    });
    expect(result.preferences.player).toMatchObject({ visible: false, displayMode: 'album-only' });
    expect(result.preferences).not.toHaveProperty('lyrics');
    expect(JSON.stringify(result.preferences)).not.toMatch(forbiddenKeys);
  });

  it('preserves every display preference category during v1 migration', () => {
    const result = migrateWallpaperSettingsToV2({
      schemaVersion: 1,
      layout: { preset: 'Minimal' },
      theme: { mode: 'custom', textColor: '#112233', autoReadability: false },
      background: { mode: 'solid-color', opacity: 0.2, blurPx: 12, solidColor: '#334455' },
      albumArt: { visible: false },
      text: { visible: false },
      player: { visible: false, controlsEnabled: false, showDevice: false, showVolume: false, showShuffleRepeat: false },
      seekbar: { visible: false, style: 'album-ring' },
      visualizer: { enabled: false, mode: 'waveform-line', intensity: 0.4 },
      clock: { enabled: false, hour12: true, showSeconds: true },
      transitions: { enabled: true, preset: 'slide-left', durationMs: 1200 },
      performance: { mode: 'low-power' },
      rainmeter: { enabled: true, outputPath: 'D:\\Rainmeter\\NowPlaying.json' },
      debug: { enabled: true }
    });

    expect(result.preferences).toMatchObject({
      layout: { preset: 'Minimal' },
      theme: { mode: 'custom', textColor: '#112233', autoReadability: false },
      background: { mode: 'solid-color', opacity: 0.2, blurPx: 12, solidColor: '#334455' },
      albumArt: { visible: false },
      text: { visible: false },
      player: { visible: false, controlsEnabled: false, displayMode: 'album-only' },
      seekbar: { visible: false, style: 'album-ring' },
      visualizer: { enabled: false, mode: 'waveform-line', intensity: 0.4 },
      clock: { enabled: false, hour12: true, showSeconds: true },
      transitions: { enabled: true, preset: 'slide-left', durationMs: 1200 },
      performance: { mode: 'low-power' },
      rainmeter: { enabled: true, outputPath: 'D:\\Rainmeter\\NowPlaying.json' },
      debug: { enabled: true }
    });
  });

  it('uses safe defaults for malformed and future input without downgrade', () => {
    const malformed = migrateWallpaperSettingsToV2('{not-json');
    const future = migrateWallpaperSettingsToV2({ schemaVersion: 99, player: { visible: false } });

    expect(malformed.status).toBe('malformed');
    expect(malformed.preferences).toEqual(defaultWallpaperPreferences());
    expect(malformed.warning).toBe('Settings input was malformed; safe v2 defaults are active.');
    expect(future.status).toBe('future');
    expect(future.preferences).toEqual(defaultWallpaperPreferences());
    expect(future.warning).toBe('Settings schema is newer than supported v2; safe defaults are active.');
  });

  it('rejects invalid explicit schema versions instead of treating them as v1', () => {
    for (const schemaVersion of ['2', null, -1, 1.5, Number.NaN]) {
      const result = migrateWallpaperSettingsToV2({ schemaVersion });

      expect(result.status, String(schemaVersion)).toBe('malformed');
      expect(result.preferences).toEqual(defaultWallpaperPreferences());
      expect(result.warning).toBe('Settings schema version was invalid; safe v2 defaults are active.');
    }
  });

  it('repairs ranges and preserves a preference-only round trip', () => {
    const repaired = repairWallpaperPreferences({
      schemaVersion: 2,
      spotify: { provider: 'mock', pollIntervalPlayingMs: 1, pollIntervalPausedMs: 99_999 },
      player: { displayMode: 'album-details', visible: true },
      background: { opacity: 2, blurPx: -10 },
      visualizer: { intensity: 4, barCount: 500 },
      transitions: { durationMs: 10_000 },
      lyrics: { enabled: true },
      clientId: 'secret-client-id',
      refreshToken: 'secret-refresh-token'
    });

    expect(repaired.repaired).toBe(true);
    expect(repaired.preferences.spotify).toMatchObject({
      pollIntervalPlayingMs: 500,
      pollIntervalPausedMs: 60_000
    });
    expect(repaired.preferences.player.displayMode).toBe('album-details');
    expect(repaired.preferences.background).toMatchObject({ opacity: 1, blurPx: 0 });
    expect(repaired.preferences.visualizer).toMatchObject({ intensity: 2, barCount: 160 });
    expect(repaired.preferences.transitions.durationMs).toBe(5000);
    expect(JSON.stringify(repaired.preferences)).not.toMatch(forbiddenKeys);

    const roundTrip = JSON.parse(serializeWallpaperPreferences(repaired.preferences));
    expect(roundTrip).toEqual(repaired.preferences);
    expect(JSON.stringify(roundTrip)).not.toMatch(forbiddenKeys);
    expect(() => serializeWallpaperPreferences({ schemaVersion: 99 })).toThrow(
      'Only supported v2 preferences can be serialized.'
    );
  });

  it('does not report a valid v2 object as repaired only because key order differs', () => {
    const defaults = defaultWallpaperPreferences();
    const { debug, ...withoutDebug } = defaults;
    const reordered = { debug, ...withoutDebug };

    expect(repairWallpaperPreferences(reordered).repaired).toBe(false);
  });

  it('returns independent copies of preset items', () => {
    const first = clonePresetItems('Bottom Player');
    first.albumArt.x = 999;
    const second = clonePresetItems('Bottom Player');

    expect(second.albumArt.x).toBe(4);
  });

  it('keeps the shared preset authority immutable', () => {
    const sharedItem = layoutPresets.Minimal.debug as unknown as { x: number };

    expect(() => {
      sharedItem.x = 999;
    }).toThrow();

    const names = layoutPresetNames as LayoutPresetName[];
    expect(() => names.push('Minimal')).toThrow();
  });
});
