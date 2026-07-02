const WALLPAPER_ENGINE_TOKEN_PREFIX = 'swpt1.';
const MAX_WALLPAPER_ENGINE_TOKEN_LENGTH = 20_000;

export interface WallpaperEngineSpotifyToken {
  clientId: string;
  refreshToken: string;
}

export const isWallpaperEngineSpotifyToken = (value: string): boolean =>
  value.trim().startsWith(WALLPAPER_ENGINE_TOKEN_PREFIX);

export const parseWallpaperEngineSpotifyToken = (value: string): WallpaperEngineSpotifyToken | null => {
  const trimmed = value.trim();
  if (!trimmed.startsWith(WALLPAPER_ENGINE_TOKEN_PREFIX) || trimmed.length > MAX_WALLPAPER_ENGINE_TOKEN_LENGTH) {
    return null;
  }

  const encoded = trimmed.slice(WALLPAPER_ENGINE_TOKEN_PREFIX.length);
  try {
    const json = new TextDecoder().decode(base64UrlDecode(encoded));
    const payload: unknown = JSON.parse(json);
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const record = payload as Record<string, unknown>;
    if (record.v !== 1 || typeof record.clientId !== 'string' || typeof record.refreshToken !== 'string') {
      return null;
    }

    const clientId = record.clientId.trim();
    const refreshToken = record.refreshToken.trim();
    if (!clientId || !refreshToken) {
      return null;
    }

    return { clientId, refreshToken };
  } catch {
    return null;
  }
};

const base64UrlDecode = (value: string): Uint8Array => {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
