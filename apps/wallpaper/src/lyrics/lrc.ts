import type { LyricLine } from '@spotify-wallpaper/shared-types';

export interface LrcParseResult {
  offsetMs: number;
  lines: LyricLine[];
}

export interface LyricDisplayState {
  status: 'disabled' | 'missing' | 'before-first-line' | 'active';
  previous: LyricLine | null;
  current: LyricLine | null;
  next: LyricLine | null;
}

export const parseLrc = (input: string): LrcParseResult => {
  let offsetMs = 0;
  const lines: LyricLine[] = [];

  for (const rawLine of input.split(/\r?\n/)) {
    let rest = rawLine.trim();
    const timestamps: number[] = [];

    while (rest.startsWith('[')) {
      const end = rest.indexOf(']');
      if (end < 0) {
        break;
      }

      const tag = rest.slice(1, end);
      rest = rest.slice(end + 1);

      if (tag.startsWith('offset:')) {
        const parsedOffset = Number.parseInt(tag.slice('offset:'.length).trim(), 10);
        offsetMs = Number.isFinite(parsedOffset) ? parsedOffset : 0;
        continue;
      }

      const timestamp = parseTimestamp(tag);
      if (timestamp !== null) {
        timestamps.push(timestamp);
      }
    }

    for (const timestamp of timestamps) {
      lines.push({ timeMs: timestamp + offsetMs, text: rest });
    }
  }

  lines.sort((a, b) => a.timeMs - b.timeMs);
  return { offsetMs, lines };
};

export const lyricDisplayState = (
  lines: LyricLine[],
  progressMs: number,
  enabled: boolean,
  showMissingState: boolean
): LyricDisplayState => {
  if (!enabled) {
    return emptyState('disabled');
  }

  if (lines.length === 0) {
    return emptyState(showMissingState ? 'missing' : 'disabled');
  }

  const currentIndex = findCurrentIndex(lines, progressMs);
  if (currentIndex < 0) {
    return {
      status: 'before-first-line',
      previous: null,
      current: null,
      next: lines[0] ?? null
    };
  }

  return {
    status: 'active',
    previous: lines[currentIndex - 1] ?? null,
    current: lines[currentIndex],
    next: lines[currentIndex + 1] ?? null
  };
};

const parseTimestamp = (tag: string): number | null => {
  const match = /^(\d+):(\d{1,2}(?:\.\d{1,3})?)$/.exec(tag);
  if (!match) {
    return null;
  }

  const minutes = Number.parseInt(match[1], 10);
  const seconds = Number.parseFloat(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }

  return minutes * 60_000 + Math.round(seconds * 1000);
};

const findCurrentIndex = (lines: LyricLine[], progressMs: number): number => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].timeMs <= progressMs) {
      return index;
    }
  }

  return -1;
};

const emptyState = (status: LyricDisplayState['status']): LyricDisplayState => ({
  status,
  previous: null,
  current: null,
  next: null
});
