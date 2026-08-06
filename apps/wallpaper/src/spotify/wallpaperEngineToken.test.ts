import { describe, expect, it } from 'vitest';
import { isWallpaperEngineSpotifyToken, parseWallpaperEngineSpotifyToken } from './wallpaperEngineToken';

const encodeToken = (clientId: string, refreshToken: string): string => {
  const json = JSON.stringify({ v: 1, clientId, refreshToken });
  let binary = '';
  for (const byte of new TextEncoder().encode(json)) {
    binary += String.fromCharCode(byte);
  }
  return `swpt1.${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
};

describe('Wallpaper Engine Spotify token', () => {
  it('detects the bundle prefix', () => {
    expect(isWallpaperEngineSpotifyToken(' swpt1.abc ')).toBe(true);
    expect(isWallpaperEngineSpotifyToken('raw-refresh-token')).toBe(false);
  });

  it('parses a client id and refresh token bundle', () => {
    const token = encodeToken('public-client-id', 'refresh-token');

    expect(parseWallpaperEngineSpotifyToken(token)).toEqual({
      clientId: 'public-client-id',
      refreshToken: 'refresh-token'
    });
  });

  it('rejects malformed bundles without throwing', () => {
    expect(parseWallpaperEngineSpotifyToken('swpt1.not-valid-base64')).toBeNull();
    expect(parseWallpaperEngineSpotifyToken(encodeToken('', 'refresh-token'))).toBeNull();
    expect(parseWallpaperEngineSpotifyToken(encodeToken('client-id', ''))).toBeNull();
  });
});
