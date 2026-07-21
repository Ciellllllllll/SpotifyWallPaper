import type { ApiResult } from './contracts';

const wallpaperOrigins = new Set(['null', 'http://127.0.0.1:5173']);

export function isWallpaperOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return origin !== null && wallpaperOrigins.has(origin);
}

export function isSetupSameOrigin(request: Request, env: Env): boolean {
  try {
    const expected = new URL(env.PUBLIC_BASE_URL).origin;
    return (
      new URL(request.url).origin === expected &&
      request.headers.get('Origin') === expected
    );
  } catch {
    return false;
  }
}

export function isSetupOriginAbsent(request: Request, env: Env): boolean {
  try {
    return (
      new URL(request.url).origin === new URL(env.PUBLIC_BASE_URL).origin &&
      request.headers.get('Origin') === null
    );
  } catch {
    return false;
  }
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

export function methodNotAllowed(allow: string): Response {
  const response = apiError(
    405,
    'unavailable',
    'Method is not allowed for this route.'
  );
  response.headers.set('Allow', allow);
  return response;
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
    .map((header) => header.trim().toLowerCase())
    .filter((header) => header.length > 0);
  return headers.length > 0 && new Set(headers).size === headers.length
    ? headers
    : null;
}
