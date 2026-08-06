import { applyD1Migrations, env } from 'cloudflare:test';

interface Migration {
  name: string;
  queries: string[];
}

interface TestEnv extends Env {
  TEST_PRIMARY_MIGRATIONS: Migration[];
  TEST_DELETION_MIGRATIONS: Migration[];
}

const testEnv = env as TestEnv;

await applyD1Migrations(env.DB, testEnv.TEST_PRIMARY_MIGRATIONS);
await applyD1Migrations(env.DELETION_DB, testEnv.TEST_DELETION_MIGRATIONS);
