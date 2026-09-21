import { test, expect } from '@playwright/test';
const home = 'https://ciellllllllll.github.io/SpotifyWallPaper/spotify-auth/';

test('built Pages callback returns 200 and PKCE completes without persisting success data', async ({ page, request }) => {
  const response = await request.get('http://127.0.0.1:1431/SpotifyWallPaper/spotify-auth/callback/?code=dummy&state=dummy', { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  let called = 0;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(home).origin) {
      const local = await request.get('http://127.0.0.1:1431' + url.pathname);
      return route.fulfill({ response: local });
    }
    if (url.origin === 'https://accounts.spotify.com' && url.pathname === '/authorize') {
      expect(url.searchParams.get('redirect_uri')).toBe(home + 'callback/');
      expect(url.searchParams.get('client_id')).toBe('dummy-user-client');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      return route.fulfill({ contentType: 'text/html', body: `<a href="${home}callback/?code=dummy-code&amp;state=${url.searchParams.get('state')}">Mock Spotify consent</a>` });
    }
    if (url.origin === 'https://accounts.spotify.com' && url.pathname === '/api/token') {
      called++;
      expect(page.url()).toBe(home);
      const body = new URLSearchParams(route.request().postData()!);
      expect(body.get('redirect_uri')).toBe(home + 'callback/');
      expect(body.get('client_id')).toBe('dummy-user-client');
      expect(body.has('client_secret')).toBe(false);
      return route.fulfill({ json: { refresh_token: 'dummy-browser-refresh', expires_in: 3600 }, headers: { 'access-control-allow-origin': new URL(home).origin } });
    }
    return route.abort();
  });
  await page.goto(home + '?client_id=ignored');
  await expect(page.locator('#client-id')).toHaveValue('');
  await page.locator('#client-id').fill('dummy-user-client');
  await page.locator('#authorize').click();
  await page.getByText('Mock Spotify consent').click();
  await expect(page.locator('#wallpaper-token')).toHaveValue(/^swpt2\./);
  expect(called).toBe(1);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await page.locator('#clear-token').click();
  await expect(page.locator('#wallpaper-token')).toHaveCount(0);
});

test('invalid callback removes query immediately without making a token request', async ({ page, request }) => {
  let calls = 0;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(home).origin) return route.fulfill({ response: await request.get('http://127.0.0.1:1431' + url.pathname) });
    calls++; return route.abort();
  });
  await page.goto(home + 'callback/?code=dummy-code&state=wrong');
  await expect(page.getByRole('heading', { name: '認証できませんでした' })).toBeVisible();
  expect(page.url()).toBe(home);
  expect(calls).toBe(0);
});

test('denied browser storage shows a safe error without an unhandled exception', async ({ page, request }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('dummy denied', 'SecurityError'); } }));
  const errors: string[] = [];
  page.on('pageerror', () => errors.push('page-error'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(home).origin) return route.fulfill({ response: await request.get('http://127.0.0.1:1431' + url.pathname) });
    return route.abort();
  });
  await page.goto(home + 'callback/?code=dummy-code&state=dummy-state');
  await expect(page.getByRole('heading', { name: '認証できませんでした' })).toBeVisible();
  expect(page.url()).toBe(home);
  expect(errors).toEqual([]);
});
