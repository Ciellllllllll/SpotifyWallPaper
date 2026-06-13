import { describe, expect, it } from 'vitest';
import { loadSettings } from './loadSettings';

describe('loadSettings', () => {
  it('falls back to defaults for malformed settings JSON', () => {
    const loaded = loadSettings('{not json');

    expect(loaded.warning).toContain('malformed');
    expect(loaded.settings.spotify.hasRefreshToken).toBe(false);
  });

  it('loads Spotify credentials without exposing token values in the warning', () => {
    const loaded = loadSettings(
      JSON.stringify({
        spotify: {
          clientId: 'client-id',
          refreshToken: 'secret-refresh-token'
        }
      })
    );

    expect(loaded.warning).toBeNull();
    expect(loaded.settings.spotify.clientId).toBe('client-id');
    expect(loaded.settings.spotify.refreshToken).toBe('secret-refresh-token');
    expect(loaded.settings.spotify.hasRefreshToken).toBe(true);
  });

  it('applies preset coordinates when settings JSON selects a preset without custom items', () => {
    const loaded = loadSettings(
      JSON.stringify({
        layout: {
          preset: 'Bottom Player'
        }
      })
    );

    expect(loaded.settings.layout.preset).toBe('Bottom Player');
    expect(loaded.settings.layout.items.albumArt.x).toBe(4);
    expect(loaded.settings.layout.items.albumArt.anchor).toBe('bottom-left');
  });

  it('loads and repairs background and theme settings', () => {
    const loaded = loadSettings(
      JSON.stringify({
        theme: {
          mode: 'custom',
          textColor: '#112233',
          customPrimaryColor: '#445566',
          autoReadability: false
        },
        background: {
          mode: 'solid-color',
          opacity: 1.4,
          blurPx: 120,
          solidColor: '#abcdef'
        }
      })
    );

    expect(loaded.warning).toContain('repaired');
    expect(loaded.settings.theme).toMatchObject({
      mode: 'custom',
      textColor: '#112233',
      customPrimaryColor: '#445566',
      autoReadability: false
    });
    expect(loaded.settings.background.mode).toBe('solid-color');
    expect(loaded.settings.background.opacity).toBe(1);
    expect(loaded.settings.background.blurPx).toBe(80);
    expect(loaded.settings.background.solidColor).toBe('#abcdef');
  });

  it('loads and repairs visualizer tuning settings', () => {
    const loaded = loadSettings(
      JSON.stringify({
        visualizer: {
          enabled: true,
          mode: 'radial-bars',
          intensity: 4,
          sensitivity: 2.25,
          smoothing: -1,
          decay: 0.5,
          bassWeight: 1.5,
          midWeight: 1.25,
          trebleWeight: 0.75,
          barCount: 500,
          lineWidth: 20,
          radius: 3,
          gap: 24,
          rotationSpeed: 0.8,
          glowStrength: 2,
          colorMode: 'accent',
          mirrorMode: 'none',
          clampMax: 0,
          noiseGate: 4,
          idleAnimation: false
        }
      })
    );

    expect(loaded.warning).toContain('repaired');
    expect(loaded.settings.visualizer).toMatchObject({
      enabled: true,
      mode: 'radial-bars',
      intensity: 2,
      sensitivity: 2.25,
      smoothing: 0,
      decay: 0.5,
      bassWeight: 1.5,
      midWeight: 1.25,
      trebleWeight: 0.75,
      barCount: 160,
      lineWidth: 16,
      radius: 2.2,
      gap: 24,
      rotationSpeed: 0.8,
      glowStrength: 1,
      colorMode: 'accent',
      mirrorMode: 'none',
      clampMax: 0.1,
      noiseGate: 1,
      idleAnimation: false
    });
  });

  it('loads and repairs lyrics settings', () => {
    const loaded = loadSettings(
      JSON.stringify({
        lyrics: {
          enabled: true,
          sourceText: '[00:01.00]One',
          mode: 'context',
          offsetMs: 60000,
          showMissingState: false,
          provider: {
            name: 'external-provider',
            searchInputs: {
              title: false,
              artists: true,
              album: false,
              duration: true
            },
            supportsSynced: false,
            supportsPlain: true,
            cachePolicy: 'persistent',
            failureReason: 'not-found'
          }
        }
      })
    );

    expect(loaded.warning).toContain('repaired');
    expect(loaded.settings.lyrics).toMatchObject({
      enabled: true,
      sourceText: '[00:01.00]One',
      mode: 'context',
      offsetMs: 30000,
      showMissingState: false,
      provider: {
        name: 'user-lrc',
        searchInputs: {
          title: false,
          artists: true,
          album: false,
          duration: true
        },
        supportsSynced: true,
        supportsPlain: false,
        cachePolicy: 'none',
        failureReason: 'not-found'
      }
    });
  });

  it('loads and repairs transition settings', () => {
    const loaded = loadSettings(
      JSON.stringify({
        transitions: {
          enabled: true,
          preset: 'slide-left',
          durationMs: 10_000,
          easing: 'ease-in-out',
          background: false,
          albumArt: true,
          text: false,
          lyrics: true,
          visualizer: true,
          reduceMotion: true
        }
      })
    );

    expect(loaded.warning).toContain('repaired');
    expect(loaded.settings.transitions).toMatchObject({
      enabled: true,
      preset: 'slide-left',
      durationMs: 5000,
      easing: 'ease-in-out',
      background: false,
      albumArt: true,
      text: false,
      lyrics: true,
      visualizer: true,
      reduceMotion: true
    });
  });

  it('loads and repairs player, seekbar, and clock settings', () => {
    const loaded = loadSettings(
      JSON.stringify({
        player: {
          visible: false,
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
          fontSizePx: 500,
          fontWeight: 735,
          letterSpacingPx: -4,
          opacity: 2,
          colorMode: 'fixed',
          fixedColor: '#112233'
        }
      })
    );

    expect(loaded.warning).toContain('repaired');
    expect(loaded.settings.player).toMatchObject({
      visible: false,
      controlsEnabled: false,
      showDevice: false,
      showVolume: true,
      showShuffleRepeat: false
    });
    expect(loaded.settings.seekbar.style).toBe('album-ring');
    expect(loaded.settings.clock).toMatchObject({
      hour12: true,
      showSeconds: true,
      showDate: true,
      showWeekday: true,
      fontSizePx: 180,
      fontWeight: 700,
      letterSpacingPx: 0,
      opacity: 1,
      colorMode: 'fixed',
      fixedColor: '#112233'
    });
  });
});
