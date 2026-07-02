import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeSpotifyPkce, openExternalUrl, writeRainmeterJson } from './tauriCommands';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke
}));

describe('tauri commands', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('writes Rainmeter JSON through the Tauri command', async () => {
    invoke.mockResolvedValue(undefined);

    const result = await writeRainmeterJson('D:\\Rainmeter\\NowPlaying.json', '{"title":"Track"}');

    expect(result).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('write_rainmeter_json', {
      outputPath: 'D:\\Rainmeter\\NowPlaying.json',
      payloadJson: '{"title":"Track"}'
    });
  });

  it('validates the output path before calling Tauri', async () => {
    const result = await writeRainmeterJson('   ', '{"title":"Track"}');

    expect(result.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not echo token-like values in error messages', async () => {
    invoke.mockRejectedValue(new Error('failed access_token=secret-access-token'));

    const result = await writeRainmeterJson('D:\\Rainmeter\\NowPlaying.json', '{"title":"Track"}');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected Rainmeter write to fail');
    expect(result.message).not.toContain('secret-access-token');
    expect(result.message).toContain('[redacted]');
  });

  it('opens an external URL through the Tauri command', async () => {
    invoke.mockResolvedValue(undefined);

    const result = await openExternalUrl(' https://accounts.spotify.com/authorize?client_id=abc ');

    expect(result).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('open_external_url', {
      url: 'https://accounts.spotify.com/authorize?client_id=abc'
    });
  });

  it('runs Spotify authorization through the automatic Tauri flow', async () => {
    invoke.mockResolvedValue({ refresh_token: 'refresh-token', expires_in: 3600 });

    const result = await authorizeSpotifyPkce('client-id', 'http://127.0.0.1:8899/callback');

    expect(result).toEqual({ ok: true, refreshToken: 'refresh-token', expiresIn: 3600 });
    expect(invoke).toHaveBeenCalledWith('authorize_spotify_pkce', {
      clientId: 'client-id',
      redirectUri: 'http://127.0.0.1:8899/callback'
    });
  });
});
