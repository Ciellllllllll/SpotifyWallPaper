import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DirectCredentialStore, type CredentialDatabase, type CredentialData } from './credentialStore';
import { DirectTokenSession } from './directTokenSession';
import { DirectPlaybackProvider } from './providers/directProvider';
import { createWallpaperRuntime } from '../runtime/wallpaperRuntime';
import { defaultSettings } from '../settings/defaultSettings';
import { parseWallpaperProperties, registerWallpaperPropertyListener } from '../wallpaperEngine/properties';

const initial = { clientId: 'dummy-client', refreshToken: 'dummy-initial', authorizationId: 'a'.repeat(32), authorizedAtMs: 1000 };
// A serial transaction double. Browser E2E covers the real IndexedDB boundary.
const database = (): CredentialDatabase => {
  let value: CredentialData = { version: 1, active: null, retired: [] };
  let queue = Promise.resolve();
  return { transaction: <T>(edit: (data: CredentialData) => T) => {
    const result = queue.then(() => {
      const draft = structuredClone(value);
      const output = edit(draft);
      value = draft;
      return structuredClone(output);
    });
    queue = result.then(() => undefined, () => undefined);
    return result;
  } };
};

describe('dedicated direct credential store', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });
  it('keeps mock mode during passive startup restoration', async () => {
    const store = new DirectCredentialStore(database());
    await store.import(initial);
    const runtime = createWallpaperRuntime(defaultSettings, { credentialStore: store });
    let state: any;
    runtime.subscribe(value => { state = value; });
    runtime.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(state.settings.spotify.provider).toBe('mock');
    expect(state.credentialStatus.present).toBe(false);
    expect(await store.read()).not.toBeNull();
    runtime.dispose();
  });

  it('recovers from a storage read failure before any refresh is sent', async () => {
    const db = database();
    let denied = false;
    const store = new DirectCredentialStore({ transaction: edit => denied ? Promise.reject(Error('dummy denied')) : db.transaction(edit) });
    const record = await store.import(initial);
    const fetcher = vi.fn(async () => Response.json({ access_token: 'dummy-access', expires_in: 3600 }));
    const session = new DirectTokenSession(store, record!.id, fetcher);
    denied = true;
    expect((await session.accessToken(0)).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    denied = false;
    expect((await session.accessToken(1)).ok).toBe(true);
  });
  it('adopts the committed account when stale host input overtakes a queued import', async () => {
    const store = new DirectCredentialStore(database());
    await store.import(initial);
    const runtime = createWallpaperRuntime({ ...defaultSettings, spotify: { ...defaultSettings.spotify, provider: 'direct' } }, { credentialStore: store, selectProvider: () => ({ kind: 'invalid', error: { kind: 'configuration', code: 'missing-credentials', message: 'dummy' } }) });
    let state: any;
    runtime.subscribe(value => { state = value; });
    runtime.start();
    await vi.waitFor(() => expect(state.credentialStatus.present).toBe(true));
    const oldRevision = state.credentialStatus.revision;
    runtime.applyConfiguration(state.settings, { kind: 'replace', value: { kind: 'direct', ...initial, authorizationId: 'b'.repeat(32) } }, true);
    runtime.applyConfiguration(state.settings, { kind: 'replace', value: { kind: 'direct', ...initial } }, true);
    await vi.waitFor(() => expect(state.credentialStatus.revision).toBeGreaterThan(oldRevision));
    expect((await store.read())?.authorizationId).toBe('b'.repeat(32));
    runtime.dispose();
  });
  it('does not replay a snapshotted token when only provider selection changes', () => {
    const target = {} as Window;
    const values: any[] = [];
    registerWallpaperPropertyListener(value => values.push(value), target);
    target.wallpaperPropertyListener!.applyUserProperties!({ spotify_refresh_token: { value: 'swpt1.' + btoa(JSON.stringify({ v: 1, clientId: 'dummy-client', refreshToken: 'dummy-refresh' })).replace(/=+$/, '') } });
    target.wallpaperPropertyListener!.applyUserProperties!({ spotify_playback_provider: { value: 'mock' } });
    expect(values.at(-1).patch.spotify.provider).toBe('mock');
    expect(values.at(-1).credential).toEqual({ kind: 'retain' });
    expect(parseWallpaperProperties({ spotify_client_id: { value: 'dummy-client' } }, 'direct').credential).toEqual({ kind: 'retain' });
  });
  it('erases credentials even at the retired-authorization limit, then blocks stale imports', async () => {
    const db = database();
    const store = new DirectCredentialStore(db);
    await store.import(initial);
    await db.transaction(data => { data.retired = Array.from({ length: 4096 }, (_, i) => i.toString(16).padStart(64, '0')); });
    await expect(store.import({ ...initial, authorizationId: 'c'.repeat(32) })).rejects.toThrow('Credential storage is unavailable.');
    await store.disconnect();
    expect(await store.read()).toBeNull();
    await expect(store.import(initial)).rejects.toThrow('Credential storage is unavailable.');
  });

  it('notifies invalidation only after current authorization is retired', async () => {
    const store = new DirectCredentialStore(database());
    const record = await store.import(initial);
    const invalidated = vi.fn();
    const session = new DirectTokenSession(store, record!.id, async () => Response.json({ error: 'invalid_grant' }, { status: 400 }), invalidated);
    expect((await session.accessToken(0)).ok).toBe(false);
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(await store.read()).toBeNull();
  });
  it('keeps durable authorization through mock selection and restores direct selection', async () => {
    const store = new DirectCredentialStore(database());
    await store.import(initial);
    const runtime = createWallpaperRuntime({ ...defaultSettings, spotify: { ...defaultSettings.spotify, provider: 'direct' } }, { credentialStore: store, selectProvider: () => ({ kind: 'invalid', error: { kind: 'configuration', code: 'missing-credentials', message: 'dummy' } }) });
    let state: any;
    runtime.subscribe(value => { state = value; });
    runtime.start();
    await vi.waitFor(() => expect(state.credentialStatus.present).toBe(true));
    for (const provider of ['mock', 'direct'] as const) {
      const parsed = parseWallpaperProperties({ spotify_playback_provider: { value: provider } });
      runtime.applyConfiguration({ ...state.settings, spotify: { ...state.settings.spotify, provider } }, parsed.credential, true);
      await vi.waitFor(() => expect(state.settings.spotify.provider).toBe(provider));
      expect(await store.read()).not.toBeNull();
    }
    await vi.waitFor(() => expect(state.credentialStatus.present).toBe(true));
    runtime.dispose();
  });
  it('saves a rotated token after sleep if no newer claimant exists', async () => {
    const store = new DirectCredentialStore(database());
    const record = await store.import(initial);
    const claim = await store.claim(record!.id, 0);
    if (claim.kind !== 'claimed') throw Error('setup');
    expect(await store.complete(claim.record, { ok: true, value: { accessToken: 'dummy-new', refreshToken: 'dummy-new-refresh', expiresAtMs: 3600000 } }, 120000)).toBe(true);
    expect((await store.read())?.refreshToken).toBe('dummy-new-refresh');
  });

  it('shares transient failure cooldown across independent sessions', async () => {
    const store = new DirectCredentialStore(database());
    const record = await store.import(initial);
    const fetcher = vi.fn(async () => new Response('', { status: 503 }));
    expect((await new DirectTokenSession(store, record!.id, fetcher).accessToken(0)).ok).toBe(false);
    expect((await new DirectTokenSession(store, record!.id, fetcher).accessToken(1)).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await store.read())?.refreshToken).toBe(initial.refreshToken);
  });

  it('forces refresh even when joining an unforced ready-token flight', async () => {
    const store = new DirectCredentialStore(database());
    const record = await store.import(initial);
    const fetcher = vi.fn(async () => Response.json({ access_token: 'dummy-access-' + fetcher.mock.calls.length, expires_in: 3600 }));
    const session = new DirectTokenSession(store, record!.id, fetcher);
    await session.accessToken(0);
    const unforced = session.accessToken(1);
    const forced = session.accessToken(1, 'dummy-access-1');
    await unforced;
    expect(await forced).toEqual({ ok: true, value: 'dummy-access-2' });
  });
  it('keeps the active runtime account if saving a new authorization fails', async () => {
    const db = database();
    let fail = false;
    const store = new DirectCredentialStore({ transaction: edit => fail ? Promise.reject(Error('dummy failure')) : db.transaction(edit) });
    await store.import(initial);
    const runtime = createWallpaperRuntime({ ...defaultSettings, spotify: { ...defaultSettings.spotify, provider: 'direct' } }, { credentialStore: store, selectProvider: () => ({ kind: 'invalid', error: { kind: 'configuration', code: 'missing-credentials', message: 'dummy' } }) });
    let state: any;
    runtime.subscribe(snapshot => { state = snapshot; });
    runtime.start();
    await vi.waitFor(() => expect(state.credentialStatus.present).toBe(true));
    fail = true;
    runtime.applyConfiguration(state.settings, { kind: 'replace', value: { kind: 'direct', ...initial, authorizationId: 'b'.repeat(32) } }, true);
    await vi.waitFor(() => expect(state.providerConfigurationError).toContain('保存'));
    expect(state.credentialStatus.present).toBe(true);
    runtime.dispose();
  });

  it('integrates host re-notification and restore without exposing tokens in runtime snapshots', async () => {
    const store = new DirectCredentialStore(database());
    const record = await store.import(initial);
    const lease = await store.claim(record!.id, 0);
    if (lease.kind !== 'claimed') throw Error('test lease setup');
    await store.complete(lease.record, { ok: true, value: { accessToken: 'dummy-access', refreshToken: 'dummy-rotated', expiresAtMs: 3600000 } });
    const selected: string[] = [];
    const runtime = createWallpaperRuntime({ ...defaultSettings, spotify: { ...defaultSettings.spotify, provider: 'direct' } }, { credentialStore: store, selectProvider: (_settings, credential) => {
      if (credential?.kind === 'direct') selected.push(credential.refreshToken);
      return { kind: 'invalid', error: { kind: 'configuration', code: 'missing-credentials', message: 'dummy test provider' } };
    } });
    let exposed = '';
    runtime.subscribe(snapshot => { exposed = JSON.stringify(snapshot); });
    runtime.start();
    runtime.applyConfiguration({ ...defaultSettings, spotify: { ...defaultSettings.spotify, provider: 'direct' } }, { kind: 'replace', value: { kind: 'direct', ...initial } }, true);
    await vi.waitFor(() => expect(selected).toContain('dummy-rotated'));
    expect(selected).not.toContain('dummy-initial');
    expect(exposed).not.toContain('dummy-rotated');
    runtime.dispose();
    expect((await store.read())?.refreshToken).toBe('dummy-rotated');
  });

  it('persists a refresh completed after provider disposal without issuing playback', async () => {
    const store = new DirectCredentialStore(database());
    const imported = await store.import(initial);
    let release!: (response: Response) => void;
    let began!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; });
    const fetcher = vi.fn(async () => { began(); return new Promise<Response>(resolve => { release = resolve; }); });
    const provider = new DirectPlaybackProvider(initial, fetcher, new DirectTokenSession(store, imported!.id, fetcher));
    const pending = provider.pollAt(0);
    await started;
    provider.dispose();
    release(Response.json({ access_token: 'dummy-access', refresh_token: 'dummy-rotated', expires_in: 3600 }));
    expect((await pending).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await store.import(initial))?.refreshToken).toBe('dummy-rotated');
  });

  it('refreshes through 1, 24 and 72 hours and restores after a restart', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1000);
      const db = database();
      const store = new DirectCredentialStore(db);
      const imported = await store.import(initial);
      const bodies: string[] = [];
      const fetcher: typeof fetch = async (_url, init) => {
        bodies.push(String(init?.body));
        return Response.json({ access_token: 'dummy-access-' + bodies.length, expires_in: 3600, refresh_token: 'dummy-rotation-' + bodies.length });
      };
      for (const hours of [0, 1, 24, 72]) {
        vi.setSystemTime(1000 + hours * 3600000);
        const restored = await new DirectCredentialStore(db).import(initial);
        expect(restored?.id).toBe(imported?.id);
        const session = new DirectTokenSession(store, imported!.id, fetcher);
        expect((await session.accessToken(Date.now())).ok).toBe(true);
      }
      expect(bodies).toHaveLength(4);
      expect(bodies[3]).toContain('dummy-rotation-3');
      expect((await store.read())?.authorizedAtMs).toBe(1000);
    } finally { vi.useRealTimers(); }
  });

  it('shares refresh and ignores delayed 401 for an older access token', async () => {
    const store = new DirectCredentialStore(database());
    const imported = await store.import(initial);
    const fetcher = vi.fn(async () => Response.json({ access_token: 'dummy-access-' + fetcher.mock.calls.length, expires_in: 3600 }));
    const session = new DirectTokenSession(store, imported!.id, fetcher);
    await Promise.all([session.accessToken(0), session.accessToken(0)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await session.accessToken(1, 'dummy-access-1');
    await session.accessToken(2, 'dummy-access-1');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('restores the rotated value across store instances and ignores initial re-notification', async () => {
    const db = database();
    const first = new DirectCredentialStore(db);
    const imported = await first.import(initial);
    const lease = await first.claim(imported!.id, 1000);
    expect(lease.kind).toBe('claimed');
    if (lease.kind !== 'claimed') return;
    await first.complete(lease.record, { ok: true, value: { accessToken: 'dummy-access', refreshToken: 'dummy-rotated', expiresAtMs: 3600000 } });
    const restored = await new DirectCredentialStore(db).import(initial);
    expect(restored?.refreshToken).toBe('dummy-rotated');
    expect(restored?.authorizedAtMs).toBe(1000);
  });

  it('atomically leases one refresh across independent contexts', async () => {
    const db = database();
    const a = new DirectCredentialStore(db);
    const b = new DirectCredentialStore(db);
    const record = await a.import(initial);
    const claims = await Promise.all([a.claim(record!.id, 0), b.claim(record!.id, 0)]);
    expect(claims.map(x => x.kind).sort()).toEqual(['busy', 'claimed']);
  });

  it('rejects old lease results after expiry and after switching accounts', async () => {
    const store = new DirectCredentialStore(database());
    const record = await store.import(initial);
    const old = await store.claim(record!.id, 0);
    const fresh = await store.claim(record!.id, 120000);
    if (old.kind !== 'claimed' || fresh.kind !== 'claimed') throw Error('test lease setup');
    expect(await store.complete(old.record, { ok: false, invalidGrant: true, error: { kind: 'unauthorized', message: 'dummy' } })).toBe(false);
    const next = await store.import({ ...initial, authorizationId: 'b'.repeat(32), refreshToken: 'dummy-other-account' });
    expect(await store.complete(fresh.record, { ok: true, value: { accessToken: 'dummy-late', refreshToken: 'dummy-late', expiresAtMs: 999999 } })).toBe(false);
    expect((await store.read())?.id).toBe(next?.id);
    expect(await store.import(initial)).toBeNull();
  });

  it.each(['disconnect', 'invalid_grant'])('does not resurrect an authorization after %s', async (operation) => {
    const db = database();
    const store = new DirectCredentialStore(db);
    const record = await store.import(initial);
    if (operation === 'disconnect') await store.disconnect();
    else {
      const lease = await store.claim(record!.id, 0);
      if (lease.kind !== 'claimed') throw Error('test lease setup');
      await store.complete(lease.record, { ok: false, invalidGrant: true, error: { kind: 'unauthorized', message: 'dummy' } });
    }
    expect(await new DirectCredentialStore(db).import(initial)).toBeNull();
    expect(await store.read()).toBeNull();
  });

  it('keeps current credentials when new input is invalid or storage fails', async () => {
    const db = database();
    const store = new DirectCredentialStore(db);
    await store.import(initial);
    await expect(store.import({ ...initial, refreshToken: '' })).rejects.toThrow('Credential input is invalid.');
    expect((await store.read())?.refreshToken).toBe(initial.refreshToken);
    const failing = new DirectCredentialStore({ transaction: async () => { throw Error('dummy storage failure'); } });
    await expect(failing.import(initial)).rejects.toThrow('Credential storage is unavailable.');
  });
});
