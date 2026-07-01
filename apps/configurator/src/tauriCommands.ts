export type RainmeterWriteResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'invalid' | 'failed'; message: string };

type CommandFailure = { ok: false; reason: 'unavailable' | 'invalid' | 'failed'; message: string };

export type SpotifyOAuthResult =
  | { ok: true; refreshToken: string; expiresIn: number | null }
  | { ok: false; reason: 'unavailable' | 'invalid' | 'failed'; message: string };

export type SpotifyAuthorizeResult = SpotifyOAuthResult;

export type SpotifyAuthStartResult =
  | { ok: true; authUrl: string; state: string }
  | { ok: false; reason: 'unavailable' | 'invalid' | 'failed'; message: string };

export type ExternalOpenResult =
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

export const startSpotifyPkceAuth = async (clientId: string, redirectUri: string): Promise<SpotifyAuthStartResult> => {
  if (!clientId.trim() || !redirectUri.trim()) {
    return { ok: false, reason: 'invalid', message: 'Client ID and redirect URI are required.' };
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const response = await invoke<{ auth_url: string; state: string }>('start_spotify_pkce_auth', {
      clientId: clientId.trim(),
      redirectUri: redirectUri.trim()
    });
    return { ok: true, authUrl: response.auth_url, state: response.state };
  } catch (error) {
    return commandError(error);
  }
};

export const authorizeSpotifyPkce = async (
  clientId: string,
  redirectUri: string
): Promise<SpotifyAuthorizeResult> => {
  if (!clientId.trim() || !redirectUri.trim()) {
    return { ok: false, reason: 'invalid', message: 'Client ID and redirect URI are required.' };
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const response = await invoke<{ refresh_token: string; expires_in?: number }>('authorize_spotify_pkce', {
      clientId: clientId.trim(),
      redirectUri: redirectUri.trim()
    });
    return { ok: true, refreshToken: response.refresh_token, expiresIn: response.expires_in ?? null };
  } catch (error) {
    return commandError(error);
  }
};

export const openExternalUrl = async (url: string): Promise<ExternalOpenResult> => {
  if (!url.trim()) {
    return { ok: false, reason: 'invalid', message: 'Authorization URL is unavailable.' };
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_external_url', {
      url: url.trim()
    });
    return { ok: true };
  } catch (error) {
    return commandError(error);
  }
};

export const exchangeSpotifyCallback = async (
  clientId: string,
  callbackUrl: string
): Promise<SpotifyOAuthResult> => {
  if (!clientId.trim() || !callbackUrl.trim()) {
    return { ok: false, reason: 'invalid', message: 'Client ID and callback URL are required.' };
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const response = await invoke<{ refresh_token: string; expires_in?: number }>('exchange_spotify_callback', {
      clientId: clientId.trim(),
      callbackUrl: callbackUrl.trim()
    });
    return { ok: true, refreshToken: response.refresh_token, expiresIn: response.expires_in ?? null };
  } catch (error) {
    return commandError(error);
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

const commandError = (error: unknown): CommandFailure => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('__TAURI_INTERNALS__') || message.includes('not a function')) {
    return { ok: false, reason: 'unavailable', message: 'Tauri shell unavailable in browser preview.' };
  }

  return { ok: false, reason: 'failed', message: sanitizeErrorMessage(message) };
};
