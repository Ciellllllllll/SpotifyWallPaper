<script lang="ts">
  import type { LayoutItem, WallpaperSettings } from '@spotify-wallpaper/shared-types';

  const item = (partial: Partial<LayoutItem>): LayoutItem => ({
    enabled: true,
    x: 50,
    y: 50,
    unit: 'percent',
    anchor: 'center',
    width: 360,
    height: 120,
    scale: 1,
    rotation: 0,
    opacity: 1,
    zIndex: 2,
    responsive: 'clamp-safe-area',
    safeAreaMargin: 20,
    locked: false,
    participatesInTransition: true,
    ...partial
  });

  const defaults: WallpaperSettings = {
    schemaVersion: 1,
    spotify: { clientId: '', hasRefreshToken: false, pollIntervalPlayingMs: 1000, pollIntervalPausedMs: 3000 },
    layout: {
      preset: 'Left Dock',
      items: {
        albumArt: item({ x: 8, y: 50, anchor: 'center-left', width: 360, height: 360 }),
        trackText: item({ x: 34, y: 48, anchor: 'center-left', width: 520, height: 260 }),
        seekbar: item({ x: 34, y: 68, anchor: 'center-left', width: 420, height: 44 }),
        lyrics: item({ x: 68, y: 50, anchor: 'center', width: 560, height: 240 }),
        clock: item({ x: 96, y: 94, anchor: 'bottom-right', width: 220, height: 72 }),
        debug: item({ x: 98.8, y: 2, anchor: 'top-right', width: 280, height: 240 })
      }
    },
    theme: { mode: 'album', textColor: '#f6f7fb', autoReadability: true },
    background: { mode: 'album-blur', opacity: 0.72, blurPx: 26, solidColor: '#111318' },
    albumArt: { visible: true },
    text: { visible: true },
    player: { visible: true },
    seekbar: { visible: true },
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
    clock: { enabled: true, hour12: false, showSeconds: false, showDate: false, showWeekday: false },
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
    performance: { mode: 'standard' },
    rainmeter: { enabled: false },
    debug: { enabled: false }
  };

  const settingsJson = JSON.stringify(defaults, null, 2);
</script>

<main>
  <section>
    <h1>Configurator Skeleton</h1>
    <p>Optional settings editor foundation. The wallpaper does not depend on this app.</p>
    <textarea readonly value={settingsJson} aria-label="Default settings JSON"></textarea>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #1c232b;
    background: #eef2f5;
  }

  main {
    display: grid;
    min-height: 100vh;
    place-items: center;
    padding: 32px;
  }

  section {
    width: min(920px, 100%);
  }

  h1 {
    margin: 0 0 10px;
    font-size: 2rem;
  }

  p {
    margin: 0 0 18px;
    color: #52606d;
  }

  textarea {
    width: 100%;
    min-height: 480px;
    resize: vertical;
    border: 1px solid #c9d3dc;
    border-radius: 8px;
    padding: 16px;
    color: #1c232b;
    background: #ffffff;
    font: 0.92rem/1.5 "Cascadia Mono", Consolas, monospace;
  }
</style>
