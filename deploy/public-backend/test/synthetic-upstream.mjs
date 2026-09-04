import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';

const upstreamOrigin = 'https://127.0.0.1:9443';
const callbackUrl = 'https://synthetic.test/auth/callback';
const scopes =
  'user-read-playback-state user-read-currently-playing user-modify-playback-state';
let sequence = 0;

function reply(response, status, body = '', headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...headers
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 32_768) throw new Error();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(
  {
    key: readFileSync(process.env.SYNTHETIC_TLS_KEY),
    cert: readFileSync(process.env.SYNTHETIC_TLS_CERT)
  },
  (request, response) => {
    void handle(request, response).catch(() => reply(response, 500));
  }
);

async function handle(request, response) {
  const url = new URL(request.url, upstreamOrigin);
  if (request.method === 'GET' && url.pathname === '/authorize') {
    if (
      !/^[A-Za-z0-9]{16,64}$/.test(url.searchParams.get('client_id') ?? '') ||
      url.searchParams.get('response_type') !== 'code' ||
      url.searchParams.get('redirect_uri') !== callbackUrl ||
      !/^swpo2\.[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('state') ?? '') ||
      url.searchParams.get('scope') !== scopes ||
      url.searchParams.get('code_challenge_method') !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code_challenge') ?? '')
    ) {
      reply(response, 400);
      return;
    }
    sequence += 1;
    const redirect = new URL(callbackUrl);
    redirect.searchParams.set('code', `synthetic-code-${sequence}`);
    redirect.searchParams.set('state', url.searchParams.get('state'));
    reply(response, 302, '', { Location: redirect.toString() });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/token') {
    const form = new URLSearchParams(await readBody(request));
    const grant = form.get('grant_type');
    if (
      !/^[A-Za-z0-9]{16,64}$/.test(form.get('client_id') ?? '') ||
      (grant !== 'authorization_code' && grant !== 'refresh_token') ||
      (grant === 'authorization_code' &&
        (form.get('redirect_uri') !== callbackUrl ||
          !/^synthetic-code-[0-9]+$/.test(form.get('code') ?? '') ||
          !/^[A-Za-z0-9_-]{86}$/.test(form.get('code_verifier') ?? ''))) ||
      (grant === 'refresh_token' &&
        !/^synthetic-refresh-[0-9]+$/.test(form.get('refresh_token') ?? ''))
    ) {
      reply(response, 400);
      return;
    }
    sequence += 1;
    const body = JSON.stringify({
      access_token: `synthetic-access-${sequence}`,
      refresh_token: `synthetic-refresh-${sequence}`,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: scopes
    });
    reply(response, 200, body, { 'Content-Type': 'application/json' });
    return;
  }

  if (
    url.pathname === '/v1/me/player' ||
    url.pathname.startsWith('/v1/me/player/')
  ) {
    if (!/^Bearer synthetic-access-[0-9]+$/.test(request.headers.authorization ?? '')) {
      reply(response, 401);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/me/player') {
      reply(response, 200, JSON.stringify({ item: null }), {
        'Content-Type': 'application/json'
      });
      return;
    }
    if (request.method === 'POST' || request.method === 'PUT') {
      reply(response, 204);
      return;
    }
  }
  reply(response, 404);
}

server.listen(9443, '127.0.0.1', () => {
  writeFileSync(process.env.SYNTHETIC_READY_FILE, 'ready\n', { mode: 0o600 });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
