import type { WallpaperSettings, WallpaperTheme } from '@spotify-wallpaper/shared-types';

export const buildBackgroundStyle = (
  settings: WallpaperSettings,
  theme: WallpaperTheme,
  albumImageUrl: string
): string => {
  const overlay = `linear-gradient(rgb(12 14 18 / ${theme.overlayOpacity}), rgb(12 14 18 / ${Math.min(
    0.82,
    theme.overlayOpacity + 0.28
  )}))`;

  if (settings.background.mode === 'solid-color') {
    return `background: ${settings.background.solidColor}; opacity: ${settings.background.opacity}`;
  }

  if (settings.background.mode === 'album-gradient') {
    return `background: ${overlay}, linear-gradient(135deg, ${theme.primaryColor}, ${theme.darkColor} 58%, ${theme.accentColor}); opacity: ${settings.background.opacity}`;
  }

  return [
    `background-image: ${overlay}, url('${albumImageUrl}')`,
    'background-size: cover',
    'background-position: center',
    `filter: blur(${settings.background.blurPx}px) saturate(1.16)`,
    'transform: scale(1.08)',
    `opacity: ${settings.background.opacity}`
  ].join('; ');
};

export const buildThemeCssVariables = (theme: WallpaperTheme): string =>
  [
    `--theme-primary: ${theme.primaryColor}`,
    `--theme-secondary: ${theme.secondaryColor}`,
    `--theme-accent: ${theme.accentColor}`,
    `--theme-muted: ${theme.mutedColor}`,
    `--theme-dark: ${theme.darkColor}`,
    `--theme-light: ${theme.lightColor}`,
    `--theme-text: ${theme.readableTextColor}`,
    `--theme-shadow-strength: ${theme.shadowStrength}`
  ].join('; ');
