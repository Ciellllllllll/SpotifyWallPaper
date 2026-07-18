import { randomBase64Url } from './crypto';

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
};

export function setupPage(): Response {
  const nonce = randomBase64Url(16);
  return htmlResponse(
    200,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spotify Wallpaper Setup</title>
<style nonce="${nonce}">
body{font-family:system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1rem;color:#171717}
form{display:grid;gap:.75rem;margin:2rem 0}
input,button{font:inherit;padding:.7rem}
button{cursor:pointer}
#reauthorize-status{min-height:1.5rem}
</style>
</head>
<body>
<main>
<h1>Spotify Wallpaper Setup</h1>
<form action="/auth/start" method="post">
<label for="spotify-client-id">Spotify Client ID</label>
<input id="spotify-client-id" name="spotifyClientId" autocomplete="off" required>
<button type="submit">Authorize Spotify</button>
</form>
<form id="reauthorize-form">
<label for="pairing-token">Existing Pairing Token</label>
<input id="pairing-token" type="password" autocomplete="off" required>
<button type="submit">Reauthorize Spotify</button>
</form>
<form id="delete-account-form">
<label for="delete-pairing-token">Pairing Token to delete</label>
<input id="delete-pairing-token" type="password" autocomplete="off" required>
<button type="submit">Delete backend account</button>
</form>
<p id="reauthorize-status" aria-live="polite"></p>
</main>
<script nonce="${nonce}">
document.getElementById('reauthorize-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('pairing-token');
  let token = input.value;
  input.value = '';
  try {
    const response = await fetch('/auth/reauthorize', {
      method: 'POST',
      headers: { Authorization: \`Bearer \${token}\` },
      credentials: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    });
    token = '';
    if (!response.ok) throw new Error();
    const body = await response.json();
    if (!body.ok || typeof body.value?.authorizeUrl !== 'string') throw new Error();
    location.assign(body.value.authorizeUrl);
  } catch {
    token = '';
    document.getElementById('reauthorize-status').textContent = 'Reauthorization could not start.';
  }
});
document.getElementById('delete-account-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('delete-pairing-token');
  let token = input.value;
  input.value = '';
  try {
    const response = await fetch('/api/account', {
      method: 'DELETE',
      headers: { Authorization: \`Bearer \${token}\` },
      credentials: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    });
    token = '';
    if (!response.ok) throw new Error();
    document.getElementById('reauthorize-status').textContent = 'Backend account deleted.';
  } catch {
    token = '';
    document.getElementById('reauthorize-status').textContent = 'Backend account could not be deleted.';
  }
});
</script>
</body>
</html>`,
    nonce,
    true
  );
}

export function callbackPage(
  status: number,
  outcome: 'authorized' | 'error' | 'reauthorized',
  pairingToken?: string
): Response {
  const nonce = randomBase64Url(16);
  const content =
    outcome === 'authorized' && pairingToken !== undefined
      ? `<h1>Spotify authorized</h1><p>Use this Pairing Token in Wallpaper Engine:</p><pre>${escapeHtml(pairingToken)}</pre>`
      : outcome === 'reauthorized'
        ? '<h1>Spotify reauthorized</h1><p>You can return to Wallpaper Engine.</p>'
        : '<h1>Authorization failed</h1><p>Return to setup and try again.</p>';

  return htmlResponse(
    status,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spotify Wallpaper Authorization</title>
<script nonce="${nonce}">history.replaceState({}, '', '/setup/complete')</script>
<style nonce="${nonce}">body{font-family:system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1rem;color:#171717}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:1rem;background:#f3f4f6}</style>
</head>
<body><main>${content}</main></body>
</html>`,
    nonce,
    false,
    {
      'Set-Cookie':
        'swpb_oauth=; Path=/auth/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax'
    }
  );
}

export function fixedError(status: number, message: string): Response {
  return Response.json(
    {
      ok: false,
      error: {
        kind: status === 401 || status === 403 ? 'unauthorized' : 'unavailable',
        message,
        status
      }
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff'
      }
    }
  );
}

function htmlResponse(
  status: number,
  body: string,
  nonce: string,
  allowSameOriginConnect: boolean,
  additionalHeaders: Record<string, string> = {}
): Response {
  return new Response(body, {
    status,
    headers: {
      ...securityHeaders,
      ...additionalHeaders,
      'Content-Security-Policy':
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; ` +
        `base-uri 'none'; form-action 'self'; frame-ancestors 'none'` +
        (allowSameOriginConnect ? "; connect-src 'self'" : ''),
      'Content-Type': 'text/html; charset=utf-8'
    }
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
