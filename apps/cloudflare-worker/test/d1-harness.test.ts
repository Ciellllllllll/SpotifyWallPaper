import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('D1 test harness', () => {
  it('provides isolated primary and deletion databases', async () => {
    await env.DB.exec('CREATE TABLE harness_value (value INTEGER NOT NULL); INSERT INTO harness_value VALUES (1);');
    await env.DELETION_DB.exec('CREATE TABLE harness_value (value INTEGER NOT NULL); INSERT INTO harness_value VALUES (2);');

    const primary = await env.DB.prepare('SELECT value FROM harness_value').first<{ value: number }>();
    const deletion = await env.DELETION_DB.prepare('SELECT value FROM harness_value').first<{ value: number }>();

    expect(primary?.value).toBe(1);
    expect(deletion?.value).toBe(2);
  });
});
