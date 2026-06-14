import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeRainmeterJson } from './tauriCommands';

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
});
