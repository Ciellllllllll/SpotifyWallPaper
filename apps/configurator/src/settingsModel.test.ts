import { describe, expect, it } from 'vitest';
import { buildSettings, defaultDraft, exportSettingsJson, importSettingsJson } from './settingsModel';

describe('configurator settings model', () => {
  it('excludes refresh tokens from exported settings by default', () => {
    const settings = buildSettings({
      ...defaultDraft,
      spotifyClientId: 'client-id',
      spotifyRefreshToken: 'secret-refresh-token'
    });

    expect(settings.spotify.clientId).toBe('client-id');
    expect(settings.spotify.refreshToken).toBeUndefined();
    expect(settings.spotify.hasRefreshToken).toBe(false);
    expect(exportSettingsJson({ ...defaultDraft, spotifyRefreshToken: 'secret-refresh-token' })).not.toContain(
      'secret-refresh-token'
    );
  });

  it('includes refresh tokens only when explicitly enabled', () => {
    const settings = buildSettings({
      ...defaultDraft,
      spotifyRefreshToken: 'secret-refresh-token',
      includeRefreshToken: true
    });

    expect(settings.spotify.refreshToken).toBe('secret-refresh-token');
    expect(settings.spotify.hasRefreshToken).toBe(true);
  });

  it('imports a generated settings JSON back into a draft', () => {
    const source = exportSettingsJson({
      ...defaultDraft,
      preset: 'Album Ring',
      performanceMode: 'low-power',
      lyricsEnabled: true,
      clockShowSeconds: true,
      playerControlsEnabled: false
    });

    const imported = importSettingsJson(source);

    expect(imported.warning).toBeNull();
    expect(imported.draft).toMatchObject({
      preset: 'Album Ring',
      performanceMode: 'low-power',
      lyricsEnabled: true,
      clockShowSeconds: true,
      playerControlsEnabled: false
    });
  });

  it('requires a fresh opt-in before re-exporting imported refresh tokens', () => {
    const imported = importSettingsJson(
      JSON.stringify({
        spotify: {
          clientId: 'client-id',
          refreshToken: 'secret-refresh-token'
        }
      })
    );

    expect(imported.draft.spotifyRefreshToken).toBe('secret-refresh-token');
    expect(imported.draft.includeRefreshToken).toBe(false);
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
        lyrics: { enabled: 'yes' },
        visualizer: { enabled: 'yes' },
        transitions: { enabled: 'yes' },
        clock: {
          enabled: 'yes',
          showSeconds: 'yes'
        },
        player: { controlsEnabled: 'yes' },
        debug: { enabled: 'yes' }
      })
    );
    const exported = buildSettings(imported.draft);

    expect(imported.draft.spotifyClientId).toBe('');
    expect(imported.draft.spotifyRefreshToken).toBe('');
    expect(exported.lyrics.enabled).toBe(defaultDraft.lyricsEnabled);
    expect(exported.visualizer.enabled).toBe(defaultDraft.visualizerEnabled);
    expect(exported.transitions.enabled).toBe(defaultDraft.transitionEnabled);
    expect(exported.clock.enabled).toBe(defaultDraft.clockEnabled);
    expect(exported.clock.showSeconds).toBe(defaultDraft.clockShowSeconds);
    expect(exported.player.controlsEnabled).toBe(defaultDraft.playerControlsEnabled);
    expect(exported.debug.enabled).toBe(defaultDraft.debugEnabled);
  });

  it('falls back safely for malformed import JSON', () => {
    const imported = importSettingsJson('{secret-refresh-token');

    expect(imported.warning).toContain('malformed');
    expect(imported.warning).not.toContain('secret-refresh-token');
    expect(imported.draft).toEqual(defaultDraft);
  });
});
