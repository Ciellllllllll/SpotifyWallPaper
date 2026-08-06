export type RainmeterWriteResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'invalid' | 'failed'; message: string };

type CommandFailure = { ok: false; reason: 'unavailable' | 'invalid' | 'failed'; message: string };

export type SpotifyOAuthResult =
  | { ok: true; status: 'copied' }
  | { ok: false; reason: 'unavailable' | 'invalid' | 'failed'; errorCode: SpotifyAuthErrorCode; message: string };

export type SpotifyAuthErrorCode =
  | 'invalid_input'
  | 'listener_unavailable'
  | 'browser_open_failed'
  | 'callback_unavailable'
  | 'callback_invalid'
  | 'state_mismatch'
  | 'authorization_denied'
  | 'token_exchange_failed'
  | 'token_encoding_failed'
  | 'copy_not_confirmed'
  | 'clipboard_unavailable'
  | 'native_unavailable'
  | 'native_failed';

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

export const authorizeSpotifyAndCopySwpt1 = async (
  clientId: string
): Promise<SpotifyOAuthResult> => {
  if (!clientId.trim()) {
    return { ok: false, reason: 'invalid', errorCode: 'invalid_input', message: 'Client ID is required.' };
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const response = await invoke<unknown>('authorize_spotify_and_copy_swpt1', { clientId: clientId.trim() });
    if (isCopiedResponse(response)) return { ok: true, status: 'copied' };
    const errorCode = normalizeSpotifyAuthErrorCode(response);
    return {
      ok: false,
      reason: 'failed',
      errorCode,
      message: spotifyAuthorizeErrorMessage(errorCode)
    };
  } catch (error) {
    return spotifyCommandError(error);
  }
};

export const startRainmeterScheduler = async (
  outputPath: string,
  payloadJson: string,
  isPlaying: boolean,
  stoppedUpdateIntervalMs: number
): Promise<RainmeterWriteResult> => rainmeterSchedulerCommand('start_rainmeter_scheduler', outputPath, payloadJson, isPlaying, stoppedUpdateIntervalMs);

export const updateRainmeterScheduler = async (
  outputPath: string,
  payloadJson: string,
  isPlaying: boolean,
  stoppedUpdateIntervalMs: number
): Promise<RainmeterWriteResult> => rainmeterSchedulerCommand('update_rainmeter_scheduler', outputPath, payloadJson, isPlaying, stoppedUpdateIntervalMs);

export const stopRainmeterScheduler = async (): Promise<RainmeterWriteResult> => {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('stop_rainmeter_scheduler');
    return { ok: true };
  } catch (error) {
    return commandError(error);
  }
};

const rainmeterSchedulerCommand = async (
  command: string,
  outputPath: string,
  payloadJson: string,
  isPlaying: boolean,
  stoppedUpdateIntervalMs: number
): Promise<RainmeterWriteResult> => {
  if (!outputPath.trim()) {
    return { ok: false, reason: 'invalid', message: 'Rainmeter output path is required.' };
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke(command, {
      outputPath: outputPath.trim(),
      payloadJson,
      isPlaying,
      stoppedUpdateIntervalMs
    });
    return { ok: true };
  } catch (error) {
    return commandError(error);
  }
};

const sanitizeErrorMessage = (message: string): string =>
  message
    .replace(/access[_-]?token=[^&\s]+/gi, 'access_token=[redacted]')
    .replace(/refresh[_-]?token=[^&\s]+/gi, 'refresh_token=[redacted]')
    .replace(/code=[^&\s]+/gi, 'code=[redacted]');

const spotifyAuthorizeErrorMessage = (errorCode?: string): string => {
  switch (errorCode) {
    case 'invalid_input':
    case 'invalid_redirect_uri':
      return 'Client ID or local redirect URI is invalid.';
    case 'authorization_denied':
    case 'state_mismatch':
      return 'Spotify authorization was denied or could not be verified.';
    case 'copy_not_confirmed':
      return 'Clipboard copy was cancelled.';
    case 'clipboard_unavailable':
      return 'Native clipboard is unavailable.';
    case 'native_unavailable':
      return 'Tauri shell unavailable in browser preview.';
    case 'native_failed':
      return 'Native Spotify authorization failed.';
    default:
      return 'Spotify authorization could not be completed.';
  }
};

const isCopiedResponse = (value: unknown): value is { status: 'copied' } =>
  typeof value === 'object' && value !== null && (value as { status?: unknown }).status === 'copied';

const normalizeSpotifyAuthErrorCode = (value: unknown): SpotifyAuthErrorCode => {
  const candidate = typeof value === 'object' && value !== null ? (value as { error_code?: unknown }).error_code : null;
  return typeof candidate === 'string' && spotifyAuthErrorCodes.has(candidate as SpotifyAuthErrorCode)
    ? (candidate as SpotifyAuthErrorCode)
    : 'native_failed';
};

const spotifyAuthErrorCodes = new Set<SpotifyAuthErrorCode>([
  'invalid_input',
  'listener_unavailable',
  'browser_open_failed',
  'callback_unavailable',
  'callback_invalid',
  'state_mismatch',
  'authorization_denied',
  'token_exchange_failed',
  'token_encoding_failed',
  'copy_not_confirmed',
  'clipboard_unavailable',
  'native_unavailable',
  'native_failed'
]);

const spotifyCommandError = (error: unknown): Extract<SpotifyOAuthResult, { ok: false }> => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('__TAURI_INTERNALS__') || message.includes('not a function')) {
    return {
      ok: false,
      reason: 'unavailable',
      errorCode: 'native_unavailable',
      message: 'Tauri shell unavailable in browser preview.'
    };
  }
  return {
    ok: false,
    reason: 'failed',
    errorCode: 'native_failed',
    message: 'Native Spotify authorization failed.'
  };
};

const commandError = (error: unknown): CommandFailure => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('__TAURI_INTERNALS__') || message.includes('not a function')) {
    return { ok: false, reason: 'unavailable', message: 'Tauri shell unavailable in browser preview.' };
  }

  return { ok: false, reason: 'failed', message: sanitizeErrorMessage(message) };
};
