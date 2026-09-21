import { mergeAbortSignals } from './providers/signals';
import type { Fetcher } from './types';

/** Bound the entire response, not just arrival of headers. Errors never echo upstream data. */
export const spotifyFetch = async (fetcher: Fetcher, url: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const signal = mergeAbortSignals(controller.signal, init.signal ?? undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const failed = () => new Error('Spotify request failed.');
  try {
    const stopped = new Promise<never>((_, reject) => {
      abort = () => reject(failed());
      signal.signal.addEventListener('abort', abort, { once: true });
      if (signal.signal.aborted) abort();
      timer = setTimeout(() => controller.abort(), 15000);
    });
    const response = await Promise.race([fetcher(url, { ...init, signal: signal.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }), stopped]);
    const body = await Promise.race([response.arrayBuffer(), stopped]);
    if (body.byteLength > 2 * 1024 * 1024) throw failed();
    return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, headers: response.headers });
  } catch { throw failed(); }
  finally {
    clearTimeout(timer);
    if (abort) signal.signal.removeEventListener('abort', abort);
    signal.cleanup();
  }
};
