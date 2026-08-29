import type { NormalizedPlayback, VisualizerFrame } from '@spotify-wallpaper/shared-types';
import {
  inverseVisualizerResponseInput,
  visualizerResponseGainForPerformance
} from '@spotify-wallpaper/shared-types';
import { defaultSettings } from '../settings/defaultSettings';

const VISUALIZER_ADAPTATION_TARGET = 0.98;
const VISUALIZER_HIGH_WATER_DECAY_MS = 12_000;
const VISUALIZER_GAIN_SMOOTH_MS = 450;
const VISUALIZER_MAX_TOTAL_GAIN = 4;

export interface VisualizerAdaptationState {
  trackKey: string | null;
  highWater: number;
  automaticGain: number;
  lastActiveAtMs: number | null;
  lastGainUpdateAtMs: number | null;
  isPlaying: boolean;
}

export interface VisualizerAdaptationResult {
  state: VisualizerAdaptationState;
  totalGain: number;
}

export const createVisualizerAdaptationState = (isPlaying = false): VisualizerAdaptationState => ({
  trackKey: null,
  highWater: 0,
  automaticGain: 1,
  lastActiveAtMs: null,
  lastGainUpdateAtMs: null,
  isPlaying
});

export const setVisualizerAdaptationPlaybackState = (
  state: VisualizerAdaptationState,
  isPlaying: boolean,
  nowMs: number
): VisualizerAdaptationState => {
  const safeNowMs = safeTime(nowMs);
  if (state.isPlaying === isPlaying) return state;
  if (!isPlaying) {
    return {
      ...state,
      isPlaying: false,
      lastActiveAtMs: null,
      lastGainUpdateAtMs: null
    };
  }
  return {
    ...state,
    isPlaying: true,
    lastActiveAtMs: safeNowMs,
    lastGainUpdateAtMs: safeNowMs
  };
};

export const adaptVisualizerFrame = (
  state: VisualizerAdaptationState,
  frame: VisualizerFrame,
  playback: NormalizedPlayback,
  responseGain = visualizerResponseGainForPerformance('standard'),
  nowMs = Date.now(),
  hasValidAudio = true
): VisualizerAdaptationResult => {
  const safeNowMs = safeTime(nowMs);
  const volumeGain = volumeCorrection(playback.volumePercent);
  const playbackState = setVisualizerAdaptationPlaybackState(state, playback.isPlaying, safeNowMs);
  const livePeak = hasValidAudio && isLiveAudioSource(frame.source) ? clamp(safeSignal(frame.peak), 0, 1) : 0;

  if (!playback.isPlaying || !isLiveAudioSource(frame.source)) {
    return makeResult(playbackState, volumeGain);
  }

  const trackKey = playbackTrackKey(playback);
  const trackChanged = playbackState.trackKey !== trackKey;
  const elapsedSinceActive = playbackState.lastActiveAtMs === null
    ? 0
    : Math.max(0, safeNowMs - playbackState.lastActiveAtMs);
  const highWaterBeforeAudio = decayHighWater(playbackState.highWater, elapsedSinceActive);
  const candidateHighWater = livePeak * volumeGain;
  const highWater = Math.max(highWaterBeforeAudio, candidateHighWater);
  const desiredInput = inverseVisualizerResponseInput(
    VISUALIZER_ADAPTATION_TARGET,
    defaultSettings.visualizer.intensity,
    responseGain
  );
  const targetAutomaticGain = highWater > Number.EPSILON
    ? clamp(desiredInput / highWater, 0, VISUALIZER_MAX_TOTAL_GAIN / volumeGain)
    : 1;
  const automaticGain = nextAutomaticGain(
    playbackState,
    targetAutomaticGain,
    safeNowMs,
    trackChanged
  );
  const nextState: VisualizerAdaptationState = {
    trackKey,
    highWater,
    automaticGain,
    lastActiveAtMs: safeNowMs,
    lastGainUpdateAtMs: safeNowMs,
    isPlaying: true
  };

  return makeResult(nextState, volumeGain);
};

const makeResult = (
  state: VisualizerAdaptationState,
  volumeGain: number
): VisualizerAdaptationResult => ({
  state,
  totalGain: clamp(state.automaticGain * volumeGain, 0, VISUALIZER_MAX_TOTAL_GAIN)
});

const nextAutomaticGain = (
  state: VisualizerAdaptationState,
  target: number,
  nowMs: number,
  trackChanged: boolean
): number => {
  if (state.trackKey === null) return target;
  const elapsed = state.lastGainUpdateAtMs === null
    ? 0
    : Math.max(0, nowMs - state.lastGainUpdateAtMs);
  // Start every track change at the carried gain, even after a long callback
  // gap. The next live frames then move toward the new target over 450ms.
  const progress = trackChanged ? 0 : clamp(elapsed / VISUALIZER_GAIN_SMOOTH_MS, 0, 1);
  return state.automaticGain + (target - state.automaticGain) * progress;
};

const decayHighWater = (highWater: number, elapsedMs: number): number => {
  const safeHighWater = safeSignal(highWater);
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  return safeHighWater * Math.exp(-safeElapsedMs / VISUALIZER_HIGH_WATER_DECAY_MS);
};

const volumeCorrection = (volumePercent: number | null): number => {
  if (!Number.isFinite(volumePercent) || volumePercent === null || volumePercent <= 0) return 1;
  return clamp(100 / volumePercent, 1, VISUALIZER_MAX_TOTAL_GAIN);
};

const playbackTrackKey = (playback: NormalizedPlayback): string =>
  playback.id ?? playback.uri ?? `${playback.itemType}:${playback.albumName}:${playback.title}`;

const isLiveAudioSource = (source: VisualizerFrame['source']): boolean =>
  source === 'wallpaper-engine' || source === 'mock';

const safeSignal = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

const safeTime = (value: number): number => (Number.isFinite(value) ? value : Date.now());

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
