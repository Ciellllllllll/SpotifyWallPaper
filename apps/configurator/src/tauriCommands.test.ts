import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeSpotifyAndCopySwpt1, writeRainmeterJson } from './tauriCommands';

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

  it('returns only copy status from the native Spotify authorization flow', async () => {
    invoke.mockResolvedValue({ status: 'copied' });

    const result = await authorizeSpotifyAndCopySwpt1('client-id');

    expect(result).toEqual({ ok: true, status: 'copied' });
    expect(invoke).toHaveBeenCalledWith('authorize_spotify_and_copy_swpt1', { clientId: 'client-id' });
  });

  it('maps native fixed error codes without returning token material', async () => {
    invoke.mockResolvedValue({ status: 'error', error_code: 'copy_not_confirmed' });

    const result = await authorizeSpotifyAndCopySwpt1('client-id');

    expect(result).toEqual({ ok: false, reason: 'failed', errorCode: 'copy_not_confirmed', message: 'Clipboard copy was cancelled.' });
    expect(JSON.stringify(result)).not.toMatch(/refresh|access|code=/i);
  });

  it('maps unknown native codes and rejection text to fixed OAuth errors', async () => {
    invoke.mockResolvedValue({ status: 'error', error_code: 'secret-refresh-token' });
    const unknown = await authorizeSpotifyAndCopySwpt1('client-id');
    expect(unknown).toEqual({
      ok: false,
      reason: 'failed',
      errorCode: 'native_failed',
      message: 'Native Spotify authorization failed.'
    });

    invoke.mockRejectedValue(new Error('refresh_token=secret-refresh-token code=secret-code'));
    const rejected = await authorizeSpotifyAndCopySwpt1('client-id');
    expect(rejected).toEqual({
      ok: false,
      reason: 'failed',
      errorCode: 'native_failed',
      message: 'Native Spotify authorization failed.'
    });
    expect(JSON.stringify(rejected)).not.toContain('secret-');
  });
});
