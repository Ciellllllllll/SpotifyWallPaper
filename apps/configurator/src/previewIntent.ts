import type { WallpaperPreferences } from '@spotify-wallpaper/shared-types';
import type { WallpaperViewIntent } from '@spotify-wallpaper/wallpaper-view';

/** Preview-only router: display mode is local; playback intents are deliberately dropped. */
export const applyPreviewIntent = (
  current: WallpaperPreferences['player']['displayMode'],
  intent: WallpaperViewIntent
): WallpaperPreferences['player']['displayMode'] =>
  intent.type === 'toggle-display-mode'
    ? current === 'album-only' ? 'album-details' : 'album-only'
    : current;
