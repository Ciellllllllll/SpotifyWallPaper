import { describe, expect, it } from 'vitest';
import { buildSettings, defaultDraft, exportSettingsJson, importSettingsJson } from './settingsModel';

describe('configurator settings model', () => {
  it('builds secret-free v2 preferences regardless of draft credentials', () => {
    const settings = buildSettings({
      ...defaultDraft,
      spotifyClientId: 'client-id'
    });

    expect(settings.schemaVersion).toBe(2);
    expect(settings.spotify.provider).toBe('mock');
    expect('clientId' in settings.spotify).toBe(false);
    expect(exportSettingsJson(defaultDraft)).not.toMatch(/refreshToken|accessToken|clientSecret/i);
  });

  it('does not include refresh tokens in the v2 export', () => {
    const settings = buildSettings({
      ...defaultDraft
    });

    expect('refreshToken' in settings.spotify).toBe(false);
    expect(exportSettingsJson(defaultDraft)).not.toMatch(/refreshToken|accessToken|clientSecret/i);
  });

  it('imports a generated settings JSON back into a draft', () => {
    const source = exportSettingsJson({
      ...defaultDraft,
      preset: 'Album Ring',
      performanceMode: 'low-power',
      clockShowSeconds: true,
      playerControlsEnabled: false,
      rainmeterEnabled: true,
      rainmeterOutputPath: 'D:\\Rainmeter\\NowPlaying.json'
    });

    const imported = importSettingsJson(source);

    expect(imported.warning).toBeNull();
    expect(imported.draft).toMatchObject({
      preset: 'Album Ring',
      performanceMode: 'low-power',
      clockShowSeconds: true,
      playerControlsEnabled: false,
      rainmeterEnabled: true,
      rainmeterOutputPath: 'D:\\Rainmeter\\NowPlaying.json'
    });
  });

  it('ignores credentials in imported settings and keeps export secret-free', () => {
    const imported = importSettingsJson(
      JSON.stringify({
        spotify: {
          clientId: 'client-id',
          refreshToken: 'secret-refresh-token'
        }
      })
    );

    expect(exportSettingsJson(imported.draft)).not.toContain('secret-refresh-token');
  });

  it('defaults unsupported imported enum values before export', () => {
    const imported = importSettingsJson(
      JSON.stringify({
        layout: { preset: 'Bad Preset' },
        background: { mode: 'bad-background' },
        theme: { mode: 'bad-theme' },
        performance: { mode: 'bad-performance' }
      })
    );

    expect(imported.draft).toMatchObject({
      preset: defaultDraft.preset,
      backgroundMode: defaultDraft.backgroundMode,
      themeMode: defaultDraft.themeMode,
      performanceMode: defaultDraft.performanceMode
    });
  });

  it('defaults unsupported imported primitive types before export', () => {
    const imported = importSettingsJson(
      JSON.stringify({
        spotify: {
          clientId: {},
          refreshToken: []
        },
        visualizer: { enabled: 'yes' },
        transitions: { enabled: 'yes' },
        clock: {
          enabled: 'yes',
          showSeconds: 'yes'
        },
        player: { controlsEnabled: 'yes' },
        rainmeter: {
          enabled: 'yes',
          outputPath: []
        },
        debug: { enabled: 'yes' }
      })
    );
    const exported = buildSettings(imported.draft);

    expect(imported.draft.spotifyClientId).toBe('');
    expect(exported.visualizer.enabled).toBe(defaultDraft.visualizerEnabled);
    expect(exported.transitions.enabled).toBe(defaultDraft.transitionEnabled);
    expect(exported.clock.enabled).toBe(defaultDraft.clockEnabled);
    expect(exported.clock.showSeconds).toBe(defaultDraft.clockShowSeconds);
    expect(exported.player.controlsEnabled).toBe(defaultDraft.playerControlsEnabled);
    expect(exported.rainmeter.enabled).toBe(defaultDraft.rainmeterEnabled);
    expect(exported.rainmeter.outputPath).toBe(defaultDraft.rainmeterOutputPath);
    expect(exported.debug.enabled).toBe(defaultDraft.debugEnabled);
  });

  it('exports Rainmeter settings without Spotify token material', () => {
    const json = exportSettingsJson({
      ...defaultDraft,
      rainmeterEnabled: true,
      rainmeterOutputPath: 'D:\\Rainmeter\\NowPlaying.json'
    });

    expect(json).toContain('"rainmeter"');
    expect(json).toContain('"outputMode": "json"');
    expect(json).toContain('D:\\\\Rainmeter\\\\NowPlaying.json');
    expect(json).not.toMatch(/refreshToken|accessToken|clientSecret/i);
  });

  it('falls back safely for malformed import JSON', () => {
    const imported = importSettingsJson('{secret-refresh-token');

    expect(imported.warning).toContain('malformed');
    expect(imported.warning).not.toContain('secret-refresh-token');
    expect(imported.draft).toEqual(defaultDraft);
  });

  it('round-trips imported non-UI preferences without rebuilding them from defaults', () => {
    const source = exportSettingsJson({
      ...defaultDraft,
      basePreferences: {
        ...defaultDraft.basePreferences,
        spotify: { ...defaultDraft.basePreferences.spotify, pollIntervalPlayingMs: 1777, pollIntervalPausedMs: 8888 },
        layout: {
          ...defaultDraft.basePreferences.layout,
          items: {
            ...defaultDraft.basePreferences.layout.items,
            trackText: { ...defaultDraft.basePreferences.layout.items.trackText, width: 913, height: 271 }
          }
        },
        theme: { ...defaultDraft.basePreferences.theme, textColor: '#123456', customPrimaryColor: '#654321' },
        visualizer: { ...defaultDraft.basePreferences.visualizer, mode: 'radial-bars', smoothing: 0.81, gap: 27 },
        transitions: { ...defaultDraft.basePreferences.transitions, preset: 'zoom-in', durationMs: 1333 },
        clock: { ...defaultDraft.basePreferences.clock, showDate: true, fontSizePx: 48 }
      }
    });
    const imported = importSettingsJson(source);
    const exported = buildSettings(imported.draft);

    expect(exported.spotify.pollIntervalPlayingMs).toBe(1777);
    expect(exported.layout.items.trackText.width).toBe(913);
    expect(exported.theme.customPrimaryColor).toBe('#654321');
    expect(exported.visualizer.smoothing).toBe(0.81);
    expect(exported.transitions.durationMs).toBe(1333);
    expect(exported.clock.showDate).toBe(true);
    expect(exported.player.displayMode).toBe('album-only');
  });
});
