import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const primaryId = '11111111-1111-4111-8111-111111111111';
const deletionId = '22222222-2222-4222-8222-222222222222';
const productionPrimaryId = '33333333-3333-4333-8333-333333333333';
const productionDeletionId = '44444444-4444-4444-8444-444444444444';
const completeInventory = {
  CLOUDFLARE_PREVIEW_PUBLIC_BASE_URL:
    'https://preview-api.wallpaper.example',
  CLOUDFLARE_PREVIEW_PRIMARY_D1_ID: primaryId,
  CLOUDFLARE_PREVIEW_DELETION_D1_ID: deletionId,
  CLOUDFLARE_PRODUCTION_PUBLIC_BASE_URL:
    'https://api.wallpaper.example',
  CLOUDFLARE_PRODUCTION_PRIMARY_D1_ID: productionPrimaryId,
  CLOUDFLARE_PRODUCTION_DELETION_D1_ID: productionDeletionId
};

describe('Cloudflare deployment configuration', () => {
  it.each(['preview', 'production'])(
    'generates a complete %s configuration from explicit inputs',
    (environment) => {
      withTemporaryOutput(environment, (outputPath) => {
        const result = runPreparation(environment, outputPath, {
          ...completeInventory,
          CLOUDFLARE_DEPLOY_ENV: environment,
        });
        expect(result.status).toBe(0);
        const config = JSON.parse(readFileSync(outputPath, 'utf8'));
        const selected = config.env[environment];

        expect(Object.keys(config.env)).toEqual([environment]);
        expect(selected.vars.PUBLIC_BASE_URL).toBe(
          environment === 'preview'
            ? 'https://preview-api.wallpaper.example'
            : 'https://api.wallpaper.example'
        );
        expect(selected.routes).toEqual([
          {
            pattern:
              environment === 'preview'
                ? 'preview-api.wallpaper.example'
                : 'api.wallpaper.example',
            custom_domain: true
          }
        ]);
        expect(selected.workers_dev).toBe(false);
        expect(selected.preview_urls).toBe(false);
        expect(selected.d1_databases).toEqual([
          expect.objectContaining({
            binding: 'DB',
            database_id:
              environment === 'preview' ? primaryId : productionPrimaryId
          }),
          expect.objectContaining({
            binding: 'DELETION_DB',
            database_id:
              environment === 'preview' ? deletionId : productionDeletionId
          })
        ]);
        expect(config.d1_databases).toBeUndefined();
        expect(JSON.stringify(config)).not.toContain(
          '00000000-0000-0000-0000-000000000001'
        );
        expect(JSON.stringify(config)).not.toContain('.invalid');
      });
    }
  );

  it.each([
    [
      { CLOUDFLARE_PRODUCTION_PUBLIC_BASE_URL: undefined },
      'missing origin'
    ],
    [
      {
        CLOUDFLARE_PRODUCTION_PUBLIC_BASE_URL:
          'http://api.wallpaper.example'
      },
      'HTTP'
    ],
    [
      {
        CLOUDFLARE_PRODUCTION_PUBLIC_BASE_URL:
          'https://api.wallpaper.example/path'
      },
      'path'
    ],
    [
      {
        CLOUDFLARE_PRODUCTION_PUBLIC_BASE_URL:
          'https://api.wallpaper.example:8443'
      },
      'non-standard port'
    ],
    [
      {
        CLOUDFLARE_PRODUCTION_PUBLIC_BASE_URL:
          'https://api.wallpaper.example/'
      },
      'trailing slash'
    ],
    [
      {
        CLOUDFLARE_PRODUCTION_PUBLIC_BASE_URL:
          'https://spotify-wallpaper-api-preview.example.workers.dev'
      },
      'workers.dev'
    ],
    [
      { CLOUDFLARE_PRODUCTION_PRIMARY_D1_ID: 'not-a-uuid' },
      'invalid primary ID'
    ],
    [
      { CLOUDFLARE_PRODUCTION_DELETION_D1_ID: primaryId },
      'shared databases'
    ]
  ])('fails closed for %s', (overrides) => {
    withTemporaryOutput('production', (outputPath) => {
      const result = runPreparation('production', outputPath, {
        ...completeInventory,
        CLOUDFLARE_DEPLOY_ENV: 'production',
        ...overrides
      });

      expect(result.status).not.toBe(0);
      expect(() => readFileSync(outputPath, 'utf8')).toThrow();
    });
  });

  it('rejects an environment mismatch', () => {
    withTemporaryOutput('preview', (outputPath) => {
      const result = runPreparation('preview', outputPath, {
        ...completeInventory,
        CLOUDFLARE_DEPLOY_ENV: 'production',
      });

      expect(result.status).not.toBe(0);
    });
  });

  it('rejects a missing environment selector even when inventory exists', () => {
    withTemporaryOutput('production', (outputPath) => {
      const result = runPreparation('production', outputPath, {
        ...completeInventory,
        CLOUDFLARE_DEPLOY_ENV: undefined,
      });

      expect(result.status).not.toBe(0);
      expect(existsSync(outputPath)).toBe(false);
    });
  });

  it('removes stale output when regeneration fails', () => {
    withTemporaryOutput('production', (outputPath) => {
      const valid = runPreparation('production', outputPath, {
        ...completeInventory,
        CLOUDFLARE_DEPLOY_ENV: 'production',
      });
      expect(valid.status).toBe(0);
      expect(existsSync(outputPath)).toBe(true);

      const invalid = runPreparation('production', outputPath, {
        ...completeInventory,
        CLOUDFLARE_DEPLOY_ENV: 'production',
        CLOUDFLARE_PRODUCTION_PUBLIC_BASE_URL:
          'https://api.wallpaper.example',
        CLOUDFLARE_PRODUCTION_PRIMARY_D1_ID: 'invalid',
      });

      expect(invalid.status).not.toBe(0);
      expect(existsSync(outputPath)).toBe(false);
    });
  });

  it.each([
    [
      {
        CLOUDFLARE_PRODUCTION_PUBLIC_BASE_URL:
          completeInventory.CLOUDFLARE_PREVIEW_PUBLIC_BASE_URL
      },
      'shared public origin'
    ],
    [
      {
        CLOUDFLARE_PRODUCTION_PRIMARY_D1_ID:
          completeInventory.CLOUDFLARE_PREVIEW_PRIMARY_D1_ID
      },
      'shared primary D1'
    ],
    [
      {
        CLOUDFLARE_PRODUCTION_DELETION_D1_ID:
          completeInventory.CLOUDFLARE_PREVIEW_PRIMARY_D1_ID
      },
      'cross-role shared D1'
    ]
  ])('rejects cross-environment inventory collisions: %s', (overrides) => {
    withTemporaryOutput('production', (outputPath) => {
      const result = runPreparation('production', outputPath, {
        ...completeInventory,
        CLOUDFLARE_DEPLOY_ENV: 'production',
        ...overrides
      });

      expect(result.status).not.toBe(0);
      expect(existsSync(outputPath)).toBe(false);
    });
  });

  it('rejects an arbitrary output path without deleting its contents', () => {
    withTemporaryPath('operator-owned.json', (outputPath) => {
      writeFileSync(outputPath, 'operator-owned-file', 'utf8');

      const result = runPreparation('production', outputPath, {
        ...completeInventory,
        CLOUDFLARE_DEPLOY_ENV: 'production'
      });

      expect(result.status).not.toBe(0);
      expect(readFileSync(outputPath, 'utf8')).toBe('operator-owned-file');
    });
  });
});

const withTemporaryOutput = (
  environment: string,
  run: (outputPath: string) => void
): void => {
  withTemporaryPath(
    `.wrangler.${environment}.generated.json`,
    run
  );
};

const withTemporaryPath = (
  filename: string,
  run: (outputPath: string) => void
): void => {
  const directory = mkdtempSync(resolve(tmpdir(), 'spotify-worker-config-'));
  const outputPath = resolve(directory, filename);
  try {
    run(outputPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const runPreparation = (
  environment: string,
  outputPath: string,
  overrides: Record<string, string | undefined>
) => {
  const testDir = fileURLToPath(new URL('.', import.meta.url));
  const scriptPath = resolve(testDir, '../prepare-deploy-config.mjs');
  const env = { ...process.env };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[name];
    } else {
      env[name] = value;
    }
  }
  return spawnSync(
    process.execPath,
    [scriptPath, environment, outputPath],
    {
      encoding: 'utf8',
      env
    }
  );
};
