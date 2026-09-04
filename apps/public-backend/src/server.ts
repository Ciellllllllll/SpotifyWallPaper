import { chmod } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http';
import {
  apiError,
  incomingMessageToRequest,
  InvalidRequestHeadersError,
  RequestBodyTooLargeError
} from './http.js';
import type { RequestFactory, Router, SocketKind } from './router.js';

export interface StartServersOptions {
  publicSocketPath: string;
  adminSocketPath: string;
  router: Router;
  requestBaseUrl?: string;
  maxRequestBodyBytes?: number;
  setSocketMode?: (path: string, mode: number) => Promise<void>;
  recordRequest?: (
    socket: SocketKind,
    method: string | undefined,
    rawTarget: string | undefined,
    status: number,
    elapsedMs: number
  ) => void;
  toRequest?: (
    message: IncomingMessage,
    maxBodyBytes: number,
    baseUrl: string
  ) => Request | Promise<Request>;
}

export interface RunningServers {
  close(): Promise<void>;
}

export async function startServers({
  publicSocketPath,
  adminSocketPath,
  router,
  requestBaseUrl = 'http://unix',
  maxRequestBodyBytes = 64 * 1024,
  setSocketMode = chmod,
  recordRequest,
  toRequest = incomingMessageToRequest
}: StartServersOptions): Promise<RunningServers> {
  const publicServer = socketServer(
    'public',
    router,
    maxRequestBodyBytes,
    requestBaseUrl,
    toRequest,
    recordRequest
  );
  const adminServer = socketServer(
    'admin',
    router,
    maxRequestBodyBytes,
    requestBaseUrl,
    toRequest,
    recordRequest
  );
  const servers = [publicServer, adminServer];
  const previousUmask =
    process.platform === 'win32' ? undefined : process.umask(0o117);

  try {
    await Promise.all([
      listen(publicServer, publicSocketPath),
      listen(adminServer, adminSocketPath)
    ]);
  } catch (error) {
    await Promise.allSettled(servers.map(closeServer));
    throw error;
  } finally {
    if (previousUmask !== undefined) {
      process.umask(previousUmask);
    }
  }

  try {
    await setSocketMode(publicSocketPath, 0o660);
    await setSocketMode(adminSocketPath, 0o660);
  } catch (error) {
    await Promise.allSettled(servers.map(closeServer));
    throw error;
  }

  let closing: Promise<void> | undefined;
  return {
    close(): Promise<void> {
      closing ??= Promise.all(servers.map(closeServer)).then(() => undefined);
      return closing;
    }
  };
}

function socketServer(
  socket: SocketKind,
  router: Router,
  maxRequestBodyBytes: number,
  requestBaseUrl: string,
  toRequest: NonNullable<StartServersOptions['toRequest']>,
  recordRequest: StartServersOptions['recordRequest']
): Server {
  const server = createServer();
  const handle = (
    message: IncomingMessage,
    outgoing: ServerResponse,
    sendContinue = false,
    rejectUnsupportedExpectation = false
  ): void => {
    const startedAt = performance.now();
    let requestFactoryCalled = false;
    const record = (status: number): void => {
      try {
        recordRequest?.(
          socket,
          message.method,
          message.url,
          status,
          performance.now() - startedAt
        );
      } catch {
        // Metrics must never affect request handling.
      }
    };
    const requestFactory: RequestFactory = () => {
      requestFactoryCalled = true;
      if (sendContinue) {
        outgoing.writeContinue();
      }
      return toRequest(message, maxRequestBodyBytes, requestBaseUrl);
    };
    void router(
      socket,
      message,
      requestFactory,
      rejectUnsupportedExpectation
    )
      .then((response) => {
        if (!requestFactoryCalled) {
          outgoing.shouldKeepAlive = false;
          message.resume();
        }
        record(response.status);
        return sendResponse(outgoing, response);
      })
      .catch((error: unknown) => {
        if (!requestFactoryCalled) {
          outgoing.shouldKeepAlive = false;
          message.resume();
        }
        const response =
          error instanceof RequestBodyTooLargeError
            ? apiError(413, 'unavailable', 'Request body is too large.')
            : error instanceof InvalidRequestHeadersError
              ? apiError(400, 'unauthorized', 'Request headers are invalid.')
              : apiError(500, 'unavailable', 'Request could not be processed.');
        record(response.status);
        return sendResponse(outgoing, response);
      });
  };

  server.on('request', handle);
  server.on('checkContinue', (message, outgoing) =>
    handle(message, outgoing, true)
  );
  server.on('checkExpectation', (message, outgoing) =>
    handle(message, outgoing, false, true)
  );
  server.on('upgrade', (_message, socketConnection) => {
    socketConnection.end(
      'HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
    );
  });
  server.on('clientError', (_error, socketConnection) => {
    if (socketConnection.writable) {
      socketConnection.end(
        'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
      );
    }
  });
  return server;
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(socketPath);
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function sendResponse(
  outgoing: ServerResponse,
  response: Response
): Promise<void> {
  if (outgoing.headersSent || outgoing.destroyed) {
    return;
  }
  for (const [name, value] of response.headers) {
    if (name !== 'set-cookie') {
      outgoing.setHeader(name, value);
    }
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) {
    outgoing.setHeader('Set-Cookie', cookies);
  }
  outgoing.statusCode = response.status;
  outgoing.statusMessage = response.statusText;
  const body = Buffer.from(await response.arrayBuffer());
  outgoing.setHeader('Content-Length', body.byteLength);
  outgoing.end(body);
}
