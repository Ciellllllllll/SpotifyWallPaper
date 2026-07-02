import {
  buildAuthorizeUrl,
  buildRedirectUri,
  exchangeCallbackForToken,
  sanitizeErrorMessage,
  storedClientId
} from './auth';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('App root is missing.');
}

const configuredClientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '';
const basePath = import.meta.env.BASE_URL;
const redirectUri = buildRedirectUri(window.location.origin, basePath);
let refreshTokenInMemory = '';

const isCallbackRoute = (): boolean => {
  const normalizedPath = window.location.pathname.replace(/\/$/, '');
  const normalizedBase = basePath.replace(/\/$/, '');
  return normalizedPath === `${normalizedBase}/callback` || normalizedPath.endsWith('/callback');
};

const clientIdFromUrl = (): string => {
  const queryClientId = new URL(window.location.href).searchParams.get('client_id');
  return queryClientId || storedClientId() || configuredClientId;
};

const renderHome = (): void => {
  const clientId = clientIdFromUrl();
  app.innerHTML = `
    <section class="shell">
      <div class="panel">
        <p class="eyebrow">Spotify Wallpaper</p>
        <h1>Spotify authorization</h1>
        <p class="lead">Authorize Spotify and copy the Refresh Token into Wallpaper Engine.</p>
        <label>
          <span>Spotify Client ID</span>
          <input id="client-id" value="${escapeHtml(clientId)}" autocomplete="off" spellcheck="false" />
        </label>
        <label>
          <span>Spotify Redirect URI</span>
          <input id="redirect-uri" value="${escapeHtml(redirectUri)}" readonly spellcheck="false" />
        </label>
        <button id="copy-redirect-uri" type="button">Copy Redirect URI</button>
        <button id="authorize" type="button">Authorize Spotify</button>
        <p id="status" class="status" role="status"></p>
      </div>
      <aside class="notice">
        <h2>Security notes</h2>
        <p>This page uses Spotify PKCE and does not use a Client Secret.</p>
        <p>Refresh Tokens are only shown in this browser tab. They are not stored in localStorage, cookies, GitHub, or any server.</p>
        <p>Do not share screenshots or recordings that show your token.</p>
      </aside>
    </section>
  `;

  document.querySelector<HTMLButtonElement>('#copy-redirect-uri')?.addEventListener('click', async () => {
    const status = document.querySelector<HTMLParagraphElement>('#status');
    try {
      await navigator.clipboard.writeText(redirectUri);
      setStatus(status, 'Redirect URI copied. Paste it into Spotify Dashboard exactly as shown.');
    } catch {
      setStatus(status, 'Clipboard was unavailable. Select the Redirect URI and copy it manually.');
    }
  });

  document.querySelector<HTMLButtonElement>('#authorize')?.addEventListener('click', async () => {
    const status = document.querySelector<HTMLParagraphElement>('#status');
    const input = document.querySelector<HTMLInputElement>('#client-id');
    const nextClientId = input?.value.trim() ?? '';
    if (!nextClientId) {
      setStatus(status, 'Client ID is required.');
      return;
    }

    try {
      setStatus(status, 'Opening Spotify authorization...');
      const authorizeUrl = await buildAuthorizeUrl({ clientId: nextClientId, redirectUri });
      window.location.assign(authorizeUrl);
    } catch {
      setStatus(status, 'Authorization URL could not be created.');
    }
  });
};

const renderCallback = async (): Promise<void> => {
  app.innerHTML = `
    <section class="shell single">
      <div class="panel">
        <p class="eyebrow">Spotify Wallpaper</p>
        <h1>Finishing authorization</h1>
        <p id="status" class="status" role="status">Exchanging authorization code...</p>
      </div>
    </section>
  `;
  const status = document.querySelector<HTMLParagraphElement>('#status');
  const clientId = clientIdFromUrl();
  if (!clientId) {
    setStatus(status, 'Client ID was not found. Start authorization again from the first page.');
    return;
  }

  const result = await exchangeCallbackForToken(window.location.href, clientId, redirectUri);
  window.history.replaceState({}, document.title, new URL(basePath, window.location.origin).toString());
  if (!result.ok) {
    refreshTokenInMemory = '';
    renderError(result.message);
    return;
  }

  refreshTokenInMemory = result.refreshToken;
  renderToken();
};

const renderToken = (): void => {
  app.innerHTML = `
    <section class="shell single">
      <div class="panel">
        <p class="eyebrow">Spotify Wallpaper</p>
        <h1>Refresh Token ready</h1>
        <p class="lead">Copy this token into Wallpaper Engine's <strong>Spotify Refresh Token</strong> property.</p>
        <label>
          <span>Refresh Token</span>
          <textarea id="refresh-token" readonly spellcheck="false"></textarea>
        </label>
        <button id="copy-token" type="button">Copy Refresh Token</button>
        <p id="status" class="status" role="status">The token will disappear if this page is reloaded.</p>
      </div>
    </section>
  `;

  const textarea = document.querySelector<HTMLTextAreaElement>('#refresh-token');
  if (textarea) {
    textarea.value = refreshTokenInMemory;
  }

  document.querySelector<HTMLButtonElement>('#copy-token')?.addEventListener('click', async () => {
    const status = document.querySelector<HTMLParagraphElement>('#status');
    try {
      await navigator.clipboard.writeText(refreshTokenInMemory);
      setStatus(status, 'Refresh Token copied. Paste it into Wallpaper Engine.');
    } catch {
      setStatus(status, 'Clipboard was unavailable. Select the token and copy it manually.');
    }
  });
};

const renderError = (message: string): void => {
  app.innerHTML = `
    <section class="shell single">
      <div class="panel">
        <p class="eyebrow">Spotify Wallpaper</p>
        <h1>Authorization failed</h1>
        <p class="status">${escapeHtml(sanitizeErrorMessage(message))}</p>
        <a class="button-link" href="${escapeHtml(new URL(basePath, window.location.origin).toString())}">Start again</a>
      </div>
    </section>
  `;
};

const setStatus = (element: HTMLElement | null, message: string): void => {
  if (element) {
    element.textContent = sanitizeErrorMessage(message);
  }
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

void (isCallbackRoute() ? renderCallback() : Promise.resolve(renderHome()));
