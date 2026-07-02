import type { LayoutAnchor, LayoutItem } from '@spotify-wallpaper/shared-types';
import { layoutRectWithCore } from '../wasm/visualCore';

export const layoutStyle = (item: LayoutItem): string => {
  const coreRect = layoutRectWithCore(item);
  if (coreRect) {
    return [
      `left: ${coreRect.x}px`,
      `top: ${coreRect.y}px`,
      `width: ${coreRect.width}px`,
      `height: ${coreRect.height}px`,
      `opacity: ${item.opacity}`,
      `z-index: ${item.zIndex}`,
      `transform: scale(${item.scale}) rotate(${item.rotation}deg)`,
      'transform-origin: center'
    ].join('; ');
  }

  const [offsetX, offsetY] = anchorTransform(item.anchor);
  const unit = cssUnit(item.unit);
  const clamp = item.responsive === 'clamp-safe-area';
  const left = clamp
    ? `clamp(${item.safeAreaMargin}px, ${item.x}${unit}, calc(100vw - ${item.safeAreaMargin}px))`
    : `${item.x}${unit}`;
  const top = clamp
    ? `clamp(${item.safeAreaMargin}px, ${item.y}${unit}, calc(100vh - ${item.safeAreaMargin}px))`
    : `${item.y}${unit}`;

  return [
    `left: ${left}`,
    `top: ${top}`,
    `width: ${item.width}px`,
    `height: ${item.height}px`,
    `opacity: ${item.opacity}`,
    `z-index: ${item.zIndex}`,
    `transform: translate(${offsetX}, ${offsetY}) scale(${item.scale}) rotate(${item.rotation}deg)`,
    'transform-origin: center'
  ].join('; ');
};

const cssUnit = (unit: LayoutItem['unit']): string => {
  if (unit === 'percent') {
    return '%';
  }
  return unit;
};

const anchorTransform = (anchor: LayoutAnchor): [string, string] => {
  switch (anchor) {
    case 'top-left':
      return ['0', '0'];
    case 'top-center':
      return ['-50%', '0'];
    case 'top-right':
      return ['-100%', '0'];
    case 'center-left':
      return ['0', '-50%'];
    case 'center':
      return ['-50%', '-50%'];
    case 'center-right':
      return ['-100%', '-50%'];
    case 'bottom-left':
      return ['0', '-100%'];
    case 'bottom-center':
      return ['-50%', '-100%'];
    case 'bottom-right':
      return ['-100%', '-100%'];
  }
};
