import { describe, expect, it } from 'vitest';
import { isWallpaperEngineSpotifyToken, parseWallpaperEngineSpotifyToken } from './wallpaperEngineToken';

const encodeToken = (clientId: string, refreshToken: string): string => {
  const json = JSON.stringify({ v: 1, clientId, refreshToken });
  return encodeTokenBytes(new TextEncoder().encode(json));
};

const encodeTokenBytes = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
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

  it('rejects non-canonical encoding and extra payload fields', () => {
    expect(parseWallpaperEngineSpotifyToken(`${encodeToken('client-id', 'refresh-token')}=`)).toBeNull();

    const json = JSON.stringify({ v: 1, clientId: 'client-id', refreshToken: 'refresh-token', extra: true });
    let binary = '';
    for (const byte of new TextEncoder().encode(json)) binary += String.fromCharCode(byte);
    const token = `swpt1.${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
    expect(parseWallpaperEngineSpotifyToken(token)).toBeNull();
  });

  it('rejects canonical base64url containing malformed UTF-8', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, clientId: 'client-id', refreshToken: 'refresh-token' }));
    const clientValueStart = bytes.indexOf('c'.charCodeAt(0), bytes.indexOf('c'.charCodeAt(0)) + 1);
    bytes[clientValueStart] = 0x80;

    expect(parseWallpaperEngineSpotifyToken(encodeTokenBytes(bytes))).toBeNull();
  });
});
