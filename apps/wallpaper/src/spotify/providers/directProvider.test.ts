import { describe, expect, it } from 'vitest';
import trackFixture from '../../../../../tests/fixtures/spotify/current-playback-track.json';
import { DirectPlaybackProvider } from './directProvider';
import type { Fetcher } from '../types';

describe('DirectPlaybackProvider', () => {
  it('shares one refresh request across concurrent polls', async () => {
    let releaseToken!: (response: Response) => void;
    const tokenResponse = new Promise<Response>((resolve) => { releaseToken = resolve; });
    let tokenCalls = 0;
    const fetcher: Fetcher = async (url) => {
      if (String(url).includes('/api/token')) {
        tokenCalls += 1;
        return tokenResponse;
      }
      return Response.json(trackFixture);
    };
    const provider = new DirectPlaybackProvider({ clientId: 'client-id', refreshToken: 'refresh-token' }, fetcher);
    const first = provider.pollAt(0);
    const second = provider.pollAt(0);
    releaseToken(Response.json({ access_token: 'access-token', expires_in: 3600 }));

    await Promise.all([first, second]);
    expect(tokenCalls).toBe(1);
  });

  it('rotates a returned refresh token and uses it on the next refresh', async () => {
    const requestBodies: string[] = [];
    let tokenCall = 0;
    const fetcher: Fetcher = async (url, init) => {
      if (String(url).includes('/api/token')) {
        requestBodies.push(String(init?.body));
        tokenCall += 1;
        return Response.json({
          access_token: `access-${tokenCall}`,
          expires_in: 1,
          ...(tokenCall === 1 ? { refresh_token: 'rotated-refresh-token' } : {})
        });
      }
      return Response.json(trackFixture);
    };
    const provider = new DirectPlaybackProvider({ clientId: 'client-id', refreshToken: 'initial-refresh-token' }, fetcher);

    await provider.pollAt(0);
    await provider.pollAt(1000);

    expect(requestBodies[0]).toContain('initial-refresh-token');
    expect(requestBodies[1]).toContain('rotated-refresh-token');
  });

  it('treats invalid_grant as terminal until a new credential is supplied', async () => {
    let tokenCalls = 0;
    const fetcher: Fetcher = async () => {
      tokenCalls += 1;
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    };
    const provider = new DirectPlaybackProvider({ clientId: 'client-id', refreshToken: 'refresh-token' }, fetcher);

    const first = await provider.pollAt(0);
    const second = await provider.pollAt(1000);
    expect(first).toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
    expect(second).toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
    expect(tokenCalls).toBe(1);
  });

  it('retries one unauthorized playback response after refreshing once', async () => {
    let tokenCalls = 0;
    let playbackCalls = 0;
    const fetcher: Fetcher = async (url) => {
      if (String(url).includes('/api/token')) {
        tokenCalls += 1;
        return Response.json({ access_token: `access-${tokenCalls}`, expires_in: 3600 });
      }
      playbackCalls += 1;
      return playbackCalls === 1 ? new Response(null, { status: 401 }) : Response.json(trackFixture);
    };
    const provider = new DirectPlaybackProvider({ clientId: 'client-id', refreshToken: 'refresh-token' }, fetcher);

    const result = await provider.pollAt(0);
    expect(result.ok).toBe(true);
    expect(tokenCalls).toBe(2);
    expect(playbackCalls).toBe(2);
  });

  it('does not resume an in-flight refresh after dispose', async () => {
    let releaseToken!: (response: Response) => void;
    const tokenResponse = new Promise<Response>((resolve) => { releaseToken = resolve; });
    let playbackCalls = 0;
    const fetcher: Fetcher = async (url) => {
      if (String(url).includes('/api/token')) return tokenResponse;
      playbackCalls += 1;
      return Response.json(trackFixture);
    };
    const provider = new DirectPlaybackProvider({ clientId: 'client-id', refreshToken: 'refresh-token' }, fetcher);
    const pending = provider.pollAt(0);
    provider.dispose();
    releaseToken(Response.json({ access_token: 'late-access-token', expires_in: 3600 }));

    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
    expect(playbackCalls).toBe(0);
  });

  it('aborts the shared-interface external signal when disposed', async () => {
    let releaseToken!: (response: Response) => void;
    const tokenResponse = new Promise<Response>((resolve) => { releaseToken = resolve; });
    let requestSignal: AbortSignal | undefined;
    const fetcher: Fetcher = async (_url, init) => {
      requestSignal = init?.signal ?? undefined;
      return tokenResponse;
    };
    const provider = new DirectPlaybackProvider({ clientId: 'client-id', refreshToken: 'refresh-token' }, fetcher);
    const external = new AbortController();
    const pending = provider.poll(external.signal);
    provider.dispose();
    releaseToken(Response.json({ access_token: 'late-access-token', expires_in: 3600 }));

    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
    expect(requestSignal?.aborted).toBe(true);
  });

  it('propagates dispose through the malformed-primary fallback request', async () => {
    let releaseFallback!: (response: Response) => void;
    const fallbackResponse = new Promise<Response>((resolve) => { releaseFallback = resolve; });
    let markFallback!: () => void;
    const fallbackStarted = new Promise<void>((resolve) => { markFallback = resolve; });
    let playbackCalls = 0;
    let fallbackSignal: AbortSignal | undefined;
    const fetcher: Fetcher = async (url, init) => {
      if (String(url).includes('/api/token')) return Response.json({ access_token: 'access-token', expires_in: 3600 });
      playbackCalls += 1;
      if (playbackCalls === 1) return Response.json({ item: 'malformed' });
      fallbackSignal = init?.signal ?? undefined;
      markFallback();
      return fallbackResponse;
    };
    const provider = new DirectPlaybackProvider({ clientId: 'client-id', refreshToken: 'refresh-token' }, fetcher);
    const pending = provider.poll(new AbortController().signal);
    await fallbackStarted;
    provider.dispose();
    releaseFallback(Response.json(trackFixture));

    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
    expect(fallbackSignal?.aborted).toBe(true);
  });
});
