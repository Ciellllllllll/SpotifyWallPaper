import type { ProviderResult as ApiResult } from '@spotify-wallpaper/shared-types';
import type { IncomingMessage } from 'node:http';

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the configured limit.');
    this.name = 'RequestBodyTooLargeError';
  }
}

export class InvalidRequestHeadersError extends Error {
  constructor() {
    super('Request headers are invalid.');
    this.name = 'InvalidRequestHeadersError';
  }
}

const wallpaperOrigins = new Set(['null', 'http://127.0.0.1:5173']);

export function isWallpaperOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return origin !== null && wallpaperOrigins.has(origin);
}

export async function incomingMessageToRequest(
  message: IncomingMessage,
  maxBodyBytes = 64 * 1024,
  baseUrl = 'http://unix'
): Promise<Request> {
  if (hasDuplicateHeader(message, 'authorization')) {
    message.resume();
    throw new InvalidRequestHeadersError();
  }
  const method = message.method ?? 'GET';
  const headers = incomingHeaders(message);
  const bodylessMethod =
    method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  const body = await readIncomingBody(message, maxBodyBytes);

  return new Request(new URL(message.url ?? '/', baseUrl), {
    method,
    headers,
    ...(bodylessMethod || body.byteLength === 0 ? {} : { body })
  });
}

export function handleCorsPreflight(
  request: Request,
  allowedMethod: 'GET' | 'POST'
): Response {
  if (!isWallpaperOriginAllowed(request)) {
    return apiError(403, 'unauthorized', 'Wallpaper origin is not allowed.');
  }
  const requestedMethod = request.headers.get('Access-Control-Request-Method');
  const requestedHeaders = parseRequestedHeaders(
    request.headers.get('Access-Control-Request-Headers')
  );
  if (
    requestedMethod !== allowedMethod ||
    requestedHeaders === null ||
    requestedHeaders.some(
      (header) => header !== 'authorization' && header !== 'content-type'
    ) ||
    !requestedHeaders.includes('authorization')
  ) {
    return apiError(403, 'unauthorized', 'CORS preflight was rejected.');
  }
  return withWallpaperCors(
    new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': `${allowedMethod}, OPTIONS`,
        'Access-Control-Max-Age': '600'
      }
    }),
    request
  );
}

export function withWallpaperCors(response: Response, request: Request): Response {
  const origin = request.headers.get('Origin');
  if (origin === null || !wallpaperOrigins.has(origin)) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Expose-Headers', 'Retry-After');
  headers.set('Vary', 'Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function apiResult<T>(result: ApiResult<T>): Response {
  if (result.ok) {
    return Response.json(result, {
      headers: safeApiHeaders()
    });
  }
  const status =
    result.error.status ??
    (result.error.kind === 'unknown_response_shape' ? 502 : 503);
  const headers = safeApiHeaders();
  if (result.error.retryAfterMs !== undefined) {
    headers.set(
      'Retry-After',
      String(Math.max(1, Math.ceil(result.error.retryAfterMs / 1000)))
    );
  }
  return Response.json(result, { status, headers });
}

export function apiError(
  status: number,
  kind:
    | 'forbidden'
    | 'rate_limited'
    | 'unauthorized'
    | 'unavailable'
    | 'unknown_response_shape',
  message: string,
  retryAfterMs?: number
): Response {
  return apiResult({
    ok: false,
    error: {
      kind,
      message,
      status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs })
    }
  });
}

export async function readBoundedBytes(
  message: Request | Response,
  maxBytes: number
): Promise<Uint8Array | null> {
  const contentLength = Number(message.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await message.body?.cancel();
    return null;
  }
  if (message.body === null) {
    return new Uint8Array();
  }

  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the original reader error and fixed caller error path.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export async function readBoundedText(
  message: Request | Response,
  maxBytes: number
): Promise<string | null> {
  const bytes = await readBoundedBytes(message, maxBytes);
  if (bytes === null) {
    return null;
  }
  return new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: true
  }).decode(bytes);
}

export async function discardBoundedBody(
  message: Request | Response,
  maxBytes: number
): Promise<void> {
  try {
    await readBoundedBytes(message, maxBytes);
  } catch {
    try {
      await message.body?.cancel();
    } catch {
      // The response is already unusable; keep the caller's fixed error path.
    }
  }
}

function safeApiHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  });
}

function parseRequestedHeaders(value: string | null): string[] | null {
  if (value === null) {
    return null;
  }
  const headers = value
    .split(',')
    .map((header) => header.trim().toLowerCase());
  return headers.length > 0 &&
    headers.every((header) => header.length > 0) &&
    new Set(headers).size === headers.length
    ? headers
    : null;
}

function incomingHeaders(message: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function hasDuplicateHeader(message: IncomingMessage, name: string): boolean {
  let count = 0;
  for (let index = 0; index < message.rawHeaders.length; index += 2) {
    if (message.rawHeaders[index]?.toLowerCase() === name) {
      count += 1;
      if (count > 1) return true;
    }
  }
  return false;
}

async function readIncomingBody(
  message: IncomingMessage,
  maxBodyBytes: number
): Promise<Uint8Array<ArrayBuffer>> {
  const declaredLength = Number(message.headers['content-length'] ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    message.resume();
    throw new RequestBodyTooLargeError();
  }

  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    const cleanup = (): void => {
      message.off('data', onData);
      message.off('end', onEnd);
      message.off('error', onError);
      message.off('aborted', onAborted);
    };
    const fail = (error: Error): void => {
      cleanup();
      message.resume();
      reject(error);
    };
    const onData = (chunk: Buffer): void => {
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBodyBytes) {
        fail(new RequestBodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      cleanup();
      const body = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(body);
    };
    const onError = (): void => fail(new Error('Request body could not be read.'));
    const onAborted = (): void => fail(new Error('Request body was aborted.'));

    message.on('data', onData);
    message.once('end', onEnd);
    message.once('error', onError);
    message.once('aborted', onAborted);
  });
}
