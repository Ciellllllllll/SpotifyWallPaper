export type VisualizerSource = 'wallpaper-engine' | 'mock' | 'idle' | 'disabled';

export interface VisualizerFrame {
  source: VisualizerSource;
  samples: number[];
  bass: number;
  mid: number;
  treble: number;
  peak: number;
  timestampMs: number;
}
