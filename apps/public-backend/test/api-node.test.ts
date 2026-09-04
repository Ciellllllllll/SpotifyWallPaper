import { describe, expect, it, vi } from 'vitest';
import {
  createApiHandlers,
  type ApiDependencies
} from '../src/api.js';
import { createCredentialLock } from '../src/credential-lock.js';
import type { Credential } from '../src/db.js';

const origin = 'https://ciel-spotify-wallpaper.duckdns.org';
const publicId = 'AAAAAAAAAAAAAAAAAAAAAA';
const pairingToken =
  'swpb1.' + publicId + '.' + 'A'.repeat(43);
const credential = {
  publicId,
  authStatus: 'active'
} as Credential;

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers({
    Origin: 'null',
    Authorization: 'Bearer ' + pairingToken,
    'X-SWP-Client-IP': '192.0.2.1'
  });
  for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
  return new Request(origin + path, {
    ...init,
    headers
  });
}

function dependencies(
  overrides: Partial<ApiDependencies> = {}
): ApiDependencies {
  return {
    oauthHmacKey: 'ggggggggggggggggggggggggggggggggggggggggggg',
    publicBaseUrl: origin,
    now: () => 1_700_000_000_000,
    credentialLock: createCredentialLock(),
    isDeletionTombstoned: vi.fn(async () => false),
    findCredential: vi.fn(async () => credential),
    fetchPlayback: vi.fn(async () => ({
      ok: true,
      value: {
        source: 'spotify',
        itemType: 'none',
        id: null,
        title: '',
        artists: [],
        album: '',
        albumImageUrl: null,
        durationMs: 0,
        progressMs: 0,
        isPlaying: false,
        shuffle: false,
        repeatMode: 'off',
        device: null,
        fetchedAt: '2026-08-31T00:00:00.000Z'
      }
    })),
    sendCommand: vi.fn(async () => ({ ok: true, value: null })),
    deleteCredential: vi.fn(async () => undefined),
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('Node API handlers', () => {
  it('answers CORS preflight without authentication, database, or limits', async () => {
    const findCredential = vi.fn(async () => credential);
    const handlers = createApiHandlers(dependencies({ findCredential }));
    const response = await handlers.playbackOptions(
      request('/api/playback', {
        method: 'OPTIONS',
        headers: {
          Origin: 'null',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization'
        }
      })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null');
    expect(findCredential).not.toHaveBeenCalled();
  });

  it('rejects an extra preflight header and arbitrary wallpaper origin', async () => {
    const findCredential = vi.fn(async () => credential);
    const handlers = createApiHandlers(dependencies({ findCredential }));
    const preflight = await handlers.controlOptions(
      request('/api/control', {
        method: 'OPTIONS',
        headers: {
          Origin: 'null',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, x-extra'
        }
      })
    );
    const emptyHeader = await handlers.controlOptions(
      request('/api/control', {
        method: 'OPTIONS',
        headers: {
          Origin: 'null',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,,'
        }
      })
    );
    const playback = await handlers.playback(
      request('/api/playback', {
        headers: { Origin: 'https://attacker.invalid' }
      })
    );

    expect(preflight.status).toBe(403);
    expect(emptyHeader.status).toBe(403);
    expect(playback.status).toBe(403);
    expect(findCredential).not.toHaveBeenCalled();
  });

  it('authenticates playback by Pairing ID and returns only normalized data', async () => {
    const fetchPlayback = vi.fn(async () => dependencies().fetchPlayback(credential));
    const handlers = createApiHandlers(dependencies({ fetchPlayback }));
    const response = await handlers.playback(request('/api/playback'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null');
    expect(await response.json()).toMatchObject({
      ok: true,
      value: { source: 'spotify', itemType: 'none' }
    });
    expect(fetchPlayback).toHaveBeenCalledWith(credential);
  });

  it('requires exact same origin and deletes ledger-first through one dependency', async () => {
    const deleteCredential = vi.fn(async () => undefined);
    const handlers = createApiHandlers(dependencies({ deleteCredential }));
    const rejected = await handlers.account(request('/api/account', { method: 'DELETE' }));
    const accepted = await handlers.account(
      request('/api/account', {
        method: 'DELETE',
        headers: { Origin: origin }
      })
    );

    expect(rejected.status).toBe(403);
    expect(accepted.status).toBe(200);
    expect(deleteCredential).toHaveBeenCalledWith(
      publicId,
      1_700_000_000_000
    );
  });

  it('does not call Spotify after account deletion has completed', async () => {
    let tombstoned = false;
    let lookupCount = 0;
    const firstLookupStarted = deferred<void>();
    const firstLookup = deferred<Credential | null>();
    const deletionStarted = deferred<void>();
    const finishDeletion = deferred<void>();
    const fetchPlayback = vi.fn(async () => dependencies().fetchPlayback(credential));
    const handlers = createApiHandlers(
      dependencies({
        isDeletionTombstoned: vi.fn(async () => tombstoned),
        findCredential: vi.fn(async () => {
          lookupCount += 1;
          if (lookupCount === 1) {
            firstLookupStarted.resolve();
            return firstLookup.promise;
          }
          return credential;
        }),
        fetchPlayback,
        deleteCredential: vi.fn(async () => {
          tombstoned = true;
          deletionStarted.resolve();
          await finishDeletion.promise;
        })
      })
    );

    const playback = handlers.playback(request('/api/playback'));
    await firstLookupStarted.promise;
    const deletion = handlers.account(
      request('/api/account', {
        method: 'DELETE',
        headers: { Origin: origin }
      })
    );
    await deletionStarted.promise;
    firstLookup.resolve(credential);
    finishDeletion.resolve();

    expect((await deletion).status).toBe(200);
    expect((await playback).status).toBe(401);
    expect(fetchPlayback).not.toHaveBeenCalled();
  });

  it('does not report account deletion complete while a Spotify call is active', async () => {
    const fetchStarted = deferred<void>();
    const finishFetch = deferred<void>();
    const order: string[] = [];
    const deleteCredential = vi.fn(async () => {
      order.push('delete');
    });
    const handlers = createApiHandlers(
      dependencies({
        fetchPlayback: vi.fn(async () => {
          fetchStarted.resolve();
          await finishFetch.promise;
          order.push('fetch');
          return dependencies().fetchPlayback(credential);
        }),
        deleteCredential
      })
    );

    const playback = handlers.playback(request('/api/playback'));
    await fetchStarted.promise;
    const deletion = handlers.account(
      request('/api/account', {
        method: 'DELETE',
        headers: { Origin: origin }
      })
    );
    await Promise.resolve();
    expect(deleteCredential).not.toHaveBeenCalled();

    finishFetch.resolve();
    expect((await playback).status).toBe(200);
    expect((await deletion).status).toBe(200);
    expect(order).toEqual(['fetch', 'delete']);
  });

  it('accepts only a bounded shared playback command schema', async () => {
    const sendCommand = vi.fn(async () => ({ ok: true as const, value: null }));
    const handlers = createApiHandlers(dependencies({ sendCommand }));
    const valid = await handlers.control(
      request('/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'volume', volumePercent: 50 })
      })
    );
    const invalid = await handlers.control(
      request('/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'volume', volumePercent: 101 })
      })
    );

    expect(valid.status).toBe(200);
    expect(invalid.status).toBe(400);
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });
});
