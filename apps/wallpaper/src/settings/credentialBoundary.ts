import type { PlaybackProviderKind } from '@spotify-wallpaper/shared-types';

export type CredentialInput =
  | { kind: 'direct'; clientId: string; refreshToken: string }
  | { kind: 'backend'; pairingToken: string };

export interface CredentialStatus {
  kind: 'none' | 'direct' | 'backend';
  present: boolean;
  revision: number;
}

export interface ProcessMemoryCredentialClosure {
  status(): CredentialStatus;
  read(): CredentialInput | null;
  replace(next: CredentialInput): CredentialStatus;
  clear(): CredentialStatus;
}

export const credentialKindMatchesProvider = (
  provider: PlaybackProviderKind,
  credentialKind: CredentialStatus['kind']
): boolean =>
  (provider === 'direct' && credentialKind === 'direct') ||
  (provider === 'backend' && credentialKind === 'backend');

export const shouldClearCredentialForProviderChange = (
  previousProvider: PlaybackProviderKind,
  nextProvider: PlaybackProviderKind,
  credentialKind: CredentialStatus['kind']
): boolean =>
  previousProvider !== nextProvider &&
  (nextProvider === 'mock' || !credentialKindMatchesProvider(nextProvider, credentialKind));

export const createProcessMemoryCredentialClosure = (
  initial: CredentialInput | null = null
): ProcessMemoryCredentialClosure => {
  let current = cloneCredential(initial);
  let revision = current ? 1 : 0;

  const status = (): CredentialStatus => ({
    kind: current?.kind ?? 'none',
    present: current !== null,
    revision
  });

  const replace = (next: CredentialInput): CredentialStatus => {
    if (!sameCredential(current, next)) {
      current = cloneCredential(next);
      revision += 1;
    }
    return status();
  };

  const clear = (): CredentialStatus => {
    if (current !== null) {
      current = null;
      revision += 1;
    }
    return status();
  };

  const closure = {} as ProcessMemoryCredentialClosure;
  Object.defineProperties(closure, {
    status: { value: status, enumerable: false },
    read: {
      value: () => cloneCredential(current),
      enumerable: false
    },
    replace: { value: replace, enumerable: false },
    clear: { value: clear, enumerable: false }
  });
  return Object.freeze(closure);
};

const cloneCredential = (credential: CredentialInput | null): CredentialInput | null =>
  credential === null
    ? null
    : credential.kind === 'direct'
      ? { kind: 'direct', clientId: credential.clientId, refreshToken: credential.refreshToken }
      : { kind: 'backend', pairingToken: credential.pairingToken };

const sameCredential = (left: CredentialInput | null, right: CredentialInput): boolean =>
  left !== null &&
  left.kind === right.kind &&
  (right.kind === 'direct'
    ? left.kind === 'direct' && left.clientId === right.clientId && left.refreshToken === right.refreshToken
    : left.kind === 'backend' && left.pairingToken === right.pairingToken);
