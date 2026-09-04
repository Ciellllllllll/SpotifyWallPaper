import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';

const publicSocket = process.env.SYNTHETIC_PUBLIC_SOCKET;
const adminSocket = process.env.SYNTHETIC_ADMIN_SOCKET;
const publicOrigin = 'https://synthetic.test';
const issuer = { 'X-SWP-Client-IP': '192.0.2.10' };

function request(socketPath, method, path, headers = {}, body = '') {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(body);
    const outgoing = httpRequest(
      {
        socketPath,
        method,
        path,
        headers: {
          Host: 'synthetic.test',
          ...issuer,
          ...headers,
          ...(encoded.length === 0 ? {} : { 'Content-Length': encoded.length })
        }
      },
      (incoming) => {
        const chunks = [];
        let length = 0;
        incoming.on('data', (chunk) => {
          length += chunk.length;
          if (length > 65_536) incoming.destroy(new Error());
          else chunks.push(chunk);
        });
        incoming.on('end', () =>
          resolve({
            status: incoming.statusCode,
            headers: incoming.headers,
            body: Buffer.concat(chunks).toString('utf8')
          })
        );
      }
    );
    outgoing.once('error', reject);
    if (encoded.length > 0) outgoing.write(encoded);
    outgoing.end();
  });
}

function cookie(response, name) {
  const values = response.headers['set-cookie'] ?? [];
  const match = values
    .map((value) => new RegExp(`^${name}=([^;]+)`).exec(value)?.[1])
    .find((value) => value !== undefined && value !== '');
  assert.ok(match);
  return `${name}=${match}`;
}

function hidden(body, name) {
  const match = new RegExp(`name="${name}" value="([^"]+)"`).exec(body)?.[1];
  assert.ok(match);
  return match;
}

function form(values) {
  return new URLSearchParams(values).toString();
}

async function setup() {
  const response = await request(adminSocket, 'GET', '/setup');
  assert.equal(response.status, 200);
  return {
    cookie: cookie(response, '__Host-swp-setup'),
    proof: hidden(response.body, 'setupProof')
  };
}

async function startAuthorization(session) {
  const body = form({
    spotifyClientId: 'SyntheticClient123',
    setupProof: session.proof,
    legalAccepted: 'yes'
  });
  const response = await request(
    adminSocket,
    'POST',
    '/auth/start',
    {
      Cookie: session.cookie,
      Origin: publicOrigin,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  );
  assert.equal(response.status, 303);
  assert.equal(typeof response.headers.location, 'string');
  return {
    authorizeUrl: response.headers.location,
    cookie: cookie(response, '__Host-swp-oauth-v2')
  };
}

async function callbackPath(authorizeUrl) {
  const response = await fetch(authorizeUrl, { redirect: 'manual' });
  assert.equal(response.status, 302);
  const location = response.headers.get('Location');
  assert.ok(location);
  const callback = new URL(location);
  assert.equal(callback.origin, publicOrigin);
  return callback.pathname + callback.search;
}

function pairingToken(body) {
  const token = /<pre>(swpb1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})<\/pre>/.exec(
    body
  )?.[1];
  assert.ok(token);
  return token;
}

async function initialAuthorization() {
  const authorization = await startAuthorization(await setup());
  const callback = await request(
    publicSocket,
    'GET',
    await callbackPath(authorization.authorizeUrl),
    { Cookie: authorization.cookie }
  );
  assert.equal(callback.status, 200);
  return pairingToken(callback.body);
}

async function missingCookieAuthorization() {
  const authorization = await startAuthorization(await setup());
  const callback = await request(
    publicSocket,
    'GET',
    await callbackPath(authorization.authorizeUrl)
  );
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.location, '/auth/confirm');
  const confirmationCookie = cookie(callback, '__Host-swp-confirm');
  const confirmation = await request(adminSocket, 'GET', '/auth/confirm', {
    Cookie: confirmationCookie
  });
  assert.equal(confirmation.status, 200);
  const body = form({
    confirmationProof: hidden(confirmation.body, 'confirmationProof'),
    legalAccepted: 'yes'
  });
  const completed = await request(
    adminSocket,
    'POST',
    '/auth/confirm',
    {
      Cookie: confirmationCookie,
      Origin: publicOrigin,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  );
  assert.equal(completed.status, 200);
  return pairingToken(completed.body);
}

async function reauthorize(pairing) {
  const response = await request(
    adminSocket,
    'POST',
    '/auth/reauthorize',
    {
      Authorization: `Bearer ${pairing}`,
      Origin: publicOrigin,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    form({ legalAccepted: 'yes' })
  );
  assert.equal(response.status, 200);
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.ok, true);
  const callback = await request(
    publicSocket,
    'GET',
    await callbackPath(parsed.value.authorizeUrl),
    { Cookie: cookie(response, '__Host-swp-oauth-v2') }
  );
  assert.equal(callback.status, 200);
  assert.match(callback.body, /REAUTHORIZED/);
}

async function playback(pairing, expectedStatus = 200) {
  const response = await request(publicSocket, 'GET', '/api/playback', {
    Authorization: `Bearer ${pairing}`,
    Origin: 'null'
  });
  assert.equal(response.status, expectedStatus);
  if (expectedStatus === 200) {
    const parsed = JSON.parse(response.body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.itemType, 'none');
  }
}

async function main() {
  const first = await initialAuthorization();
  const rescued = await missingCookieAuthorization();
  assert.notEqual(first, rescued);
  await reauthorize(first);
  await playback(first);

  const control = await request(
    publicSocket,
    'POST',
    '/api/control',
    {
      Authorization: `Bearer ${first}`,
      Origin: 'null',
      'Content-Type': 'application/json'
    },
    JSON.stringify({ type: 'pause' })
  );
  assert.equal(control.status, 200);

  const deleted = await request(publicSocket, 'DELETE', '/api/account', {
    Authorization: `Bearer ${first}`,
    Origin: publicOrigin
  });
  assert.equal(deleted.status, 200);
  await playback(first, 401);
  process.stdout.write('SYNTHETIC_E2E_PASS\n');
}

main().catch(() => {
  process.stdout.write('SYNTHETIC_E2E_FAIL\n');
  process.exitCode = 1;
});
