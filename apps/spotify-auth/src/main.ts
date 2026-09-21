import { buildAuthorizeUrl, buildRedirectUri, encodeWallpaperEngineToken, exchangeCallbackForToken, storedClientId } from './auth';
import pages from '../pages-config.json';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const basePath = pages.base;
// Production redirects never depend on arbitrary host/query parameters.
const origin = import.meta.env.DEV ? 'http://127.0.0.1:1430' : pages.origin;
const redirectUri = buildRedirectUri(origin, basePath);
let tokenInMemory = '';

const escapeHtml = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const status = (message: string) => { const node = document.querySelector('#status'); if (node) node.textContent = message; };
const copy = async (value: string, input: HTMLInputElement | HTMLTextAreaElement | null) => {
  try { await navigator.clipboard.writeText(value); status('コピーしました。貼り付け先を確認してください。'); }
  catch { input?.select(); status('コピーできませんでした。選択された文字列を手動でコピーしてください。'); }
};

function renderHome(): void {
  tokenInMemory = '';
  app.innerHTML = `<section class="shell"><div class="panel">
    <p class="eyebrow">Spotify Wallpaper</p><h1>Spotifyに接続</h1>
    <p class="lead">Spotify Developer Dashboardで自分のアプリを作成し、下記のRedirect URIを登録してください。初回と再認証時だけ、このページを使います。</p>
    <label>自分のSpotify Client ID<input id="client-id" autocomplete="off" spellcheck="false" value="${escapeHtml(import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '')}" /></label>
    <label>登録するRedirect URI<input id="redirect-uri" readonly spellcheck="false" value="${escapeHtml(redirectUri)}" /></label>
    <button id="copy-redirect-uri" type="button">Redirect URIをコピー</button>
    <button id="authorize" type="button">Spotifyで認証する</button><p id="status" role="status"></p>
    <p>以前の末尾スラッシュなしのURIは使えません。登録を更新してから認証をやり直してください。</p>
    </div><aside class="notice"><h2>認証情報の扱い</h2>
    <p>Client Secretは不要です。パスワードはSpotify公式画面でのみ入力してください。</p>
    <p>生成データはRefresh Tokenを含む機密情報です。Base64urlは暗号化ではありません。旧swpb1. Pairing Tokenとは異なります。</p>
    <p>このページの成功結果はタブのメモリだけに保持します。認可コードを含む最初のcallback要求はGitHub Pagesを通ります。コードはPKCEと短期・一回性で保護されます。</p>
    <p>壁紙では専用保存領域へ保存します。画面撮影・共有を避け、コピー後は表示を消してください。クリップボード履歴は自分で管理してください。</p>
    <p>Development Modeの利用制限が適用されます。運営インフラが不要でも、SpotifyやWallpaper Engineの費用・利用条件は別です。</p>
    </aside></section>`;
  document.querySelector('#copy-redirect-uri')?.addEventListener('click', () => void copy(redirectUri, document.querySelector('#redirect-uri')));
  document.querySelector<HTMLButtonElement>('#authorize')?.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    const clientId = document.querySelector<HTMLInputElement>('#client-id')!.value.trim();
    if (!clientId) { status('自分のClient IDを入力してください。'); return; }
    button.disabled = true;
    try {
      status('Spotify公式の認証画面へ移動します。');
      location.assign(await buildAuthorizeUrl({ clientId, redirectUri }));
    } catch { button.disabled = false; status('認可を開始できません。一時保存の許可とClient IDを確認してください。'); }
  });
}

async function renderCallback(): Promise<void> {
  // Remove secrets before any storage access, DOM rendering, or network wait.
  const callback = location.href;
  history.replaceState({}, document.title, basePath);
  app.innerHTML = '<section class="shell single"><div class="panel"><h1>認証を確認しています</h1><p id="status" role="status">Spotifyと通信中です。</p></div></section>';
  let clientId = '';
  try { clientId = storedClientId(); } catch { /* exchange returns a fixed storage error */ }
  const result = await exchangeCallbackForToken(callback, clientId, redirectUri);
  if (!result.ok) {
    app.innerHTML = `<section class="shell single"><div class="panel"><h1>認証できませんでした</h1><p role="status">${escapeHtml(result.message)}</p><a href="${basePath}">最初から認証する</a></div></section>`;
    return;
  }
  tokenInMemory = encodeWallpaperEngineToken({ clientId: result.clientId, refreshToken: result.refreshToken });
  app.innerHTML = `<section class="shell single"><div class="panel"><h1>認証用データを取り込む</h1>
    <p>Wallpaper Engineの「Spotify Token」欄に貼り付けてください。通常の更新は壁紙が行います。</p>
    <label>機密の認証用データ<textarea id="wallpaper-token" readonly spellcheck="false" autocomplete="off"></textarea></label>
    <button id="copy-token" type="button">認証用データをコピー</button><button id="clear-token" type="button">表示を消して終了</button>
    <p id="status" role="status">このタブを再読み込みしても復元できません。クリップボード履歴は消去されません。</p></div></section>`;
  document.querySelector<HTMLTextAreaElement>('#wallpaper-token')!.value = tokenInMemory;
  document.querySelector('#copy-token')?.addEventListener('click', () => void copy(tokenInMemory, document.querySelector('#wallpaper-token')));
  document.querySelector('#clear-token')?.addEventListener('click', renderHome);
}

if (location.pathname === `${basePath}callback/` || location.pathname === `${basePath}callback`) void renderCallback();
else {
  // Never accept client/redirect overrides through a URL, and discard unexpected queries.
  if (location.search || location.hash) history.replaceState({}, document.title, basePath);
  renderHome();
}
