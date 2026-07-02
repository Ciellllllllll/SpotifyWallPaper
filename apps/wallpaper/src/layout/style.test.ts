import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../settings/defaultSettings';
import { layoutStyle } from './style';

describe('layoutStyle', () => {
  it('converts percent coordinates and anchors into CSS', () => {
    const style = layoutStyle({
      ...defaultSettings.layout.items.albumArt,
      x: 25,
      y: 75,
      anchor: 'bottom-right',
      scale: 1.2,
      rotation: 12
    });

    expect(style).toContain('left: clamp(20px, 25%, calc(100vw - 20px))');
    expect(style).toContain('top: clamp(20px, 75%, calc(100vh - 20px))');
    expect(style).toContain('translate(-100%, -100%) scale(1.2) rotate(12deg)');
  });
});
