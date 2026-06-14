export type RainmeterWriteResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'invalid' | 'failed'; message: string };

export const writeRainmeterJson = async (outputPath: string, payloadJson: string): Promise<RainmeterWriteResult> => {
  if (!outputPath.trim()) {
    return { ok: false, reason: 'invalid', message: 'Rainmeter output path is required.' };
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('write_rainmeter_json', {
      outputPath: outputPath.trim(),
      payloadJson
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('__TAURI_INTERNALS__') || message.includes('not a function')) {
      return { ok: false, reason: 'unavailable', message: 'Tauri shell unavailable in browser preview.' };
    }

    return { ok: false, reason: 'failed', message: sanitizeErrorMessage(message) };
  }
};

const sanitizeErrorMessage = (message: string): string =>
  message
    .replace(/access[_-]?token=[^&\s]+/gi, 'access_token=[redacted]')
    .replace(/refresh[_-]?token=[^&\s]+/gi, 'refresh_token=[redacted]')
    .replace(/code=[^&\s]+/gi, 'code=[redacted]');
