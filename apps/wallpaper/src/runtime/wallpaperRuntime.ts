import type {
  NormalizedPlayback,
  SpotifyPlaybackError,
  VisualizerFrame,
  WallpaperPreferences,
  WallpaperTheme,
  ProviderResult,
  PlaybackCommand
} from '@spotify-wallpaper/shared-types';
import { mockPlayback } from '../mock/mockPlayback';
import {
  createProcessMemoryCredentialClosure,
  shouldClearCredentialForProviderChange
} from '../settings/credentialBoundary';
import { defaultSettings } from '../settings/defaultSettings';
import {
  nextPollingDelayMs,
  playbackHistoryAfterPoll,
  selectPlaybackProvider,
  type SpotifyPlaybackProvider
} from '../spotify/polling';
import { fallbackThemeFromSeed, hexToRgb, themeFromPrimary } from '../theme/colors';
import { extractAlbumTheme } from '../theme/extractAlbumTheme';
import { createTransitionState, type TrackTransitionState } from '../transitions/model';
import { idleVisualizerFrame, shapeVisualizerFrame, shouldIgnoreSilentWallpaperFrame } from '../visualizer/model';
import { startAudioBridge } from '../wallpaperEngine/audio';
import type { CredentialUpdate } from '../wallpaperEngine/types';

interface WallpaperRuntimeSnapshot {
  settings: WallpaperPreferences;
  playback: NormalizedPlayback;
  previousPlayback: NormalizedPlayback | null;
  spotifyError: SpotifyPlaybackError | null;
  controlError: SpotifyPlaybackError | null;
  controlBusy: boolean;
  playbackMode: string;
  providerSelection: 'mock' | 'ready' | 'invalid';
  providerConfigurationError: string | null;
  lastPollingDelayMs: number | null;
  consecutiveErrors: number;
  nowMs: number;
  progressNowMs: number;
  visualizerFrame: VisualizerFrame | null;
  previousVisualizerFrame: VisualizerFrame | null;
  theme: WallpaperTheme;
  transitionState: TrackTransitionState | null;
  credentialStatus: { kind: 'none' | 'direct' | 'backend'; present: boolean; revision: number };
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends Date
    ? Readonly<T>
    : T extends readonly (infer U)[]
      ? ReadonlyArray<DeepReadonly<U>>
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

export type ReadonlyWallpaperRuntimeSnapshot = DeepReadonly<WallpaperRuntimeSnapshot>;

export interface WallpaperRuntime {
  start(): void;
  subscribe(listener: (snapshot: ReadonlyWallpaperRuntimeSnapshot) => void): () => void;
  applyConfiguration(settings: WallpaperPreferences, credential: CredentialUpdate, safetyGateOpen: boolean): void;
  acceptAudioFrame(frame: VisualizerFrame): void;
  execute(command: PlaybackCommand): Promise<void>;
  toggleDisplayMode(): void;
  dispose(): void;
}

export interface WallpaperRuntimeDependencies {
  selectProvider?: typeof selectPlaybackProvider;
  startAudioBridge?: typeof startAudioBridge;
  extractTheme?: typeof extractAlbumTheme;
}

export const createWallpaperRuntime = (
  initialSettings: WallpaperPreferences = defaultSettings,
  dependencies: WallpaperRuntimeDependencies = {}
): WallpaperRuntime => {
  const selectProvider = dependencies.selectProvider ?? selectPlaybackProvider;
  const connectAudio = dependencies.startAudioBridge ?? startAudioBridge;
  const extractTheme = dependencies.extractTheme ?? extractAlbumTheme;
  const credentialClosure = createProcessMemoryCredentialClosure();
  const listeners = new Set<(snapshot: ReadonlyWallpaperRuntimeSnapshot) => void>();
  let provider: SpotifyPlaybackProvider | null = null;
  let providerAbortController: AbortController | null = null;
  let pollingTimeout: number | null = null;
  let clockTimeout: number | null = null;
  let progressInterval: number | null = null;
  let visualizerInterval: number | null = null;
  let transitionTimeout: number | null = null;
  let stopAudio: (() => void) | null = null;
  let pollingRunId = 0;
  let themeGeneration = 0;
  let started = false;
  let disposed = false;
  let safetyGateOpen = true;
  let activeProviderKey = '';
  let lastAudioFrameAtMs = 0;

  let snapshot: WallpaperRuntimeSnapshot = {
    settings: structuredClone(initialSettings),
    playback: mockPlayback,
    previousPlayback: null,
    spotifyError: null,
    controlError: null,
    controlBusy: false,
    playbackMode: 'browser mock',
    providerSelection: 'mock',
    providerConfigurationError: null,
    lastPollingDelayMs: null,
    consecutiveErrors: 0,
    nowMs: Date.now(),
    progressNowMs: Date.now(),
    visualizerFrame: null,
    previousVisualizerFrame: null,
    theme: fallbackThemeFromSeed(mockPlayback.id ?? mockPlayback.title),
    transitionState: null,
    credentialStatus: credentialClosure.status()
  };
  deepFreeze(snapshot);

  const emit = () => {
    snapshot = { ...snapshot, credentialStatus: credentialClosure.status() };
    deepFreeze(snapshot);
    for (const listener of listeners) listener(snapshot as ReadonlyWallpaperRuntimeSnapshot);
  };

  const clearTimers = () => {
    if (typeof window !== 'undefined') {
      if (pollingTimeout !== null) window.clearTimeout(pollingTimeout);
      if (clockTimeout !== null) window.clearTimeout(clockTimeout);
      if (progressInterval !== null) window.clearInterval(progressInterval);
      if (visualizerInterval !== null) window.clearInterval(visualizerInterval);
      if (transitionTimeout !== null) window.clearTimeout(transitionTimeout);
    }
    pollingTimeout = clockTimeout = progressInterval = visualizerInterval = transitionTimeout = null;
  };

  const clearProvider = () => {
    pollingRunId += 1;
    if (pollingTimeout !== null && typeof window !== 'undefined') window.clearTimeout(pollingTimeout);
    pollingTimeout = null;
    providerAbortController?.abort();
    providerAbortController = null;
    provider?.dispose();
    provider = null;
  };

  const clockDelay = (date = new Date()) => snapshot.settings.clock.showSeconds
    ? 1000
    : Math.max(1000, 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds()));

  const startClock = () => {
    if (clockTimeout !== null) window.clearTimeout(clockTimeout);
    clockTimeout = null;
    if (!snapshot.settings.clock.enabled) return;
    const tick = () => {
      snapshot = { ...snapshot, nowMs: Date.now() };
      emit();
      clockTimeout = window.setTimeout(tick, clockDelay(new Date(snapshot.nowMs)));
    };
    clockTimeout = window.setTimeout(tick, clockDelay(new Date(snapshot.nowMs)));
  };

  const acceptIdleFrame = () => {
    if (!snapshot.settings.visualizer.enabled) return;
    const nowMs = Date.now();
    const staleAfterMs = snapshot.settings.performance.mode === 'low-power' ? 1600 : 700;
    if (lastAudioFrameAtMs > 0 && nowMs - lastAudioFrameAtMs < staleAfterMs) return;
    runtime.acceptAudioFrame(idleVisualizerFrame(nowMs, snapshot.settings.visualizer));
  };

  const startVisualizers = () => {
    if (visualizerInterval !== null) window.clearInterval(visualizerInterval);
    visualizerInterval = null;
    if (!snapshot.settings.visualizer.enabled) return;
    visualizerInterval = window.setInterval(acceptIdleFrame, snapshot.settings.performance.mode === 'low-power' ? 1000 : 500);
    acceptIdleFrame();
  };

  const updateTheme = (playback: NormalizedPlayback) => {
    const imageUrl = playback.albumImageUrl;
    const seed = playback.id ?? playback.albumName ?? playback.title;
    const generation = ++themeGeneration;
    const customColor = snapshot.settings.theme.customPrimaryColor ? hexToRgb(snapshot.settings.theme.customPrimaryColor) : null;
    if (snapshot.settings.theme.mode === 'custom' && customColor) {
      snapshot = { ...snapshot, theme: themeFromPrimary(customColor, 'fallback') };
      emit();
      return;
    }
    if (snapshot.settings.theme.mode === 'fallback') {
      snapshot = { ...snapshot, theme: fallbackThemeFromSeed(seed) };
      emit();
      return;
    }
    void extractTheme(imageUrl, seed).then((theme) => {
      if (!disposed && generation === themeGeneration) {
        snapshot = { ...snapshot, theme };
        emit();
      }
    });
  };

  const startTransition = (previous: NormalizedPlayback, current: NormalizedPlayback) => {
    if (transitionTimeout !== null && typeof window !== 'undefined') window.clearTimeout(transitionTimeout);
    transitionTimeout = null;
    const transition = createTransitionState(previous, current, snapshot.settings);
    snapshot = { ...snapshot, transitionState: transition };
    if (!transition) {
      emit();
      return;
    }
    const startedAtMs = transition.startedAtMs;
    if (typeof window !== 'undefined') {
      transitionTimeout = window.setTimeout(() => {
        if (snapshot.transitionState?.startedAtMs === startedAtMs) {
          snapshot = { ...snapshot, transitionState: null };
          emit();
        }
      }, transition.durationMs);
    }
    emit();
  };

  const poll = async (runId: number, currentProvider: SpotifyPlaybackProvider, signal: AbortSignal) => {
    let result: ProviderResult<NormalizedPlayback>;
    try {
      result = await currentProvider.poll(signal);
    } catch (error) {
      result = {
        ok: false,
        error: {
          kind: 'network_error',
          message: error instanceof Error ? error.message : 'Playback provider polling failed.'
        }
      };
    }
    if (disposed || runId !== pollingRunId) return;
    const previous = { playback: snapshot.playback, previousPlayback: snapshot.previousPlayback };
    const history = playbackHistoryAfterPoll(previous, result);
    if (result.ok && history.previousPlayback === previous.playback) startTransition(previous.playback, history.playback);
    snapshot = { ...snapshot, playback: history.playback, previousPlayback: history.previousPlayback };
    if (result.ok) {
      snapshot = { ...snapshot, spotifyError: null, consecutiveErrors: 0 };
      updateTheme(history.playback);
    } else {
      snapshot = { ...snapshot, spotifyError: sanitizeProviderError(result.error), consecutiveErrors: snapshot.consecutiveErrors + 1 };
    }
    const delay = nextPollingDelayMs({ playback: snapshot.playback, error: snapshot.spotifyError, consecutiveErrors: snapshot.consecutiveErrors, settings: snapshot.settings });
    snapshot = { ...snapshot, lastPollingDelayMs: delay };
    emit();
    if (typeof window !== 'undefined') {
      pollingTimeout = window.setTimeout(() => void poll(runId, currentProvider, signal), delay);
    }
  };

  const configureProvider = () => {
    clearProvider();
    const settings = snapshot.settings;
    if (!safetyGateOpen) {
      snapshot = {
        ...snapshot,
        providerSelection: 'mock',
        providerConfigurationError: null,
        playbackMode: 'browser mock',
        lastPollingDelayMs: null,
        controlBusy: false,
        controlError: null
      };
      emit();
      return;
    }
    const selection = selectProvider(settings, credentialClosure.read());
    snapshot = {
      ...snapshot,
      providerSelection: selection.kind,
      providerConfigurationError: selection.kind === 'invalid' ? selection.error.message : null,
      playbackMode: selection.kind === 'invalid' ? 'provider configuration required' : settings.spotify.provider === 'backend' ? 'spotify backend' : settings.spotify.provider === 'direct' ? 'spotify direct' : 'browser mock',
      spotifyError: null,
      consecutiveErrors: 0,
      lastPollingDelayMs: null,
      controlBusy: false,
      controlError: null
    };
    if (selection.kind !== 'ready') {
      emit();
      return;
    }
    provider = selection.provider;
    providerAbortController = new AbortController();
    const runId = ++pollingRunId;
    void poll(runId, provider, providerAbortController.signal);
  };

  const providerKey = () => JSON.stringify({
    provider: snapshot.settings.spotify.provider,
    backendOrigin: snapshot.settings.spotify.backendOrigin,
    credentialRevision: credentialClosure.status().revision,
    safetyGateOpen
  });

  const runtime: WallpaperRuntime = {
    start() {
      if (started || disposed) return;
      started = true;
      if (typeof window !== 'undefined') {
        startClock();
        progressInterval = window.setInterval(() => {
          snapshot = { ...snapshot, progressNowMs: Date.now() };
          emit();
        }, 1000);
        startVisualizers();
        stopAudio = connectAudio((frame) => runtime.acceptAudioFrame(frame));
      }
      configureProvider();
    },
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      listener(snapshot as ReadonlyWallpaperRuntimeSnapshot);
      return () => listeners.delete(listener);
    },
    applyConfiguration(settings, credential, gateOpen) {
      if (disposed) return;
      safetyGateOpen = safetyGateOpen && gateOpen;
      const previousProvider = snapshot.settings.spotify.provider;
      const previousVisualizerEnabled = snapshot.settings.visualizer.enabled;
      const previousPerformanceMode = snapshot.settings.performance.mode;
      const previousClockShowSeconds = snapshot.settings.clock.showSeconds;
      const previousClockEnabled = snapshot.settings.clock.enabled;
      if (!safetyGateOpen) credentialClosure.clear();
      else if (credential.kind === 'replace') credentialClosure.replace(credential.value);
      else if (credential.kind === 'clear') credentialClosure.clear();
      const credentialBeforeProviderChange = credentialClosure.status();
      if (shouldClearCredentialForProviderChange(
        previousProvider,
        settings.spotify.provider,
        credentialBeforeProviderChange.kind
      )) {
        credentialClosure.clear();
      }
      snapshot = {
        ...snapshot,
        settings: structuredClone(settings),
        progressNowMs: Date.now(),
        ...(previousVisualizerEnabled && !settings.visualizer.enabled
          ? { visualizerFrame: null, previousVisualizerFrame: null }
          : {}),
        ...(!settings.transitions.enabled ? { transitionState: null } : {})
      };
      if (!settings.transitions.enabled && transitionTimeout !== null && typeof window !== 'undefined') {
        window.clearTimeout(transitionTimeout);
        transitionTimeout = null;
      }
      if (started && typeof window !== 'undefined' && (previousClockShowSeconds !== settings.clock.showSeconds || previousClockEnabled !== settings.clock.enabled)) {
        startClock();
      }
      if (started && typeof window !== 'undefined' && (
        previousPerformanceMode !== settings.performance.mode ||
        previousVisualizerEnabled !== settings.visualizer.enabled
      )) {
        startVisualizers();
      }
      updateTheme(snapshot.playback);
      const nextKey = providerKey();
      if (nextKey !== activeProviderKey) {
        activeProviderKey = nextKey;
        if (started) configureProvider();
      }
      emit();
    },
    acceptAudioFrame(frame) {
      if (disposed || !snapshot.settings.visualizer.enabled || shouldIgnoreSilentWallpaperFrame(frame, snapshot.settings.visualizer)) return;
      const shaped = shapeVisualizerFrame(frame, snapshot.previousVisualizerFrame, snapshot.settings.visualizer);
      snapshot = { ...snapshot, previousVisualizerFrame: shaped, visualizerFrame: shaped };
      lastAudioFrameAtMs = Date.now();
      emit();
    },
    async execute(command) {
      if (!provider || snapshot.providerSelection !== 'ready' || snapshot.controlBusy) return;
      const runId = pollingRunId;
      const currentProvider = provider;
      snapshot = { ...snapshot, controlBusy: true, controlError: null };
      emit();
      let result: ProviderResult<void>;
      try {
        result = await currentProvider.control(command, providerAbortController?.signal ?? new AbortController().signal);
      } catch (error) {
        result = {
          ok: false,
          error: {
            kind: 'network_error',
            message: error instanceof Error ? error.message : 'Playback control failed.'
          }
        };
      }
      if (disposed || runId !== pollingRunId) return;
      snapshot = { ...snapshot, controlBusy: false, controlError: result.ok ? null : sanitizeProviderError(result.error) };
      if (result.ok) {
        const progressMs = snapshot.playback.isPlaying
          ? Math.min(
              snapshot.playback.durationMs,
              snapshot.playback.progressMs + Math.max(0, snapshot.progressNowMs - new Date(snapshot.playback.fetchedAt).getTime())
            )
          : snapshot.playback.progressMs;
        switch (command.type) {
          case 'play': snapshot = { ...snapshot, playback: { ...snapshot.playback, isPlaying: true, fetchedAt: new Date().toISOString(), progressMs } }; break;
          case 'pause': snapshot = { ...snapshot, playback: { ...snapshot.playback, isPlaying: false, fetchedAt: new Date().toISOString(), progressMs } }; break;
          case 'seek': snapshot = { ...snapshot, playback: { ...snapshot.playback, progressMs: Math.min(snapshot.playback.durationMs, Math.max(0, command.positionMs)), fetchedAt: new Date().toISOString() } }; break;
          case 'volume': {
            const volumePercent = Math.min(100, Math.max(0, Math.round(command.volumePercent)));
            snapshot = {
              ...snapshot,
              playback: {
                ...snapshot.playback,
                volumePercent,
                device: snapshot.playback.device ? { ...snapshot.playback.device, volumePercent } : snapshot.playback.device
              }
            };
            break;
          }
          case 'shuffle': snapshot = { ...snapshot, playback: { ...snapshot.playback, shuffleState: command.state } }; break;
          case 'repeat': snapshot = { ...snapshot, playback: { ...snapshot.playback, repeatState: command.state } }; break;
          case 'next':
          case 'previous': break;
        }
      }
      emit();
    },
    toggleDisplayMode() {
      if (disposed) return;
      const next = snapshot.settings.player.displayMode === 'album-details' ? 'album-only' : 'album-details';
      snapshot = { ...snapshot, settings: { ...snapshot.settings, player: { ...snapshot.settings.player, displayMode: next } } };
      emit();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimers();
      providerAbortController?.abort();
      providerAbortController = null;
      provider?.dispose();
      provider = null;
      stopAudio?.();
      stopAudio = null;
      credentialClosure.clear();
      listeners.clear();
    }
  };

  return runtime;
};

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
};

const sanitizeProviderError = (error: SpotifyPlaybackError): SpotifyPlaybackError => {
  const status = error.status;
  const retryAfterMs = error.retryAfterMs;
  const safeStatus = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
  const safeRetryAfterMs = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0 && retryAfterMs <= 86_400_000
    ? Math.round(retryAfterMs)
    : undefined;
  return {
    kind: error.kind,
    message: safeProviderErrorMessage(error.kind),
    ...(safeStatus === undefined ? {} : { status: safeStatus }),
    ...(safeRetryAfterMs === undefined ? {} : { retryAfterMs: safeRetryAfterMs })
  };
};

const safeProviderErrorMessage = (kind: SpotifyPlaybackError['kind']): string => {
  switch (kind) {
    case 'unauthorized': return 'Spotify authorization is required.';
    case 'forbidden': return 'Spotify playback access was denied.';
    case 'rate_limited': return 'Spotify rate limit reached.';
    case 'network_error': return 'Spotify network request failed.';
    case 'unavailable': return 'Spotify is temporarily unavailable.';
    case 'unknown_response_shape': return 'Spotify returned an unsupported response.';
    case 'item_null': return 'Spotify is not currently playing an item.';
  }
};
