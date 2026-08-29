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
import { visualizerResponseGainForPerformance } from '@spotify-wallpaper/shared-types';
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
import { applyVisualizerIntensity, idleVisualizerFrame, isSilentWallpaperFrame, shapeVisualizerFrame } from '../visualizer/model';
import {
  adaptVisualizerFrame,
  createVisualizerAdaptationState,
  setVisualizerAdaptationPlaybackState
} from '../visualizer/adaptation';
import { calculateVisualizerMotion, neutralVisualizerMotion, releaseVisualizerMotion } from '../visualizer/motion';
import { createSilentAudioFrame, startAudioBridge, type AudioBridgeSource } from '../wallpaperEngine/audio';
import type { CredentialUpdate } from '../wallpaperEngine/types';

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
  let visualizerAdaptation = createVisualizerAdaptationState(mockPlayback.isPlaying);

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

  const renderAdaptedVisualizerFrame = (
    normalized: VisualizerFrame,
    nowMs: number,
    hasValidAudio: boolean
  ): VisualizerFrame => {
    const adaptation = adaptVisualizerFrame(
      visualizerAdaptation,
      normalized,
      snapshot.playback,
      visualizerResponseGainForPerformance(snapshot.settings.performance.mode),
      nowMs,
      hasValidAudio
    );
    visualizerAdaptation = adaptation.state;
    return applyVisualizerIntensity(normalized, adaptation.totalGain * snapshot.settings.visualizer.intensity);
  };

  const refreshCurrentVisualizer = (hasValidAudio: boolean): void => {
    const normalized = snapshot.previousVisualizerFrame;
    if (!normalized || (normalized.source !== 'wallpaper-engine' && normalized.source !== 'mock')) return;
    const silent = normalized.source === 'wallpaper-engine' && silentSinceMs !== null;
    const shaped = renderAdaptedVisualizerFrame(normalized, Date.now(), hasValidAudio && !silent);
    const targetMotion = silent ? neutralVisualizerMotion() : calculateVisualizerMotion(shaped);
    snapshot = {
      ...snapshot,
      visualizerFrame: snapshot.settings.visualizer.enabled ? shaped : null,
      visualizerMotion: targetMotion
    };
    motionReleaseSource = null;
    motionReleaseStartedAtMs = null;
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
    const previous = { playback: snapshot.playback, previousPlayback: snapshot.previousPlayback };
    const history = playbackHistoryAfterPoll(previous, result);
    if (result.ok && history.previousPlayback === previous.playback) startTransition(previous.playback, history.playback);
    snapshot = { ...snapshot, playback: history.playback, previousPlayback: history.previousPlayback };
    visualizerAdaptation = setVisualizerAdaptationPlaybackState(
      visualizerAdaptation,
      history.playback.isPlaying,
      Date.now()
    );
    if (result.ok && history.playback.volumePercent !== previous.playback.volumePercent) {
      refreshCurrentVisualizer(false);
    }
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
        const audioBridge = connectAudio((frame) => runtime.acceptAudioFrame(frame));
        audioBridgeSource = audioBridge.source;
        stopAudio = audioBridge.stop;
        startVisualizers();
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
        visualizerAdaptation = createVisualizerAdaptationState(snapshot.playback.isPlaying);
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
      const isSilent = isSilentWallpaperFrame(frame, snapshot.settings.visualizer);
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
      const normalized = shapeVisualizerFrame({ ...frame, timestampMs: safeTimestampMs }, previous, snapshot.settings.visualizer);
      const shaped = renderAdaptedVisualizerFrame(normalized, nowMs, !isSilent);
      const targetMotion = isSilent ? neutralVisualizerMotion() : calculateVisualizerMotion(shaped);
      const targetEnergy = Math.max(targetMotion.stretchLevel, Math.hypot(targetMotion.albumOffsetX, targetMotion.albumOffsetY) / 8);
      const currentEnergy = Math.max(snapshot.visualizerMotion.stretchLevel, Math.hypot(snapshot.visualizerMotion.albumOffsetX, snapshot.visualizerMotion.albumOffsetY) / 8);
      let visualizerMotion = targetMotion;
      if (targetEnergy < currentEnergy) {
        motionReleaseSource ??= snapshot.visualizerMotion;
        const motionClockMs = isSilent ? nowMs : normalized.timestampMs;
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
            refreshCurrentVisualizer(false);
            break;
          }
          case 'shuffle': snapshot = { ...snapshot, playback: { ...snapshot.playback, shuffleState: command.state } }; break;
          case 'repeat': snapshot = { ...snapshot, playback: { ...snapshot.playback, repeatState: command.state } }; break;
          case 'next':
          case 'previous': break;
        }
        visualizerAdaptation = setVisualizerAdaptationPlaybackState(
          visualizerAdaptation,
          snapshot.playback.isPlaying,
          Date.now()
        );
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
      visualizerAdaptation = createVisualizerAdaptationState(false);
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
