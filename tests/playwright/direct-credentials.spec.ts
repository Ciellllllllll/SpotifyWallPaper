import { test, expect } from '@playwright/test';
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test('real IndexedDB serializes two pages and preserves rotation after reload', async ({ page, context }) => {
  await page.goto('/');
  const other = await context.newPage();
  await other.goto('/');
  for (const tab of [page, other]) await tab.evaluate(async () => {
    const module = await import('/src/spotify/credentialStore.ts');
    const store = new module.DirectCredentialStore(module.indexedCredentialDatabase(indexedDB));
    const input = { clientId: 'dummy-client', refreshToken: 'dummy-initial', authorizationId: 'a'.repeat(32), authorizedAtMs: 1000 };
    const record = await store.import(input);
    Object.assign(window, { testStore: store, testRecord: record, testInput: input });
  });
  const results = await Promise.all([page, other].map(tab => tab.evaluate(async () => {
    const w = window as any;
    const claim = await w.testStore.claim(w.testRecord.id, Date.now());
    w.testClaim = claim;
    return claim.kind;
  })));
  expect(results.sort()).toEqual(['busy', 'claimed']);
  for (const tab of [page, other]) await tab.evaluate(async () => {
    const w = window as any;
    if (w.testClaim.kind === 'claimed') await w.testStore.complete(w.testClaim.record, { ok: true, value: { accessToken: 'dummy-access', refreshToken: 'dummy-rotated', expiresAtMs: 3600000 } });
  });
  await page.reload();
  const restored = await page.evaluate(async () => {
    const module = await import('/src/spotify/credentialStore.ts');
    const store = new module.DirectCredentialStore(module.indexedCredentialDatabase(indexedDB));
    const input = { clientId: 'dummy-client', refreshToken: 'dummy-initial', authorizationId: 'a'.repeat(32), authorizedAtMs: 1000 };
    const record = await store.import(input);
    const rotated = record?.refreshToken === 'dummy-rotated';
    await store.disconnect();
    return { rotated, resurrected: await store.import(input) !== null };
  });
  expect(restored).toEqual({ rotated: true, resurrected: false });
});

test('host properties activate persistence without an audio API and reject denied storage safely', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('dummy denied', 'SecurityError'); } });
  });
  const errors: string[] = [];
  page.on('pageerror', () => errors.push('page-error'));
  await page.goto('/');
  await page.waitForFunction(() => !!window.wallpaperPropertyListener?.applyUserProperties);
  await page.evaluate(() => window.wallpaperPropertyListener!.applyUserProperties!({ debug_enabled: { value: true }, spotify_refresh_token: { value: 'swpt1.' + btoa(JSON.stringify({ v: 1, clientId: 'dummy-client', refreshToken: 'dummy-refresh' })).replace(/=+$/, '') } }));
  await expect(page.getByRole('status').filter({ hasText: '保存' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
