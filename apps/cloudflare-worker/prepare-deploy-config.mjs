import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = fileURLToPath(new URL('.', import.meta.url));
const requestedEnvironment = process.argv[2];
const outputPath = resolve(
  process.argv[3] ??
    resolve(
      appDirectory,
      `.wrangler.${requestedEnvironment ?? 'invalid'}.generated.json`
    )
);
const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
let outputAccepted = false;

try {
  const environment = requireEnvironment(requestedEnvironment);
  if (basename(outputPath) !== `.wrangler.${environment}.generated.json`) {
    throw new Error('Deployment output filename is invalid.');
  }
  outputAccepted = true;
  await rm(outputPath, { force: true });
  const inventory = {
    preview: requireDeploymentInventory('preview'),
    production: requireDeploymentInventory('production')
  };
  requireSeparatedEnvironments(inventory);
  const {
    publicOrigin,
    primaryDatabaseId,
    deletionDatabaseId
  } = inventory[environment];

  const baseConfig = JSON.parse(
    await readFile(resolve(appDirectory, 'wrangler.jsonc'), 'utf8')
  );
  const selected = baseConfig?.env?.[environment];
  if (!selected) {
    throw new Error('Deployment environment is not configured.');
  }
  const hostname = new URL(publicOrigin).hostname;
  const generated = {
    ...baseConfig,
    d1_databases: undefined,
    env: {
      [environment]: {
        ...selected,
        workers_dev: false,
        preview_urls: false,
        vars: {
          ...selected.vars,
          ENVIRONMENT: environment,
          PUBLIC_BASE_URL: publicOrigin
        },
        routes: [{ pattern: hostname, custom_domain: true }],
        d1_databases: [
          {
            binding: 'DB',
            database_name: `spotify-wallpaper-${environment}`,
            database_id: primaryDatabaseId,
            migrations_dir: 'migrations'
          },
          {
            binding: 'DELETION_DB',
            database_name: `spotify-wallpaper-deletion-${environment}`,
            database_id: deletionDatabaseId,
            migrations_dir: 'migrations/deletion-ledger'
          }
        ]
      }
    }
  };

  await writeFile(temporaryPath, `${JSON.stringify(generated, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  });
  await rename(temporaryPath, outputPath);
} catch {
  if (outputAccepted) {
    await Promise.all([
      rm(temporaryPath, { force: true }),
      rm(outputPath, { force: true })
    ]).catch(() => undefined);
  }
  console.error('Cloudflare deployment configuration preparation failed.');
  process.exitCode = 1;
}

/** @param {string | undefined} value */
function requireEnvironment(value) {
  if (value !== 'preview' && value !== 'production') {
    throw new Error('Environment must be preview or production.');
  }
  const configured = process.env.CLOUDFLARE_DEPLOY_ENV;
  if (configured !== value) {
    throw new Error('Environment selector mismatch.');
  }
  return value;
}

/** @param {string | undefined} value */
function requirePublicOrigin(value) {
  if (!value) {
    throw new Error('Public origin is required.');
  }
  const url = new URL(value);
  if (
    value !== url.origin ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== '/') ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.workers.dev') ||
    url.hostname.endsWith('.invalid') ||
    !url.hostname.includes('.')
  ) {
    throw new Error('Public URL must be a canonical HTTPS custom-domain origin.');
  }
  return url.origin;
}

/** @param {string | undefined} value */
function requireD1Id(value) {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value
    )
  ) {
    throw new Error('D1 database ID is invalid.');
  }
  return value;
}

/** @param {'preview' | 'production'} environment */
function requireDeploymentInventory(environment) {
  const prefix = `CLOUDFLARE_${environment.toUpperCase()}_`;
  return {
    publicOrigin: requirePublicOrigin(
      process.env[`${prefix}PUBLIC_BASE_URL`]
    ),
    primaryDatabaseId: requireD1Id(
      process.env[`${prefix}PRIMARY_D1_ID`]
    ),
    deletionDatabaseId: requireD1Id(
      process.env[`${prefix}DELETION_D1_ID`]
    )
  };
}

/**
 * @param {Record<'preview' | 'production', ReturnType<typeof requireDeploymentInventory>>} inventory
 */
function requireSeparatedEnvironments(inventory) {
  if (inventory.preview.publicOrigin === inventory.production.publicOrigin) {
    throw new Error('Preview and production origins must be distinct.');
  }
  const databaseIds = [
    inventory.preview.primaryDatabaseId,
    inventory.preview.deletionDatabaseId,
    inventory.production.primaryDatabaseId,
    inventory.production.deletionDatabaseId
  ];
  if (new Set(databaseIds).size !== databaseIds.length) {
    throw new Error('Every deployment database must be distinct.');
  }
}
