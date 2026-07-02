import { describe, expect, it } from 'vitest';
import { lyricDisplayState, parseLrc } from './lrc';

describe('LRC parser', () => {
  it('parses metadata, offset, duplicate timestamps, and empty lines', () => {
    const parsed = parseLrc('[ar:metadata]\n[offset:100]\n[00:01.00]First\n[00:01.00]Duplicate\n[00:02.50]');

    expect(parsed.offsetMs).toBe(100);
    expect(parsed.lines).toEqual([
      { timeMs: 1100, text: 'First' },
      { timeMs: 1100, text: 'Duplicate' },
      { timeMs: 2600, text: '' }
    ]);
  });

  it('applies offset metadata regardless of where it appears', () => {
    const parsed = parseLrc('[00:01.00]First\n[offset:250]\n[00:02.00]Second');

    expect(parsed.offsetMs).toBe(250);
    expect(parsed.lines).toEqual([
      { timeMs: 1250, text: 'First' },
      { timeMs: 2250, text: 'Second' }
    ]);
  });

  it('finds previous current and next lyric lines by playback progress', () => {
    const parsed = parseLrc('[00:01.00]One\n[00:02.00]Two\n[00:03.00]Three');
    const state = lyricDisplayState(parsed.lines, 2500, true, true);

    expect(state).toMatchObject({
      status: 'active',
      previous: { text: 'One' },
      current: { text: 'Two' },
      next: { text: 'Three' }
    });
  });

  it('reports before-first-line and missing states safely', () => {
    const parsed = parseLrc('[00:05.00]Later');

    expect(lyricDisplayState(parsed.lines, 1000, true, true)).toMatchObject({
      status: 'before-first-line',
      next: { text: 'Later' }
    });
    expect(lyricDisplayState([], 1000, true, true).status).toBe('missing');
    expect(lyricDisplayState([], 1000, false, true).status).toBe('disabled');
  });
});
