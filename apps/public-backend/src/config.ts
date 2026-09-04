import { posix } from 'node:path';
import {
  decodeBase64Url,
  parseSecretKeyring,
  type SecretKeyring
} from './crypto.js';

export type SpotifyMode = 'policy_locked' | 'synthetic_test';

interface BaseConfig {
  publicSocketPath: string;
  adminSocketPath: string;
}

export interface LockedConfig extends BaseConfig {
  mode: 'policy_locked';
}

export interface SyntheticConfig extends BaseConfig {
  mode: 'synthetic_test';
  publicBaseUrl: string;
  postgresSocketDirectory: string;
  postgresPort: 5433;
  postgresUser: 'swp_backend';
  oauthHmacKey: string;
  encryptionKeyring: SecretKeyring;
  encryptionActiveKeyId: string;
  pairingKeyring: SecretKeyring;
  pairingActiveKeyId: string;
  authorizeEndpoint: string;
  tokenEndpoint: string;
  playbackEndpoint: string;
  privacyVersion: string;
  eulaVersion: string;
}

export type AppConfig = LockedConfig | SyntheticConfig;

const productionPublicSocketPath = '/run/spotify-wallpaper/public/public.sock';
const productionAdminSocketPath = '/run/spotify-wallpaper/admin/admin.sock';
const productionSocketPaths = new Set([
  productionPublicSocketPath,
  productionAdminSocketPath
]);

export function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): AppConfig {
  const mode = environment.SPOTIFY_MODE;
  if (mode !== 'policy_locked' && mode !== 'synthetic_test') {
    throw new Error('SPOTIFY_MODE must be policy_locked or synthetic_test.');
  }
  const publicSocketPath = environment.PUBLIC_SOCKET_PATH;
  const adminSocketPath = environment.ADMIN_SOCKET_PATH;
  if (
    !absolutePath(publicSocketPath) ||
    !absolutePath(adminSocketPath) ||
    publicSocketPath === adminSocketPath
  ) {
    throw new Error('Two distinct absolute Unix socket paths are required.');
  }
  if (mode === 'policy_locked') {
    if (
      publicSocketPath !== productionPublicSocketPath ||
      adminSocketPath !== productionAdminSocketPath
    ) {
      throw new Error('Production socket paths are fixed.');
    }
    return { mode, publicSocketPath, adminSocketPath };
  }

  const required = [
    environment.PUBLIC_BASE_URL,
    environment.PG_SOCKET_DIR,
    environment.OAUTH_STATE_HMAC_KEY,
    environment.TOKEN_ENCRYPTION_KEYRING,
    environment.TOKEN_ENCRYPTION_ACTIVE_KEY_ID,
    environment.PAIRING_HMAC_KEYRING,
    environment.PAIRING_HMAC_ACTIVE_KEY_ID,
    environment.SYNTHETIC_AUTHORIZE_ENDPOINT,
    environment.SYNTHETIC_TOKEN_ENDPOINT,
    environment.SYNTHETIC_PLAYBACK_ENDPOINT,
    environment.PRIVACY_VERSION,
    environment.EULA_VERSION
  ];
  if (required.some((value) => value === undefined || value === '')) {
    throw new Error('Synthetic test configuration is incomplete.');
  }

  try {
    if (
      productionSocketPaths.has(posix.normalize(publicSocketPath)) ||
      productionSocketPaths.has(posix.normalize(adminSocketPath))
    ) {
      throw new Error();
    }
    const publicBaseUrl = originOnly(environment.PUBLIC_BASE_URL as string);
    const postgresSocketDirectory = environment.PG_SOCKET_DIR as string;
    if (!absolutePath(postgresSocketDirectory)) throw new Error();
    const oauthHmacKey = environment.OAUTH_STATE_HMAC_KEY as string;
    decodeBase64Url(oauthHmacKey, 32);
    const encryptionKeyring = parseSecretKeyring(
      environment.TOKEN_ENCRYPTION_KEYRING as string
    );
    const pairingKeyring = parseSecretKeyring(
      environment.PAIRING_HMAC_KEYRING as string
    );
    const encryptionActiveKeyId =
      environment.TOKEN_ENCRYPTION_ACTIVE_KEY_ID as string;
    const pairingActiveKeyId = environment.PAIRING_HMAC_ACTIVE_KEY_ID as string;
    if (
      !Object.hasOwn(encryptionKeyring, encryptionActiveKeyId) ||
      !Object.hasOwn(pairingKeyring, pairingActiveKeyId)
    ) {
      throw new Error();
    }
    const authorizeEndpoint = syntheticEndpoint(
      environment.SYNTHETIC_AUTHORIZE_ENDPOINT as string
    );
    const tokenEndpoint = syntheticEndpoint(
      environment.SYNTHETIC_TOKEN_ENDPOINT as string
    );
    const playbackEndpoint = syntheticEndpoint(
      environment.SYNTHETIC_PLAYBACK_ENDPOINT as string
    );
    const privacyVersion = legalVersion(environment.PRIVACY_VERSION as string);
    const eulaVersion = legalVersion(environment.EULA_VERSION as string);
    return {
      mode,
      publicSocketPath,
      adminSocketPath,
      publicBaseUrl,
      postgresSocketDirectory,
      postgresPort: 5433,
      postgresUser: 'swp_backend',
      oauthHmacKey,
      encryptionKeyring,
      encryptionActiveKeyId,
      pairingKeyring,
      pairingActiveKeyId,
      authorizeEndpoint,
      tokenEndpoint,
      playbackEndpoint,
      privacyVersion,
      eulaVersion
    };
  } catch {
    throw new Error('Synthetic test configuration is invalid.');
  }
}

function absolutePath(value: string | undefined): value is string {
  return (
    value !== undefined &&
    value.startsWith('/') &&
    value.length > 1 &&
    !value.endsWith('/') &&
    !value.includes('\0')
  );
}

function originOnly(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    value !== url.origin ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error();
  }
  return url.origin;
}

function syntheticEndpoint(value: string): string {
  const url = new URL(value);
  const hostname = url.hostname.replace(/\.+$/u, '');
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    hostname === 'accounts.spotify.com' ||
    hostname === 'api.spotify.com'
  ) {
    throw new Error();
  }
  return url.toString();
}

function legalVersion(value: string): string {
  if (!/^[0-9A-Za-z._-]{1,64}$/u.test(value)) throw new Error();
  return value;
}
