import { describe, expect, it } from 'vitest';
import type { WallpaperViewModel } from '@spotify-wallpaper/shared-types';
import { defaultSettings } from './settings/defaultSettings';
import { createWallpaperRuntime, type ReadonlyWallpaperRuntimeSnapshot } from './runtime/wallpaperRuntime';
import { toWallpaperViewModel } from './viewModel';

const host = {
  settingsWarning: 'Settings were repaired.',
  settingsSource: 'wallpaper-engine properties',
  visualCoreStatus: 'wasm' as const
};

describe('toWallpaperViewModel', () => {
  it('gives configuration errors precedence and carries host-only status', () => {
    const runtime = createWallpaperRuntime();
    runtime.applyConfiguration({
      ...defaultSettings,
      spotify: { ...defaultSettings.spotify, provider: 'direct' }
    }, { kind: 'retain' }, true);
    runtime.start();

    const model = toWallpaperViewModel(runtimeSnapshot(runtime), host);

    expect(model.providerSelection).toBe('invalid');
    expect(model.spotifyStatusText).toBe('Spotify direct credentials are not configured.');
    expect(model.settingsWarning).toBe('Settings were repaired.');
    expect(model.settingsSource).toBe('wallpaper-engine properties');
    expect(model.visualCoreStatus).toBe('wasm');
    runtime.dispose();
  });

  it('enables controls only for a ready unrestricted Spotify device', () => {
    const runtime = createWallpaperRuntime();
    const snapshot = runtimeSnapshot(runtime);
    const ready = {
      ...snapshot,
      providerSelection: 'ready' as const,
      playback: {
        ...snapshot.playback,
        source: 'spotify' as const,
        device: snapshot.playback.device
          ? { ...snapshot.playback.device, isRestricted: false }
          : null
      },
      settings: {
        ...snapshot.settings,
        player: { ...snapshot.settings.player, controlsEnabled: true }
      }
    } satisfies ReadonlyWallpaperRuntimeSnapshot;

    expect(toWallpaperViewModel(ready, host).canControlPlayback).toBe(true);
    expect(toWallpaperViewModel({
      ...ready,
      playback: {
        ...ready.playback,
        device: ready.playback.device ? { ...ready.playback.device, isRestricted: true } : null
      }
    }, host).canControlPlayback).toBe(false);
    expect(toWallpaperViewModel({ ...ready, controlBusy: true }, host).canControlPlayback).toBe(false);
    runtime.dispose();
  });

  it('maps only the transition fields owned by the shared view contract', () => {
    const runtime = createWallpaperRuntime();
    const snapshot = runtimeSnapshot(runtime);
    const transitionState = {
      previous: snapshot.playback,
      current: { ...snapshot.playback, id: 'next-track', title: 'Next Track' },
      startedAtMs: 123,
      durationMs: 700,
      easing: 'ease-out' as const,
      preset: 'fade' as const,
      resolvedPreset: 'fade' as const
    };

    const model: WallpaperViewModel = toWallpaperViewModel({ ...snapshot, transitionState }, host);

    expect(model.transitionState).toEqual({
      previous: snapshot.playback,
      current: transitionState.current,
      durationMs: 700,
      easing: 'ease-out',
      resolvedPreset: 'fade'
    });
    runtime.dispose();
  });
});

const runtimeSnapshot = (runtime: ReturnType<typeof createWallpaperRuntime>) => {
  let current: Parameters<Parameters<typeof runtime.subscribe>[0]>[0] | undefined;
  const unsubscribe = runtime.subscribe((snapshot) => {
    current = snapshot;
  });
  unsubscribe();
  if (!current) throw new Error('runtime did not emit an initial snapshot');
  return current;
};
