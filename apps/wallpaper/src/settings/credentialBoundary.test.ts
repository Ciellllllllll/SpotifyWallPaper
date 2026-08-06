import { describe, expect, it } from 'vitest';
import {
  createProcessMemoryCredentialClosure,
  shouldClearCredentialForProviderChange,
  type CredentialInput
} from './credentialBoundary';

describe('process-memory credential closure', () => {
  it('keeps raw credential values out of the public status and enumerable object', () => {
    const credential: CredentialInput = {
      kind: 'direct',
      clientId: 'client-id',
      refreshToken: 'refresh-token'
    };
    const closure = createProcessMemoryCredentialClosure(credential);

    expect(closure.status()).toEqual({ kind: 'direct', present: true, revision: 1 });
    expect(JSON.stringify(closure)).not.toContain('refresh-token');
    expect(Object.keys(closure)).toEqual([]);
    expect(closure.read()).toEqual(credential);
  });

  it('rotates credentials in memory and increments revision only on effective changes', () => {
    const closure = createProcessMemoryCredentialClosure();
    expect(closure.status()).toEqual({ kind: 'none', present: false, revision: 0 });

    const backend: CredentialInput = { kind: 'backend', pairingToken: 'pairing-token' };
    expect(closure.replace(backend)).toEqual({ kind: 'backend', present: true, revision: 1 });
    expect(closure.replace(backend)).toEqual({ kind: 'backend', present: true, revision: 1 });
    expect(closure.clear()).toEqual({ kind: 'none', present: false, revision: 2 });
    expect(closure.clear()).toEqual({ kind: 'none', present: false, revision: 2 });
    expect(closure.read()).toBeNull();
  });

  it('clears credentials across provider changes instead of reusing them on a later return', () => {
    let kind: 'none' | 'direct' | 'backend' = 'direct';
    if (shouldClearCredentialForProviderChange('direct', 'backend', kind)) kind = 'none';
    expect(kind).toBe('none');
    if (shouldClearCredentialForProviderChange('backend', 'mock', kind)) kind = 'none';
    expect(kind).toBe('none');
    expect(shouldClearCredentialForProviderChange('mock', 'direct', kind)).toBe(true);
  });
});
