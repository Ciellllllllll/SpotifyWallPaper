import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('public-backend configuration', () => {
  const socketEnvironment = {
    PUBLIC_SOCKET_PATH: '/run/spotify-wallpaper/public.sock',
    ADMIN_SOCKET_PATH: '/run/spotify-wallpaper/admin.sock'
  };
  const productionSocketEnvironment = {
    PUBLIC_SOCKET_PATH: '/run/spotify-wallpaper/public/public.sock',
    ADMIN_SOCKET_PATH: '/run/spotify-wallpaper/admin/admin.sock'
  };

  it('accepts locked mode without reading Spotify or database configuration', () => {
    expect(
      loadConfig({
        ...productionSocketEnvironment,
        SPOTIFY_MODE: 'policy_locked'
      })
    ).toEqual({
      mode: 'policy_locked',
      publicSocketPath: productionSocketEnvironment.PUBLIC_SOCKET_PATH,
      adminSocketPath: productionSocketEnvironment.ADMIN_SOCKET_PATH
    });
  });

  it('requires the exact production socket paths in locked mode', () => {
    expect(() =>
      loadConfig({
        ...socketEnvironment,
        SPOTIFY_MODE: 'policy_locked'
      })
    ).toThrow('Production socket paths are fixed.');
  });

  it('requires a complete non-Spotify synthetic configuration', () => {
    expect(() =>
      loadConfig({
        ...socketEnvironment,
        SPOTIFY_MODE: 'synthetic_test'
      })
    ).toThrow('Synthetic test configuration is incomplete.');

    expect(
      loadConfig({
        ...socketEnvironment,
        SPOTIFY_MODE: 'synthetic_test',
        PUBLIC_BASE_URL: 'https://ciel-spotify-wallpaper.duckdns.org',
        PG_SOCKET_DIR: '/run/postgresql',
        OAUTH_STATE_HMAC_KEY:
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        TOKEN_ENCRYPTION_KEYRING:
          '{\"current\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\"}',
        TOKEN_ENCRYPTION_ACTIVE_KEY_ID: 'current',
        PAIRING_HMAC_KEYRING:
          '{\"current\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\"}',
        PAIRING_HMAC_ACTIVE_KEY_ID: 'current',
        SYNTHETIC_AUTHORIZE_ENDPOINT: 'https://synthetic.invalid/authorize',
        SYNTHETIC_TOKEN_ENDPOINT: 'https://synthetic.invalid/token',
        SYNTHETIC_PLAYBACK_ENDPOINT: 'https://synthetic.invalid/v1/me/player',
        PRIVACY_VERSION: '2026-08-31',
        EULA_VERSION: '2026-08-31'
      })
    ).toMatchObject({
      mode: 'synthetic_test',
      postgresSocketDirectory: '/run/postgresql',
      postgresPort: 5433,
      postgresUser: 'swp_backend'
    });
  });

  it('refuses the production Caddy socket paths in synthetic mode', () => {
    const environment = {
      SPOTIFY_MODE: 'synthetic_test',
      PUBLIC_SOCKET_PATH: '/run/spotify-wallpaper/public/public.sock',
      ADMIN_SOCKET_PATH: '/run/spotify-wallpaper/admin/admin.sock',
      PUBLIC_BASE_URL: 'https://ciel-spotify-wallpaper.duckdns.org',
      PG_SOCKET_DIR: '/run/postgresql',
      OAUTH_STATE_HMAC_KEY: 'A'.repeat(43),
      TOKEN_ENCRYPTION_KEYRING: `{"current":"${'A'.repeat(43)}"}`,
      TOKEN_ENCRYPTION_ACTIVE_KEY_ID: 'current',
      PAIRING_HMAC_KEYRING: `{"current":"${'A'.repeat(43)}"}`,
      PAIRING_HMAC_ACTIVE_KEY_ID: 'current',
      SYNTHETIC_AUTHORIZE_ENDPOINT: 'https://synthetic.invalid/authorize',
      SYNTHETIC_TOKEN_ENDPOINT: 'https://synthetic.invalid/token',
      SYNTHETIC_PLAYBACK_ENDPOINT: 'https://synthetic.invalid/v1/me/player',
      PRIVACY_VERSION: '2026-08-31',
      EULA_VERSION: '2026-08-31'
    };
    expect(() => loadConfig(environment)).toThrow(
      'Synthetic test configuration is invalid.'
    );
    expect(() =>
      loadConfig({
        ...environment,
        PUBLIC_SOCKET_PATH:
          '/run/spotify-wallpaper/public/../public/public.sock',
        ADMIN_SOCKET_PATH: '/tmp/spotify-wallpaper-synthetic-admin.sock'
      })
    ).toThrow('Synthetic test configuration is invalid.');
  });

  it.each([
    ['SYNTHETIC_AUTHORIZE_ENDPOINT', 'https://accounts.spotify.com./authorize'],
    ['SYNTHETIC_TOKEN_ENDPOINT', 'https://accounts.spotify.com./api/token'],
    ['SYNTHETIC_PLAYBACK_ENDPOINT', 'https://api.spotify.com./v1/me/player']
  ])('rejects a trailing-dot Spotify host in %s', (name, endpoint) => {
    expect(() =>
      loadConfig({
        ...socketEnvironment,
        SPOTIFY_MODE: 'synthetic_test',
        PUBLIC_BASE_URL: 'https://ciel-spotify-wallpaper.duckdns.org',
        PG_SOCKET_DIR: '/run/postgresql',
        OAUTH_STATE_HMAC_KEY: 'A'.repeat(43),
        TOKEN_ENCRYPTION_KEYRING: `{"current":"${'A'.repeat(43)}"}`,
        TOKEN_ENCRYPTION_ACTIVE_KEY_ID: 'current',
        PAIRING_HMAC_KEYRING: `{"current":"${'A'.repeat(43)}"}`,
        PAIRING_HMAC_ACTIVE_KEY_ID: 'current',
        SYNTHETIC_AUTHORIZE_ENDPOINT: 'https://synthetic.invalid/authorize',
        SYNTHETIC_TOKEN_ENDPOINT: 'https://synthetic.invalid/token',
        SYNTHETIC_PLAYBACK_ENDPOINT: 'https://synthetic.invalid/v1/me/player',
        PRIVACY_VERSION: '2026-08-31',
        EULA_VERSION: '2026-08-31',
        [name]: endpoint
      })
    ).toThrow('Synthetic test configuration is invalid.');
  });

  it.each([undefined, '', 'production', 'POLICY_LOCKED'])(
    'fails startup for an absent or unknown mode',
    (mode) => {
      expect(() =>
        loadConfig({
          ...socketEnvironment,
          SPOTIFY_MODE: mode
        })
      ).toThrow('SPOTIFY_MODE must be policy_locked or synthetic_test.');
    }
  );

  it.each([
    {
      PUBLIC_SOCKET_PATH: 'public.sock',
      ADMIN_SOCKET_PATH: '/run/spotify-wallpaper/admin.sock'
    },
    {
      PUBLIC_SOCKET_PATH: '/run/spotify-wallpaper/public.sock',
      ADMIN_SOCKET_PATH: 'admin.sock'
    },
    {
      PUBLIC_SOCKET_PATH: '/run/spotify-wallpaper/backend.sock',
      ADMIN_SOCKET_PATH: '/run/spotify-wallpaper/backend.sock'
    }
  ])('rejects unsafe socket path pairs', (paths) => {
    expect(() =>
      loadConfig({
        ...paths,
        SPOTIFY_MODE: 'policy_locked'
      })
    ).toThrow('Two distinct absolute Unix socket paths are required.');
  });
});
