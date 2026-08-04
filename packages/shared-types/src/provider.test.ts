import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  isNormalizedPlaybackResultEnvelope,
  isPlaybackCommand,
  isProviderConfigurationError,
  isProviderResultEnvelope,
  isProviderSelection
} from './provider';
import type { ProviderSelection } from './provider';

const fixturesDir = fileURLToPath(new URL('../../../tests/contracts/provider-v1/', import.meta.url));
const fixtureNames = [
  'control-seek.json',
  'error-rate-limited.json',
  'error-unauthorized.json',
  'success-item-none.json',
  'success-playing.json',
  'transport-204.json'
].sort();
const forbiddenSecretPattern = /(clientId|clientSecret|refreshToken|pairingToken|hasRefreshToken|accessToken|authorizationCode|oauthState|pkceVerifier|secret)/i;

describe('provider-v1 JSON fixtures', () => {
  it('fixes the fixture inventory and keeps every fixture secret-free', () => {
    const files = readdirSync(fixturesDir).filter((file) => file.endsWith('.json')).sort();

    expect(files).toEqual(fixtureNames);
    for (const file of files) {
      expect(readFileSync(join(fixturesDir, file), 'utf8'), file).not.toMatch(forbiddenSecretPattern);
    }
  });

  it('accepts exact normalized playback and error envelopes', () => {
    for (const file of ['success-playing.json', 'success-item-none.json', 'error-unauthorized.json', 'error-rate-limited.json']) {
      const value: unknown = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
      expect(isProviderResultEnvelope(value), file).toBe(true);
      expect(isNormalizedPlaybackResultEnvelope(value), file).toBe(true);
    }
  });

  it('keeps transport and control contracts distinct from poll results', () => {
    const transport: unknown = JSON.parse(readFileSync(join(fixturesDir, 'transport-204.json'), 'utf8'));
    expect(transport).toEqual({ kind: 'transport', status: 204 });

    const control = JSON.parse(readFileSync(join(fixturesDir, 'control-seek.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(control).sort()).toEqual(['request', 'result']);
    expect(isPlaybackCommand(control.request)).toBe(true);
    expect(isProviderResultEnvelope(control.result)).toBe(true);
    expect(control.result).toEqual({ ok: true, value: null });
  });

  it('rejects extra envelope fields and malformed result values', () => {
    expect(isProviderResultEnvelope({ ok: true, value: {}, extra: true })).toBe(false);
    expect(isProviderResultEnvelope({ ok: true })).toBe(false);
    expect(isProviderResultEnvelope({ ok: false, error: { kind: 'unauthorized' } })).toBe(false);
    expect(isProviderResultEnvelope({ ok: false, error: { kind: 'unauthorized', message: 'x', retryAfterMs: -1 } })).toBe(false);
    expect(isProviderResultEnvelope({ ok: false, error: { kind: 'unauthorized', message: 'x', retryAfterMs: 0.5 } })).toBe(false);
    expect(isProviderResultEnvelope({ ok: false, error: { kind: 'unauthorized', message: 'x', status: 99 } })).toBe(false);
    expect(isProviderResultEnvelope({ ok: false, error: { kind: 'unauthorized', message: 'x', status: 200.5 } })).toBe(false);
    expect(isNormalizedPlaybackResultEnvelope({ ok: true, value: null })).toBe(false);
    expect(
      isNormalizedPlaybackResultEnvelope({
        ok: true,
        value: {
          source: 'spotify',
          itemType: 'none',
          id: null,
          uri: null,
          title: 'Nothing Playing',
          artists: [],
          albumName: '',
          imageUrls: [],
          albumImageUrl: '',
          durationMs: 0,
          progressMs: 0,
          isPlaying: false,
          device: null,
          deviceName: null,
          shuffleState: null,
          repeatState: null,
          volumePercent: null,
          externalUrl: null,
          fetchedAt: '2026-08-04T00:00:00.000Z',
          credential: 'unexpected'
        }
      })
    ).toBe(false);
    expect(isPlaybackCommand({ type: 'seek', positionMs: -1 })).toBe(false);
    expect(isPlaybackCommand({ type: 'seek', positionMs: 1000, extra: true })).toBe(false);
    expect(isProviderResultEnvelope(null)).toBe(false);
  });

  it('rejects unsafe playback numbers, invalid timestamps, and inconsistent items', () => {
    const source = JSON.parse(readFileSync(join(fixturesDir, 'success-playing.json'), 'utf8')) as {
      ok: true;
      value: Record<string, unknown>;
    };
    const durationMs = source.value.durationMs as number;
    const invalidValues = [
      { durationMs: -1 },
      { progressMs: durationMs + 1 },
      { volumePercent: 101 },
      { volumePercent: 0.5 },
      { fetchedAt: 'token-or-garbage' },
      { id: null },
      { itemType: 'none', id: null, uri: null, durationMs: 1, progressMs: 0 }
    ];

    for (const change of invalidValues) {
      expect(
        isNormalizedPlaybackResultEnvelope({ ok: true, value: { ...source.value, ...change } }),
        JSON.stringify(change)
      ).toBe(false);
    }
  });

  it('separates provider configuration errors from network result errors', () => {
    const invalid: ProviderSelection = {
      kind: 'invalid',
      error: {
        kind: 'configuration',
        code: 'missing-credentials',
        message: 'Provider credentials are not configured.'
      }
    };

    expect(isProviderConfigurationError(invalid.error)).toBe(true);
    expect(isProviderConfigurationError({ kind: 'unauthorized', message: 'Authorization is required.' })).toBe(false);
    const provider = {
      kind: 'mock',
      poll: async () => ({ ok: true, value: null }),
      control: async () => ({ ok: true, value: undefined }),
      dispose: () => undefined
    } as const;
    expect(isProviderSelection({ kind: 'mock', provider })).toBe(true);
    expect(isProviderSelection({ kind: 'ready', provider })).toBe(false);
    expect(isProviderSelection({ kind: 'mock', provider, credential: 'unexpected' })).toBe(false);

    class PrototypeMockProvider {
      readonly kind = 'mock' as const;
      poll = async () => ({ ok: true as const, value: null });
      control = async () => ({ ok: true as const, value: undefined });
      dispose(): void {}
    }
    expect(isProviderSelection({ kind: 'mock', provider: new PrototypeMockProvider() })).toBe(true);
  });
});
