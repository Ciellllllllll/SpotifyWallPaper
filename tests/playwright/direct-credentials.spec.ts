import { test, expect } from '@playwright/test';
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test('invalid settings still allow explicit disconnect from real IndexedDB', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { DirectCredentialStore, indexedCredentialDatabase } = await import('/src/spotify/credentialStore.ts');
    const { createWallpaperRuntime } = await import('/src/runtime/wallpaperRuntime.ts');
    const { defaultSettings } = await import('/src/settings/defaultSettings.ts');
    const { registerWallpaperPropertyListener } = await import('/src/wallpaperEngine/properties.ts');
    const store = new DirectCredentialStore(indexedCredentialDatabase(indexedDB));
    const input = { clientId: 'dummy-client', refreshToken: 'dummy-initial' };
    await store.import(input);
    let providerCalls = 0;
    const runtime = createWallpaperRuntime(defaultSettings, { credentialStore: store, selectProvider: () => {
      providerCalls++;
      return { kind: 'invalid', error: { kind: 'configuration', code: 'missing-credentials', message: 'dummy' } };
    } });
    let state: any;
    runtime.subscribe(value => { state = value; });
    const host = {} as Window;
    registerWallpaperPropertyListener(value => runtime.applyConfiguration(value.settings!, value.credential, value.safetyGateOpen, value.providerSelectionExplicit), host, () => state.settings.spotify.provider, () => state.settings);
    runtime.start();
    host.wallpaperPropertyListener!.applyUserProperties!({ settings_json: { value: '{invalid' } });
    const keptOnInvalidSettings = !!await store.read();
    providerCalls = 0;
    host.wallpaperPropertyListener!.applyUserProperties!({ spotify_refresh_token: { value: '' } });
    // Queue a read behind the runtime's queued disconnect, then wait on real IDB.
    for (let attempt = 0; attempt < 100 && await store.read(); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    const deleted = await store.read() === null;
    const replayRejected = await store.import(input) === null;
    host.wallpaperPropertyListener!.applyUserProperties!({ spotify_refresh_token: { value: 'swpt1.' + btoa(JSON.stringify({ v: 1, ...input })).replace(/=+$/, '') } });
    await new Promise(resolve => setTimeout(resolve, 20));
    const output = { keptOnInvalidSettings, deleted, replayRejected, providerCalls, credentialPresent: state.credentialStatus.present };
    runtime.dispose();
    return output;
  });
  expect(result).toEqual({ keptOnInvalidSettings: true, deleted: true, replayRejected: true, providerCalls: 0, credentialPresent: false });
});

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
