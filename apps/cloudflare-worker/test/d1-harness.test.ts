import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('D1 test harness', () => {
  it('provides isolated primary and deletion databases', async () => {
    const primary = await env.DB.prepare('SELECT 1 AS value').first<{ value: number }>();
    const deletion = await env.DELETION_DB.prepare('SELECT 2 AS value').first<{ value: number }>();

    expect(primary).toEqual({ value: 1 });
    expect(deletion).toEqual({ value: 2 });
  });
});
