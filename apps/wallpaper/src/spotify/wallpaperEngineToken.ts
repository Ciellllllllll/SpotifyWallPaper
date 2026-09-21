const WALLPAPER_ENGINE_TOKEN_PREFIX = /^swpt[12]\./;
const MAX_WALLPAPER_ENGINE_TOKEN_LENGTH = 20_000;

export interface WallpaperEngineSpotifyToken {
  clientId: string;
  refreshToken: string;
  authorizationId?: string;
  authorizedAtMs?: number;
}

export const isWallpaperEngineSpotifyToken = (value: string): boolean =>
  WALLPAPER_ENGINE_TOKEN_PREFIX.test(value.trim());

export const parseWallpaperEngineSpotifyToken = (value: string): WallpaperEngineSpotifyToken | null => {
  const trimmed = value.trim();
  if (!WALLPAPER_ENGINE_TOKEN_PREFIX.test(trimmed) || trimmed.length > MAX_WALLPAPER_ENGINE_TOKEN_LENGTH) {
    return null;
  }

  const version = trimmed.startsWith('swpt2.') ? 2 : 1;
  const encoded = trimmed.slice(6);
  try {
    const decoded = base64UrlDecode(encoded);
    if (base64UrlEncode(decoded) !== encoded) {
      return null;
    }
    const json = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    const payload: unknown = JSON.parse(json);
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const record = payload as Record<string, unknown>;
    if (
      Object.keys(record).length !== (version === 2 ? 5 : 3) ||
      record.v !== version ||
      typeof record.clientId !== 'string' ||
      typeof record.refreshToken !== 'string'
    ) {
      return null;
    }

    const clientId = record.clientId.trim();
    const refreshToken = record.refreshToken.trim();
    if (!clientId || clientId.length > 256 || !refreshToken || refreshToken.length > 16384) {
      return null;
    }

    if (version === 2) {
      if (typeof record.authorizationId !== 'string' || !/^[a-f0-9]{32}$/.test(record.authorizationId) ||
          typeof record.authorizedAtMs !== 'number' || !Number.isSafeInteger(record.authorizedAtMs) || record.authorizedAtMs < 0 || record.authorizedAtMs > Date.now() + 60_000) return null;
      return { clientId, refreshToken, authorizationId: record.authorizationId, authorizedAtMs: record.authorizedAtMs };
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

const base64UrlEncode = (value: Uint8Array): string => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
