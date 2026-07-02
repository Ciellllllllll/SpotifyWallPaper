import type { WallpaperSettings } from '@spotify-wallpaper/shared-types';
import { clonePresetItems, defaultLayoutPreset } from '../layout/presets';

export const defaultSettings: WallpaperSettings = {
  schemaVersion: 1,
  spotify: {
    clientId: '',
    hasRefreshToken: false,
    pollIntervalPlayingMs: 1000,
    pollIntervalPausedMs: 3000
  },
  layout: {
    preset: defaultLayoutPreset,
    items: clonePresetItems(defaultLayoutPreset)
  },
  theme: {
    mode: 'album',
    textColor: '#f6f7fb',
    autoReadability: true
  },
  background: {
    mode: 'album-blur',
    opacity: 0.62,
    blurPx: 30,
    solidColor: '#111318'
  },
  albumArt: {
    visible: true
  },
  text: {
    visible: true
  },
  player: {
    visible: true,
    controlsEnabled: true,
    showDevice: true,
    showVolume: true,
    showShuffleRepeat: true
  },
  seekbar: {
    visible: true,
    style: 'line'
  },
  lyrics: {
    enabled: false,
    sourceText: '',
    mode: 'current',
    offsetMs: 0,
    showMissingState: true,
    provider: {
      name: 'user-lrc',
      searchInputs: {
        title: true,
        artists: true,
        album: true,
        duration: true
      },
      supportsSynced: true,
      supportsPlain: false,
      cachePolicy: 'none',
      failureReason: 'not-configured'
    }
  },
  visualizer: {
    enabled: true,
    mode: 'album-ring',
    intensity: 0.72,
    sensitivity: 1,
    smoothing: 0.35,
    decay: 0.22,
    bassWeight: 1.2,
    midWeight: 1,
    trebleWeight: 0.82,
    barCount: 56,
    lineWidth: 3,
    radius: 1.18,
    gap: 10,
    rotationSpeed: 0.16,
    particleCount: 0,
    particleLife: 0,
    glowStrength: 0.62,
    colorMode: 'theme',
    mirrorMode: 'mirror',
    clampMax: 1,
    noiseGate: 0.03,
    idleAnimation: true
  },
  clock: {
    enabled: true,
    hour12: false,
    showSeconds: false,
    showDate: false,
    showWeekday: false,
    fontSizePx: 34,
    fontWeight: 700,
    letterSpacingPx: 0,
    opacity: 0.9,
    colorMode: 'auto',
    fixedColor: '#f6f7fb'
  },
  transitions: {
    enabled: false,
    preset: 'fade',
    durationMs: 700,
    easing: 'ease-out',
    background: true,
    albumArt: true,
    text: true,
    lyrics: true,
    visualizer: false,
    reduceMotion: false
  },
  performance: {
    mode: 'standard'
  },
  rainmeter: {
    enabled: false,
    outputPath: '',
    outputMode: 'json',
    stoppedUpdateIntervalMs: 10_000
  },
  debug: {
    enabled: false
  }
};
