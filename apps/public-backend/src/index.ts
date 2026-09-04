import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApiHandlers, type ApiDependencies } from './api.js';
import { createAuthHandlers, type AuthStore } from './auth.js';
import { loadConfig, type SyntheticConfig } from './config.js';
import { createCredentialLock } from './credential-lock.js';
import {
  consumeCallbackConfirmation,
  consumeOAuthSession,
  consumeSetupSession,
  createCredential,
  createDatabasePools,
  createSetupSession,
  deleteCredentialWithTombstone,
  findActiveCredentialByPairingToken,
  findCallbackConfirmation,
  findCredentialByPairingToken,
  insertOAuthSession,
  isDeletionTombstoned,
  moveOAuthSessionToConfirmation,
  reauthorizeCredential,
  type DatabasePools
} from './db.js';
import { createRouter, type RouteHandler, type RouteId } from './router.js';
import {
  fetchCredentialPlayback,
  sendCredentialSpotifyCommand,
  type SpotifyDependencies
} from './spotify.js';
import { createMetrics, type Metrics } from './metrics.js';
import {
  startServers,
  type RunningServers,
  type StartServersOptions
} from './server.js';

type Environment = Readonly<Record<string, string | undefined>>;
type StartBackend = (options: StartServersOptions) => Promise<RunningServers>;

interface BackendDependencies {
  start?: StartBackend;
  createPools?: typeof createDatabasePools;
  waitForShutdown?: () => Promise<void>;
}

export async function runBackend(
  environment: Environment = process.env,
  {
    start = startServers,
    createPools = createDatabasePools,
    waitForShutdown = waitForProcessShutdown
  }: BackendDependencies = {}
): Promise<void> {
  const config = loadConfig(environment);
  const metrics = createMetrics();
  let pools: DatabasePools | null = null;
  let running: RunningServers | null = null;
  try {
    let handlers: Partial<Record<RouteId, RouteHandler>> = {};
    if (config.mode === 'synthetic_test') {
      const synthetic = await syntheticHandlers(config, createPools, metrics);
      pools = synthetic.pools;
      handlers = synthetic.handlers;
    }
    running = await start({
      publicSocketPath: config.publicSocketPath,
      adminSocketPath: config.adminSocketPath,
      ...(config.mode === 'synthetic_test'
        ? { requestBaseUrl: config.publicBaseUrl }
        : {}),
      recordRequest: metrics.recordRequest,
      router: createRouter({ mode: config.mode, handlers })
    });
    await waitForShutdown();
  } finally {
    metrics.stop();
    await running?.close();
    await Promise.all([pools?.primary.end?.(), pools?.deletion.end?.()]);
    metrics.flush();
  }
}

async function syntheticHandlers(
  config: SyntheticConfig,
  createPools: typeof createDatabasePools,
  metrics: Metrics
): Promise<{
  pools: DatabasePools;
  handlers: Partial<Record<RouteId, RouteHandler>>;
}> {
  const poolConfig = {
    host: config.postgresSocketDirectory,
    port: config.postgresPort,
    user: config.postgresUser
  };
  const pools = await createPools({
    primary: { ...poolConfig, database: 'spotify_wallpaper' },
    deletion: {
      ...poolConfig,
      database: 'spotify_wallpaper_deletion_ledger'
    }
  });
  const spotify: SpotifyDependencies = {
    encryptionKeyring: config.encryptionKeyring,
    encryptionActiveKeyId: config.encryptionActiveKeyId,
    playbackEndpoint: config.playbackEndpoint,
    tokenEndpoint: config.tokenEndpoint,
    recordRefresh: metrics.recordRefresh
  };
  const credentialLock = createCredentialLock();
  const authStore: AuthStore = {
    createSetupSession: (input) => createSetupSession(pools.primary, input),
    consumeSetupSession: (...args) => consumeSetupSession(pools.primary, ...args),
    insertOAuthSession: (input) => insertOAuthSession(pools.primary, input),
    consumeOAuthSession: (...args) => consumeOAuthSession(pools.primary, ...args),
    moveOAuthSessionToConfirmation: (input, encryptSecrets) =>
      moveOAuthSessionToConfirmation(pools.primary, input, encryptSecrets),
    findCallbackConfirmation: (...args) =>
      findCallbackConfirmation(pools.primary, ...args),
    consumeCallbackConfirmation: (...args) =>
      consumeCallbackConfirmation(pools.primary, ...args),
    isDeletionTombstoned: (publicId) =>
      isDeletionTombstoned(pools.deletion, publicId),
    findCredentialByPairingToken: (token, keyring) =>
      findCredentialByPairingToken(pools.primary, token, keyring),
    createCredential: (input) => createCredential(pools.primary, input),
    reauthorizeCredential: (input) =>
      reauthorizeCredential(pools.primary, input)
  };
  const auth = createAuthHandlers({
    store: authStore,
    oauthHmacKey: config.oauthHmacKey,
    encryptionKeyring: config.encryptionKeyring,
    encryptionActiveKeyId: config.encryptionActiveKeyId,
    pairingKeyring: config.pairingKeyring,
    pairingActiveKeyId: config.pairingActiveKeyId,
    publicBaseUrl: config.publicBaseUrl,
    authorizeEndpoint: config.authorizeEndpoint,
    tokenEndpoint: config.tokenEndpoint,
    fetch,
    credentialLock,
    now: Date.now,
    privacyVersion: config.privacyVersion,
    eulaVersion: config.eulaVersion
  });
  const apiDependencies: ApiDependencies = {
    oauthHmacKey: config.oauthHmacKey,
    publicBaseUrl: config.publicBaseUrl,
    now: Date.now,
    credentialLock,
    isDeletionTombstoned: (publicId) =>
      isDeletionTombstoned(pools.deletion, publicId),
    findCredential: (token, requireActive) =>
      requireActive
        ? findActiveCredentialByPairingToken(
            pools.primary,
            token,
            config.pairingKeyring
          )
        : findCredentialByPairingToken(
            pools.primary,
            token,
            config.pairingKeyring
          ),
    fetchPlayback: (credential) =>
      fetchCredentialPlayback(pools.primary, credential, spotify),
    sendCommand: (credential, command) =>
      sendCredentialSpotifyCommand(
        pools.primary,
        credential,
        spotify,
        command
      ),
    deleteCredential: (publicId, deletedAtMs) =>
      deleteCredentialWithTombstone(pools.primary, pools.deletion, {
        publicId,
        deletedAtMs
      })
  };
  const api = createApiHandlers(apiDependencies);
  return {
    pools,
    handlers: { ...auth, ...api }
  };
}

function waitForProcessShutdown(): Promise<void> {
  return new Promise((resolveShutdown) => {
    const finish = (): void => {
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      resolveShutdown();
    };
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  pathToFileURL(resolve(entryPath)).href === import.meta.url
) {
  void runBackend().catch(() => {
    process.exitCode = 1;
  });
}
