import { mockPlayback } from '../../mock/mockPlayback';
import type { PlaybackCommand, PlaybackProvider } from '@spotify-wallpaper/shared-types';
import type { SpotifyResult } from '../types';

export class MockPlaybackProvider implements PlaybackProvider {
  readonly kind = 'mock' as const;

  poll(_signal: AbortSignal): Promise<SpotifyResult<typeof mockPlayback>> {
    return Promise.resolve({
      ok: true,
      value: { ...mockPlayback, fetchedAt: new Date().toISOString() }
    });
  }

  control(_command: PlaybackCommand, _signal: AbortSignal): Promise<SpotifyResult<void>> {
    return Promise.resolve({ ok: true, value: undefined });
  }

  dispose(): void {}
}
