import type {
  NormalizedPlayback,
  SpotifyPlaybackError,
  VisualizerFrame,
  VisualizerMotionState,
  WallpaperPreferences,
  WallpaperTheme,
  ProviderResult,
  PlaybackCommand,
  PlaybackProvider
} from '@spotify-wallpaper/shared-types';
import { mockPlayback } from '../mock/mockPlayback';
import {
  createProcessMemoryCredentialClosure,
  shouldClearCredentialForProviderChange
} from '../settings/credentialBoundary';
import { defaultSettings } from '../settings/defaultSettings';
import {
  nextPollingDelayMs,
  playbackHistoryAfterPoll
} from '../spotify/polling';
import { selectPlaybackProvider } from '../spotify/providers/factory';
import { fallbackThemeFromSeed, hexToRgb, themeFromPrimary } from '../theme/colors';
import { extractAlbumTheme, type AlbumThemeExtraction } from '../theme/extractAlbumTheme';
import { createTransitionState, type TrackTransitionState } from '../transitions/model';
import {
  applyVisualizerIntensity,
  idleVisualizerFrame,
  isSilentWallpaperFrame,
  shapeVisualizerFrame,
  virtualVolumeBoostGain
} from '../visualizer/model';
import { calculateVisualizerMotion, neutralVisualizerMotion, releaseVisualizerMotion } from '../visualizer/motion';
import { createSilentAudioFrame, startAudioBridge, type AudioBridgeSource } from '../wallpaperEngine/audio';
import type { CredentialUpdate } from '../wallpaperEngine/types';
import type { DirectCredentialStore, CredentialRecord } from '../spotify/credentialStore';
import { DirectTokenSession } from '../spotify/directTokenSession';

const SILENCE_RELEASE_MS = 450;
const FALLBACK_VISUALIZER_COLOR = '#ffffff';
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
  visualizerMotion: VisualizerMotionState;
  visualizerColor: string;
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
  enableCredentialStore(store: DirectCredentialStore): void;
  start(): void;
  subscribe(listener: (snapshot: ReadonlyWallpaperRuntimeSnapshot) => void): () => void;
  applyConfiguration(settings: WallpaperPreferences, credential: CredentialUpdate, safetyGateOpen: boolean, providerSelectionExplicit?: boolean): void;
  acceptAudioFrame(frame: VisualizerFrame): void;
  execute(command: PlaybackCommand): Promise<void>;
  toggleDisplayMode(): void;
  dispose(): void;
}

export interface WallpaperRuntimeDependencies {
  credentialStore?: DirectCredentialStore;
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
  let credentialStore = dependencies.credentialStore;
  let directSession: DirectTokenSession | undefined;
  let authorizationId: string | undefined;
  let credentialEpoch = 0;
  let credentialQueue = Promise.resolve();
  let applyingStoredCredential = false;
  const listeners = new Set<(snapshot: ReadonlyWallpaperRuntimeSnapshot) => void>();
  let provider: PlaybackProvider | null = null;
  let providerAbortController: AbortController | null = null;
  let pollingTimeout: number | null = null;
  let clockTimeout: number | null = null;
  let progressInterval: number | null = null;
  let visualizerInterval: number | null = null;
  let transitionTimeout: number | null = null;
  let stopAudio: (() => void) | null = null;
  let pollingRunId = 0;
  let themeGeneration = 0;
  let activeVisualizerColorKey = '';
  let albumExtractionCache: { key: string; theme: AlbumThemeExtraction } | null = null;
  let started = false;
  let disposed = false;
  let safetyGateOpen = true;
  let activeProviderKey = '';
  let activeThemeKey = '';
  let audioBridgeSource: AudioBridgeSource | null = null;
  let lastWallpaperFrameAtMs = 0;
  let lastMockFrameAtMs = 0;
  let silentSinceMs: number | null = null;
  let motionReleaseSource: VisualizerMotionState | null = null;
  let motionReleaseStartedAtMs: number | null = null;
  let hasSuccessfulPlaybackPoll = false;

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
    visualizerMotion: neutralVisualizerMotion(),
    visualizerColor: FALLBACK_VISUALIZER_COLOR,
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

  const audioReactionEnabled = (settings: WallpaperPreferences): boolean =>
    settings.visualizer.enabled
    || settings.visualizer.glowingObjectsEnabled
    || (settings.albumArt.visible && settings.layout.items.albumArt.enabled);

  const playbackAcceptsAudio = (source: VisualizerFrame['source']): boolean => {
    const hasItem = snapshot.playback.itemType === 'track' || snapshot.playback.itemType === 'episode';
    if (!snapshot.playback.isPlaying || !hasItem) return false;
    if (source === 'mock') {
      return snapshot.settings.spotify.provider === 'mock' && snapshot.playback.source === 'mock';
    }
    return source === 'wallpaper-engine'
      && snapshot.settings.spotify.provider !== 'mock'
      && snapshot.providerSelection === 'ready'
      && hasSuccessfulPlaybackPoll
      && snapshot.playback.source === 'spotify';
  };

  const acceptIdleFrame = () => {
    if (!audioReactionEnabled(snapshot.settings)) return;
    const nowMs = Date.now();
    const staleAfterMs = snapshot.settings.performance.mode === 'low-power' ? 1600 : 700;
    if (audioBridgeSource === 'wallpaper-engine') {
      if (lastWallpaperFrameAtMs === 0 || nowMs - lastWallpaperFrameAtMs >= staleAfterMs) {
        silentSinceMs = nowMs - SILENCE_RELEASE_MS;
        runtime.acceptAudioFrame(createSilentAudioFrame(nowMs));
      }
      return;
    }
    if (audioBridgeSource === 'mock') {
      if (lastMockFrameAtMs === 0 || nowMs - lastMockFrameAtMs >= staleAfterMs) {
        runtime.acceptAudioFrame(idleVisualizerFrame(nowMs, snapshot.settings.visualizer));
      }
      return;
    }
    runtime.acceptAudioFrame(idleVisualizerFrame(nowMs, snapshot.settings.visualizer));
  };

  const startVisualizers = () => {
    if (visualizerInterval !== null) window.clearInterval(visualizerInterval);
    visualizerInterval = null;
    if (!audioReactionEnabled(snapshot.settings)) return;
    visualizerInterval = window.setInterval(acceptIdleFrame, snapshot.settings.performance.mode === 'low-power' ? 1000 : 500);
    acceptIdleFrame();
  };

  const updateTheme = (playback: NormalizedPlayback) => {
    const imageUrl = playback.albumImageUrl;
    const seed = playback.id ?? playback.albumName ?? playback.title;
    const artworkKey = imageUrl ? JSON.stringify(['album-art', imageUrl]) : 'no-album-art';
    const albumThemeKey = JSON.stringify(['album', imageUrl || seed]);
    const customColor = snapshot.settings.theme.customPrimaryColor ? hexToRgb(snapshot.settings.theme.customPrimaryColor) : null;
    const themeKey = snapshot.settings.theme.mode === 'custom' && customColor
      ? JSON.stringify(['custom', customColor.r, customColor.g, customColor.b])
      : snapshot.settings.theme.mode === 'fallback'
        ? JSON.stringify(['fallback', seed])
        : albumThemeKey;

    const cachedVisualizerColor = albumExtractionCache?.key === artworkKey
      ? albumExtractionCache.theme.dominantColor ?? FALLBACK_VISUALIZER_COLOR
      : null;
    const needsCachedVisualizerColor = audioReactionEnabled(snapshot.settings)
      && cachedVisualizerColor !== null
      && snapshot.visualizerColor !== cachedVisualizerColor;
    if (themeKey === activeThemeKey && artworkKey === activeVisualizerColorKey && !needsCachedVisualizerColor) return;

    const requestAlbumExtraction = () => {
      if (!imageUrl) {
        activeVisualizerColorKey = artworkKey;
        themeGeneration += 1;
        snapshot = { ...snapshot, visualizerColor: FALLBACK_VISUALIZER_COLOR };
        if (snapshot.settings.theme.mode === 'album') {
          snapshot = { ...snapshot, theme: fallbackThemeFromSeed(seed) };
        }
        emit();
        return;
      }

      if (albumExtractionCache?.key === artworkKey) {
        const visualizerColor = albumExtractionCache.theme.dominantColor ?? FALLBACK_VISUALIZER_COLOR;
        const shouldApplyTheme = snapshot.settings.theme.mode === 'album' && snapshot.theme !== albumExtractionCache.theme;
        const shouldApplyVisualizerColor = audioReactionEnabled(snapshot.settings);
        if ((!shouldApplyVisualizerColor || snapshot.visualizerColor === visualizerColor) && !shouldApplyTheme) return;
        snapshot = {
          ...snapshot,
          ...(shouldApplyVisualizerColor ? { visualizerColor } : {}),
          ...(shouldApplyTheme ? { theme: albumExtractionCache.theme } : {})
        };
        emit();
        return;
      }
      if (activeVisualizerColorKey === artworkKey) return;
      activeVisualizerColorKey = artworkKey;
      const generation = ++themeGeneration;
      void extractTheme(imageUrl, seed)
        .catch((): AlbumThemeExtraction => fallbackThemeFromSeed(seed))
        .then((theme) => {
          const extractedTheme = theme;
          if (disposed || generation !== themeGeneration) return;
          albumExtractionCache = { key: artworkKey, theme: extractedTheme };
          snapshot = {
            ...snapshot,
            ...(audioReactionEnabled(snapshot.settings)
              ? { visualizerColor: extractedTheme.dominantColor ?? FALLBACK_VISUALIZER_COLOR }
              : {}),
            ...(snapshot.settings.theme.mode === 'album' && activeThemeKey === albumThemeKey ? { theme: extractedTheme } : {})
          };
          emit();
        });
    };

    activeThemeKey = themeKey;
    if (snapshot.settings.theme.mode === 'custom' && customColor) {
      snapshot = { ...snapshot, theme: themeFromPrimary(customColor, 'fallback') };
      emit();
      requestAlbumExtraction();
      return;
    }
    if (snapshot.settings.theme.mode === 'fallback') {
      snapshot = { ...snapshot, theme: fallbackThemeFromSeed(seed) };
      emit();
      requestAlbumExtraction();
      return;
    }
    requestAlbumExtraction();
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

  const poll = async (runId: number, currentProvider: PlaybackProvider, signal: AbortSignal) => {
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
    if (result.ok) hasSuccessfulPlaybackPoll = true;
    else if (!retainsPlaybackEligibility(result.error.kind)) hasSuccessfulPlaybackPoll = false;
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
      if (delay <= 2_147_483_647) {
        pollingTimeout = window.setTimeout(() => void poll(runId, currentProvider, signal), delay);
        return;
      }
      const retryAt = Math.min(Number.MAX_SAFE_INTEGER, Date.now() + delay);
      const wait = () => {
        if (disposed || runId !== pollingRunId) return;
        const remaining = retryAt - Date.now();
        if (remaining <= 0) { void poll(runId, currentProvider, signal); return; }
        pollingTimeout = window.setTimeout(wait, Math.min(remaining, 2_147_483_647));
      };
      wait();
    }
  };

  const configureProvider = () => {
    hasSuccessfulPlaybackPoll = false;
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
    const selection = selectProvider(settings, credentialClosure.read(), undefined, directSession);
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

  const storageFailed = () => {
    if (disposed) return;
    clearProvider();
    directSession = undefined;
    authorizationId = undefined;
    credentialClosure.clear();
    snapshot = { ...snapshot, providerSelection: 'invalid', providerConfigurationError: 'Spotify認証情報を保存・復元できません。保存領域を確認してください。' };
    emit();
  };
  const acceptStored = (record: CredentialRecord | null, epoch: number, activate = true) => {
    if (disposed || epoch !== credentialEpoch || !safetyGateOpen) return;
    if (!activate && snapshot.settings.spotify.provider !== 'direct') return;
    if (record && credentialStore && (record.id !== authorizationId || !directSession)) {
      const recordId = record.id;
      directSession = new DirectTokenSession(credentialStore, recordId, fetch, () => {
        if (disposed || authorizationId !== recordId) return;
        credentialClosure.clear();
        emit();
      });
      authorizationId = record.id;
    }
    if (!record) { directSession = undefined; authorizationId = undefined; }
    applyingStoredCredential = true;
    try {
      runtime.applyConfiguration({ ...snapshot.settings, spotify: { ...snapshot.settings.spotify, provider: 'direct' } }, record ? {
        kind: 'replace', value: { kind: 'direct', clientId: record.clientId, refreshToken: record.refreshToken, authorizationId: record.authorizationId, authorizedAtMs: record.authorizedAtMs }
      } : { kind: 'clear' }, safetyGateOpen);
    } finally { applyingStoredCredential = false; }
  };

  const runtime: WallpaperRuntime = {
    enableCredentialStore(store) {
      if (credentialStore || disposed) return;
      credentialStore = store;
      const epoch = credentialEpoch;
      credentialQueue = credentialQueue.then(async () => {
        const record = await store.read();
        if (record) acceptStored(record, epoch, false);
      }).catch(storageFailed);
    },
    start() {
      if (started || disposed) return;
      started = true;
      if (typeof window !== 'undefined') {
        startClock();
        progressInterval = window.setInterval(() => {
          snapshot = { ...snapshot, progressNowMs: Date.now() };
          emit();
        }, 1000);
        const audioBridge = connectAudio((frame) => runtime.acceptAudioFrame(frame));
        audioBridgeSource = audioBridge.source;
        stopAudio = audioBridge.stop;
        startVisualizers();
      }
      configureProvider();
      if (credentialStore && safetyGateOpen) {
        const store = credentialStore;
        const epoch = credentialEpoch;
        credentialQueue = credentialQueue.then(async () => {
          const record = await store.read();
          if (record) acceptStored(record, epoch, false);
        }).catch(storageFailed);
      }
    },
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      listener(snapshot as ReadonlyWallpaperRuntimeSnapshot);
      return () => listeners.delete(listener);
    },
    applyConfiguration(settings, credential, gateOpen, providerSelectionExplicit = false) {
      if (disposed) return;
      // Erasing secrets is allowed even when malformed settings prohibit networking.
      if (!applyingStoredCredential && credential.kind === 'clear') {
        credentialEpoch += 1;
        directSession = undefined;
        authorizationId = undefined;
        const store = credentialStore;
        if (store) credentialQueue = credentialQueue.then(() => store.disconnect()).catch(storageFailed);
      }
      if (credentialStore && !applyingStoredCredential && gateOpen && safetyGateOpen) {
        const store = credentialStore;
        if (credential.kind === 'replace' && credential.value.kind === 'direct') {
          const input = credential.value;
          const epoch = ++credentialEpoch;
          credentialQueue = credentialQueue.then(async () => {
            const record = await store.import(input);
            // A retired notification cannot displace the current account.
            if (record) acceptStored(record, epoch);
            else acceptStored(await store.read(), epoch);
          }).catch(() => {
            if (disposed || epoch !== credentialEpoch) return;
            snapshot = { ...snapshot, providerConfigurationError: '新しいSpotify認証情報を保存できません。現在の接続を保持しています。' };
            emit();
          });
          credential = { kind: 'retain' };
          settings = { ...settings, spotify: { ...settings.spotify, provider: snapshot.settings.spotify.provider } };
        } else if (credential.kind === 'replace' && credential.value.kind === 'backend') {
          credentialEpoch += 1;
          directSession = undefined;
          authorizationId = undefined;
        } else if (credential.kind === 'retain' && (providerSelectionExplicit || settings.spotify.provider !== snapshot.settings.spotify.provider)) {
          const epoch = ++credentialEpoch;
          if (settings.spotify.provider === 'direct') {
            credentialQueue = credentialQueue.then(async () => acceptStored(await store.read(), epoch)).catch(storageFailed);
          }
        }
      }
      safetyGateOpen = safetyGateOpen && gateOpen;
      const previousProvider = snapshot.settings.spotify.provider;
      const previousVisualizerEnabled = snapshot.settings.visualizer.enabled;
      const previousGlowingObjectsEnabled = snapshot.settings.visualizer.glowingObjectsEnabled;
      const previousAudioReactionEnabled = audioReactionEnabled(snapshot.settings);
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
      const nextAudioReactionEnabled = audioReactionEnabled(settings);
      snapshot = {
        ...snapshot,
        settings: structuredClone(settings),
        progressNowMs: Date.now(),
        ...(previousVisualizerEnabled && !settings.visualizer.enabled
          ? { visualizerFrame: null }
          : {}),
        ...(!nextAudioReactionEnabled
          ? {
              visualizerFrame: null,
              previousVisualizerFrame: null,
              visualizerMotion: neutralVisualizerMotion(),
              visualizerColor: FALLBACK_VISUALIZER_COLOR
            }
          : {}),
        ...(!settings.transitions.enabled ? { transitionState: null } : {})
      };
      if (!nextAudioReactionEnabled) {
        activeVisualizerColorKey = '';
        themeGeneration += 1;
        motionReleaseSource = null;
        motionReleaseStartedAtMs = null;
      }
      if (!settings.transitions.enabled && transitionTimeout !== null && typeof window !== 'undefined') {
        window.clearTimeout(transitionTimeout);
        transitionTimeout = null;
      }
      if (started && typeof window !== 'undefined' && (previousClockShowSeconds !== settings.clock.showSeconds || previousClockEnabled !== settings.clock.enabled)) {
        startClock();
      }
      if (started && typeof window !== 'undefined' && (
        previousPerformanceMode !== settings.performance.mode ||
        previousVisualizerEnabled !== settings.visualizer.enabled ||
        previousGlowingObjectsEnabled !== settings.visualizer.glowingObjectsEnabled ||
        previousAudioReactionEnabled !== nextAudioReactionEnabled
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
      if (disposed || !audioReactionEnabled(snapshot.settings)) return;
      const nowMs = Date.now();
      if (frame.source === 'wallpaper-engine' || frame.source === 'mock') {
        audioBridgeSource = frame.source;
      }
      if (frame.source === 'mock') {
        lastMockFrameAtMs = nowMs;
      }
      const safeTimestampMs = Number.isFinite(frame.timestampMs) ? frame.timestampMs : nowMs;
      const acceptsAudio = playbackAcceptsAudio(frame.source);
      const inputGain = acceptsAudio
        && frame.source === 'wallpaper-engine'
        && snapshot.playback.source === 'spotify'
        ? virtualVolumeBoostGain(snapshot.playback.volumePercent)
        : 1;
      const isSilent = isSilentWallpaperFrame(frame, snapshot.settings.visualizer, inputGain);
      let previous = snapshot.previousVisualizerFrame;
      if (frame.source === 'wallpaper-engine') {
        lastWallpaperFrameAtMs = nowMs;
        if (isSilent) {
          silentSinceMs ??= nowMs;
          if (nowMs - silentSinceMs >= SILENCE_RELEASE_MS) previous = null;
        } else {
          silentSinceMs = null;
        }
      }
      const inactiveWallpaperAudio = frame.source === 'wallpaper-engine' && !acceptsAudio;
      const displayFrame = inactiveWallpaperAudio
        ? createSilentAudioFrame(safeTimestampMs)
        : { ...frame, timestampMs: safeTimestampMs };
      if (inactiveWallpaperAudio || displayFrame.source === 'idle') previous = null;
      const normalized = shapeVisualizerFrame(displayFrame, previous, snapshot.settings.visualizer, inputGain);
      const shaped = applyVisualizerIntensity(normalized, snapshot.settings.visualizer.intensity);
      const releaseToNeutral = isSilent || !acceptsAudio;
      const targetMotion = releaseToNeutral ? neutralVisualizerMotion() : calculateVisualizerMotion(shaped);
      const targetEnergy = Math.max(targetMotion.stretchLevel, Math.hypot(targetMotion.albumOffsetX, targetMotion.albumOffsetY) / 8);
      const currentEnergy = Math.max(snapshot.visualizerMotion.stretchLevel, Math.hypot(snapshot.visualizerMotion.albumOffsetX, snapshot.visualizerMotion.albumOffsetY) / 8);
      let visualizerMotion = targetMotion;
      if (targetEnergy < currentEnergy) {
        motionReleaseSource ??= snapshot.visualizerMotion;
        const motionClockMs = releaseToNeutral ? nowMs : normalized.timestampMs;
        motionReleaseStartedAtMs ??= isSilent ? (silentSinceMs ?? motionClockMs) : motionClockMs;
        visualizerMotion = releaseVisualizerMotion(
          motionReleaseSource,
          targetMotion,
          motionClockMs - motionReleaseStartedAtMs
        );
      } else {
        motionReleaseSource = null;
        motionReleaseStartedAtMs = null;
      }
      snapshot = {
        ...snapshot,
        previousVisualizerFrame: normalized,
        visualizerFrame: snapshot.settings.visualizer.enabled ? shaped : null,
        visualizerMotion
      };
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
          case 'play':
            hasSuccessfulPlaybackPoll = false;
            snapshot = { ...snapshot, playback: { ...snapshot.playback, isPlaying: true, fetchedAt: new Date().toISOString(), progressMs } };
            break;
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
      audioBridgeSource = null;
      lastWallpaperFrameAtMs = 0;
      lastMockFrameAtMs = 0;
      silentSinceMs = null;
      motionReleaseSource = null;
      motionReleaseStartedAtMs = null;
      hasSuccessfulPlaybackPoll = false;
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
  const safeRetryAfterMs = typeof retryAfterMs === 'number' && Number.isSafeInteger(retryAfterMs) && retryAfterMs >= 0
    ? Math.round(retryAfterMs)
    : undefined;
  return {
    kind: error.kind,
    message: error.kind === 'rate_limited' && error.quotaExceeded === true ? 'Spotify開発者アカウントのquota上限です。再認証せず時間をおいてください。' : safeProviderErrorMessage(error.kind),
    ...(error.quotaExceeded === true ? { quotaExceeded: true } : {}),
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
    case 'storage_error': return 'Spotify認証情報を保存・復元できません。保存領域を確認して再接続してください。';
    case 'unavailable': return 'Spotify is temporarily unavailable.';
    case 'unknown_response_shape': return 'Spotify returned an unsupported response.';
    case 'item_null': return 'Spotify is not currently playing an item.';
  }
};

const retainsPlaybackEligibility = (kind: SpotifyPlaybackError['kind']): boolean =>
  kind === 'network_error' || kind === 'rate_limited' || kind === 'unknown_response_shape';
