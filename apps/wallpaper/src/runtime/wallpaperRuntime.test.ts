import { describe, expect, it, vi } from 'vitest';
import type { NormalizedPlayback, ProviderResult, VisualizerFrame, WallpaperPreferences, WallpaperTheme } from '@spotify-wallpaper/shared-types';
import { mockPlayback } from '../mock/mockPlayback';
import { defaultSettings } from '../settings/defaultSettings';
import { createWallpaperRuntime } from './wallpaperRuntime';

const settingsForProvider = (provider: WallpaperPreferences['spotify']['provider']): WallpaperPreferences => ({
  ...defaultSettings,
  spotify: {
    ...defaultSettings.spotify,
    provider
  }
});

describe('WallpaperRuntime', () => {
  it('starts in mock mode without exposing credential values', () => {
    const runtime = createWallpaperRuntime();
    let snapshot = runtimeSnapshot(runtime);

    runtime.start();
    snapshot = runtimeSnapshot(runtime);

    expect(snapshot.providerSelection).toBe('mock');
    expect(snapshot.playbackMode).toBe('browser mock');
    expect(snapshot.credentialStatus).toEqual({ kind: 'none', present: false, revision: 0 });
    expect(JSON.stringify(snapshot)).not.toMatch(/refresh|pairing|clientId|token/i);

    runtime.dispose();
  });

  it('reports invalid direct configuration before starting network work', () => {
    const runtime = createWallpaperRuntime();
    runtime.applyConfiguration(settingsForProvider('direct'), { kind: 'retain' }, true);
    runtime.start();

    const snapshot = runtimeSnapshot(runtime);
    expect(snapshot.providerSelection).toBe('invalid');
    expect(snapshot.providerConfigurationError).toContain('credentials');
    expect(snapshot.playbackMode).toBe('provider configuration required');

    runtime.dispose();
  });

  it('clears a credential when switching to a provider with an incompatible kind', () => {
    const runtime = createWallpaperRuntime();
    runtime.applyConfiguration(
      settingsForProvider('direct'),
      { kind: 'replace', value: { kind: 'direct', clientId: 'client-id', refreshToken: 'refresh-token' } },
      true
    );
    expect(runtimeSnapshot(runtime).credentialStatus.kind).toBe('direct');

    runtime.applyConfiguration(settingsForProvider('backend'), { kind: 'retain' }, true);

    expect(runtimeSnapshot(runtime).credentialStatus).toMatchObject({ kind: 'none', present: false });
    runtime.dispose();
  });

  it('toggles display mode through the runtime settings authority', () => {
    const runtime = createWallpaperRuntime();
    expect(runtimeSnapshot(runtime).settings.player.displayMode).toBe('album-only');

    runtime.toggleDisplayMode();

    expect(runtimeSnapshot(runtime).settings.player.displayMode).toBe('album-details');
    runtime.dispose();
  });

  it('exposes an immutable cloned view model instead of the runtime authority', () => {
    const runtime = createWallpaperRuntime();
    const snapshot = runtimeSnapshot(runtime);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.settings)).toBe(true);
    expect(Object.isFrozen(snapshot.settings.spotify)).toBe(true);
    expect(() => {
      (snapshot.settings.spotify as unknown as { provider: string }).provider = 'direct';
    }).toThrow();
    expect(runtimeSnapshot(runtime).settings.spotify.provider).toBe('mock');

    runtime.dispose();
  });

  it('keeps optimistic progress and device volume consistent after controls', async () => {
    const playback = {
      ...mockPlayback,
      source: 'spotify' as const,
      progressMs: 1000,
      durationMs: 10_000,
      fetchedAt: new Date(Date.now() - 3_000).toISOString()
    };
    const provider = controlledProvider(
      { ok: true, value: playback },
      { ok: true, value: undefined }
    );
    const runtime = createWallpaperRuntime(settingsForProvider('direct'), {
      selectProvider: () => ({ kind: 'ready', provider })
    });
    let current = runtimeSnapshot(runtime);
    const unsubscribe = runtime.subscribe((snapshot) => {
      current = snapshot;
    });
    runtime.applyConfiguration(
      settingsForProvider('direct'),
      { kind: 'replace', value: { kind: 'direct', clientId: 'client-id', refreshToken: 'refresh-token' } },
      true
    );
    runtime.start();
    await flushAsync();
    await runtime.execute({ type: 'pause' });
    expect(current.playback.progressMs).toBeGreaterThan(1_000);
    await runtime.execute({ type: 'volume', volumePercent: 33 });
    expect(current.playback.volumePercent).toBe(33);
    expect(current.playback.device?.volumePercent).toBe(33);
    unsubscribe();
    runtime.dispose();
  });

  it('sanitizes provider error messages before publishing the ViewModel', async () => {
    const secret = 'refresh-token-secret';
    const playback = { ...mockPlayback, source: 'spotify' as const };
    const provider = controlledProvider(
      { ok: true, value: playback },
      { ok: false, error: { kind: 'network_error' as const, message: `request failed with ${secret}` } }
    );
    const runtime = createWallpaperRuntime(settingsForProvider('direct'), {
      selectProvider: () => ({ kind: 'ready', provider })
    });
    let current = runtimeSnapshot(runtime);
    const unsubscribe = runtime.subscribe((snapshot) => {
      current = snapshot;
    });
    runtime.applyConfiguration(
      settingsForProvider('direct'),
      { kind: 'replace', value: { kind: 'direct', clientId: 'client-id', refreshToken: secret } },
      true
    );
    runtime.start();
    await flushAsync();
    await runtime.execute({ type: 'pause' });
    expect(current.controlError?.message).toBe('Spotify network request failed.');
    expect(JSON.stringify(current)).not.toContain(secret);
    unsubscribe();
    runtime.dispose();
  });

  it('preserves valid long rate-limit delays after error sanitization', async () => {
    const provider = controlledProvider(
      {
        ok: false,
        error: { kind: 'rate_limited' as const, message: 'secret-bearing response', retryAfterMs: 3_600_000 }
      },
      { ok: true, value: undefined }
    );
    const runtime = createWallpaperRuntime(settingsForProvider('direct'), {
      selectProvider: () => ({ kind: 'ready', provider })
    });
    let current = runtimeSnapshot(runtime);
    const unsubscribe = runtime.subscribe((snapshot) => {
      current = snapshot;
    });
    runtime.applyConfiguration(
      settingsForProvider('direct'),
      { kind: 'replace', value: { kind: 'direct', clientId: 'client-id', refreshToken: 'refresh-token' } },
      true
    );
    runtime.start();
    await flushAsync();
    expect(current.spotifyError?.retryAfterMs).toBe(3_600_000);
    expect(current.lastPollingDelayMs).toBe(3_600_000);
    unsubscribe();
    runtime.dispose();
  });

  it('does not structured-clone the runtime snapshot on an audio-frame emit', () => {
    const runtime = createWallpaperRuntime();
    const originalClone = globalThis.structuredClone;
    let cloneCount = 0;
    vi.stubGlobal('structuredClone', <T>(value: T) => {
      cloneCount += 1;
      return originalClone(value);
    });
    runtime.subscribe(() => undefined);
    const before = cloneCount;
    runtime.acceptAudioFrame({
      source: 'wallpaper-engine',
      samples: [0.8, 0.4],
      bass: 0.8,
      mid: 0.4,
      treble: 0.4,
      peak: 0.8,
      timestampMs: Date.now()
    });
    expect(cloneCount).toBe(before);
    vi.unstubAllGlobals();
    runtime.dispose();
  });

  it('ignores a stale poll completion after provider reconfiguration', async () => {
    const firstPoll = deferred<ProviderResult<NormalizedPlayback>>();
    const secondPoll = deferred<ProviderResult<NormalizedPlayback>>();
    const firstProvider = deferredProvider(firstPoll.promise);
    const secondProvider = deferredProvider(secondPoll.promise);
    let providerIndex = 0;
    const runtime = createWallpaperRuntime(settingsForProvider('direct'), {
      selectProvider: () => ({
        kind: 'ready',
        provider: providerIndex++ === 0 ? firstProvider : secondProvider
      })
    });
    let current: ReturnType<typeof runtimeSnapshot> | undefined;
    const unsubscribe = runtime.subscribe((snapshot) => {
      current = snapshot;
    });

    runtime.applyConfiguration(
      settingsForProvider('direct'),
      { kind: 'replace', value: { kind: 'direct', clientId: 'client-id', refreshToken: 'refresh-token' } },
      true
    );
    runtime.start();
    runtime.applyConfiguration(
      settingsForProvider('backend'),
      { kind: 'replace', value: { kind: 'backend', pairingToken: 'pairing-token' } },
      true
    );

    const stalePlayback = { ...mockPlayback, source: 'spotify' as const, id: 'stale' };
    firstPoll.resolve({ ok: true, value: stalePlayback });
    await Promise.resolve();
    await Promise.resolve();
    expect(current?.playback.id).not.toBe('stale');
    expect(firstProvider.dispose).toHaveBeenCalledOnce();

    const currentPlayback = { ...mockPlayback, source: 'spotify' as const, id: 'current' };
    secondPoll.resolve({ ok: true, value: currentPlayback });
    await Promise.resolve();
    await Promise.resolve();
    expect(current?.playback.id).toBe('current');

    unsubscribe();
    runtime.dispose();
  });

  it('keeps only the newest async album theme result', async () => {
    const themeRequests: Array<ReturnType<typeof deferred<WallpaperTheme>>> = [];
    const runtime = createWallpaperRuntime(defaultSettings, {
      extractTheme: async () => {
        const request = deferred<WallpaperTheme>();
        themeRequests.push(request);
        return request.promise;
      }
    });
    let current = runtimeSnapshot(runtime);
    const unsubscribe = runtime.subscribe((snapshot) => {
      current = snapshot;
    });

    runtime.applyConfiguration(defaultSettings, { kind: 'retain' }, true);
    runtime.applyConfiguration({
      ...defaultSettings,
      clock: { ...defaultSettings.clock, showSeconds: !defaultSettings.clock.showSeconds }
    }, { kind: 'retain' }, true);
    expect(themeRequests.length).toBe(2);
    const olderTheme = { ...themeFixture, source: 'extracted' as const };
    const newerTheme = { ...themeFixture, readableTextColor: '#000000' };
    themeRequests[1].resolve(newerTheme);
    await flushAsync();
    themeRequests[0].resolve(olderTheme);
    await flushAsync();
    expect(current.theme).toEqual(newerTheme);

    unsubscribe();
    runtime.dispose();
  });

  it('preserves previous/current and transition state across rapid A-to-B-to-C updates', async () => {
    const playback = (id: string) => ({ ...mockPlayback, source: 'spotify' as const, id });
    const providers = ['A', 'B', 'C'].map((id) => deferredProvider(Promise.resolve({ ok: true as const, value: playback(id) })));
    let providerIndex = 0;
    const transitioningSettings = (provider: WallpaperPreferences['spotify']['provider']) => ({
      ...settingsForProvider(provider),
      transitions: { ...defaultSettings.transitions, enabled: true }
    });
    const runtime = createWallpaperRuntime(transitioningSettings('direct'), {
      selectProvider: () => ({ kind: 'ready', provider: providers[providerIndex++] })
    });
    let current = runtimeSnapshot(runtime);
    const unsubscribe = runtime.subscribe((snapshot) => {
      current = snapshot;
    });
    runtime.applyConfiguration(
      transitioningSettings('direct'),
      { kind: 'replace', value: { kind: 'direct', clientId: 'client-id', refreshToken: 'refresh-token' } },
      true
    );
    runtime.start();
    await flushAsync();
    runtime.applyConfiguration(
      transitioningSettings('backend'),
      { kind: 'replace', value: { kind: 'backend', pairingToken: 'pairing-token' } },
      true
    );
    await flushAsync();
    runtime.applyConfiguration(
      transitioningSettings('direct'),
      { kind: 'replace', value: { kind: 'direct', clientId: 'client-id-2', refreshToken: 'refresh-token-2' } },
      true
    );
    await flushAsync();

    expect(current.playback.id).toBe('C');
    expect(current.previousPlayback?.id).toBe('B');
    expect(current.transitionState?.previous.id).toBe('B');
    expect(current.transitionState?.current.id).toBe('C');

    unsubscribe();
    runtime.dispose();
  });

  it('does not mutate or emit after dispose, including a late audio callback', () => {
    const callbacks: Array<(frame: VisualizerFrame) => void> = [];
    const runtime = createWallpaperRuntime(defaultSettings, {
      startAudioBridge: (onFrame) => {
        callbacks.push(onFrame);
        return () => undefined;
      }
    });
    let emissions = 0;
    let observed = runtimeSnapshot(runtime);
    runtime.subscribe((snapshot) => {
      observed = snapshot;
      emissions += 1;
    });
    const windowStub = createWindowStub();
    vi.stubGlobal('window', windowStub);
    runtime.start();
    const beforeDispose = observed;
    runtime.dispose();
    callbacks[0]?.({
      source: 'wallpaper-engine',
      samples: [0.8],
      bass: 0.8,
      mid: 0.8,
      treble: 0.8,
      peak: 0.8,
      timestampMs: Date.now()
    });
    runtime.acceptAudioFrame({
      source: 'wallpaper-engine',
      samples: [0.8],
      bass: 0.8,
      mid: 0.8,
      treble: 0.8,
      peak: 0.8,
      timestampMs: Date.now()
    });
    runtime.toggleDisplayMode();
    expect(observed).toEqual(beforeDispose);
    expect(emissions).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it('reconciles owned clock and visualizer timers when settings change', () => {
    const runtime = createWallpaperRuntime(defaultSettings);
    const windowStub = createWindowStub();
    vi.stubGlobal('window', windowStub);
    runtime.start();
    const initialIntervals = windowStub.setInterval.mock.calls.length;
    const initialTimeouts = windowStub.setTimeout.mock.calls.length;
    runtime.applyConfiguration({
      ...defaultSettings,
      clock: { ...defaultSettings.clock, showSeconds: !defaultSettings.clock.showSeconds },
      performance: { ...defaultSettings.performance, mode: 'low-power' }
    }, { kind: 'retain' }, true);
    expect(windowStub.clearInterval).toHaveBeenCalled();
    expect(windowStub.clearTimeout).toHaveBeenCalled();
    expect(windowStub.setInterval.mock.calls.length).toBeGreaterThan(initialIntervals);
    expect(windowStub.setTimeout.mock.calls.length).toBeGreaterThan(initialTimeouts);
    runtime.dispose();
    vi.unstubAllGlobals();
  });
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const deferredProvider = (pollPromise: Promise<ProviderResult<NormalizedPlayback>>) => ({
  kind: 'direct' as const,
  poll: vi.fn(async (_signal: AbortSignal) => pollPromise),
  control: vi.fn(async () => ({ ok: true as const, value: undefined })),
  dispose: vi.fn()
});

const controlledProvider = (
  pollResult: ProviderResult<NormalizedPlayback>,
  controlResult: ProviderResult<void>
) => ({
  kind: 'direct' as const,
  poll: vi.fn(async (_signal: AbortSignal) => pollResult),
  control: vi.fn(async (_command: never, _signal: AbortSignal) => controlResult),
  dispose: vi.fn()
});

const themeFixture: WallpaperTheme = {
  primaryColor: '#505a64',
  secondaryColor: '#141e28',
  accentColor: '#dce6f0',
  mutedColor: '#6c7480',
  darkColor: '#101318',
  lightColor: '#f0f4f8',
  readableTextColor: '#ffffff',
  overlayOpacity: 0.62,
  shadowStrength: 0.5,
  source: 'fallback'
};

const createWindowStub = () => ({
  setTimeout: vi.fn(() => 1),
  clearTimeout: vi.fn(),
  setInterval: vi.fn(() => 1),
  clearInterval: vi.fn()
});

const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const runtimeSnapshot = (runtime: ReturnType<typeof createWallpaperRuntime>) => {
  let current: Parameters<Parameters<typeof runtime.subscribe>[0]>[0] | undefined;
  const unsubscribe = runtime.subscribe((snapshot) => {
    current = snapshot;
  });
  unsubscribe();
  if (!current) throw new Error('runtime did not emit an initial snapshot');
  return current;
};
