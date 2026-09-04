BEGIN;

SELECT pg_advisory_xact_lock(1937072752, 1886151024);

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at_ms BIGINT NOT NULL CHECK (applied_at_ms >= 0)
);

CREATE TABLE credentials (
  public_id TEXT PRIMARY KEY CHECK (public_id ~ '^[A-Za-z0-9_-]{22}$'),
  pairing_digest TEXT NOT NULL CHECK (pairing_digest ~ '^[A-Za-z0-9_-]{43}$'),
  pairing_key_id TEXT NOT NULL CHECK (pairing_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  spotify_client_id TEXT NOT NULL CHECK (length(spotify_client_id) BETWEEN 1 AND 256),
  refresh_token_ciphertext TEXT
    CHECK (refresh_token_ciphertext IS NULL OR length(refresh_token_ciphertext) BETWEEN 1 AND 8192),
  refresh_token_nonce TEXT
    CHECK (refresh_token_nonce IS NULL OR refresh_token_nonce ~ '^[A-Za-z0-9_-]{16}$'),
  refresh_token_key_id TEXT
    CHECK (refresh_token_key_id IS NULL OR refresh_token_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  access_token_ciphertext TEXT
    CHECK (access_token_ciphertext IS NULL OR length(access_token_ciphertext) BETWEEN 1 AND 8192),
  access_token_nonce TEXT
    CHECK (access_token_nonce IS NULL OR access_token_nonce ~ '^[A-Za-z0-9_-]{16}$'),
  access_token_key_id TEXT
    CHECK (access_token_key_id IS NULL OR access_token_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  access_token_expires_at_ms BIGINT CHECK (access_token_expires_at_ms >= 0),
  refresh_authorized_at_ms BIGINT NOT NULL CHECK (refresh_authorized_at_ms >= 0),
  token_version BIGINT NOT NULL DEFAULT 1 CHECK (token_version > 0),
  refresh_lease_id TEXT
    CHECK (refresh_lease_id IS NULL OR refresh_lease_id ~ '^[A-Za-z0-9_-]{22}$'),
  refresh_lease_until_ms BIGINT CHECK (refresh_lease_until_ms >= 0),
  auth_status TEXT NOT NULL DEFAULT 'active'
    CHECK (auth_status IN ('active', 'reauth_required')),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms BIGINT NOT NULL CHECK (updated_at_ms >= 0),
  last_used_at_ms BIGINT CHECK (last_used_at_ms >= 0),
  CHECK (
    (refresh_token_ciphertext IS NULL AND refresh_token_nonce IS NULL AND refresh_token_key_id IS NULL)
    OR
    (refresh_token_ciphertext IS NOT NULL AND refresh_token_nonce IS NOT NULL AND refresh_token_key_id IS NOT NULL)
  ),
  CHECK (
    (
      access_token_ciphertext IS NULL
      AND access_token_nonce IS NULL
      AND access_token_key_id IS NULL
      AND access_token_expires_at_ms IS NULL
    )
    OR
    (
      access_token_ciphertext IS NOT NULL
      AND access_token_nonce IS NOT NULL
      AND access_token_key_id IS NOT NULL
      AND access_token_expires_at_ms IS NOT NULL
    )
  ),
  CHECK (
    (refresh_lease_id IS NULL AND refresh_lease_until_ms IS NULL)
    OR
    (refresh_lease_id IS NOT NULL AND refresh_lease_until_ms IS NOT NULL)
  ),
  CHECK (
    (auth_status = 'active' AND refresh_token_ciphertext IS NOT NULL)
    OR
    (
      auth_status = 'reauth_required'
      AND refresh_token_ciphertext IS NULL
      AND refresh_token_nonce IS NULL
      AND refresh_token_key_id IS NULL
      AND access_token_ciphertext IS NULL
      AND access_token_nonce IS NULL
      AND access_token_key_id IS NULL
      AND access_token_expires_at_ms IS NULL
      AND refresh_lease_id IS NULL
      AND refresh_lease_until_ms IS NULL
    )
  )
);

CREATE INDEX credentials_active_idx
  ON credentials (auth_status, last_used_at_ms);

CREATE INDEX credentials_spotify_client_idx
  ON credentials (spotify_client_id, public_id);

CREATE TABLE setup_sessions (
  session_id TEXT PRIMARY KEY CHECK (session_id ~ '^[A-Za-z0-9_-]{22}$'),
  browser_digest TEXT NOT NULL CHECK (browser_digest ~ '^[A-Za-z0-9_-]{43}$'),
  issuer_digest TEXT NOT NULL CHECK (issuer_digest ~ '^[A-Za-z0-9_-]{43}$'),
  protocol_version SMALLINT NOT NULL CHECK (protocol_version = 2),
  privacy_version TEXT NOT NULL CHECK (length(privacy_version) BETWEEN 1 AND 64),
  eula_version TEXT NOT NULL CHECK (length(eula_version) BETWEEN 1 AND 64),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  expires_at_ms BIGINT NOT NULL
    CHECK (expires_at_ms > created_at_ms AND expires_at_ms <= created_at_ms + 600000),
  consumed_at_ms BIGINT CHECK (consumed_at_ms >= created_at_ms)
);

CREATE UNIQUE INDEX setup_sessions_live_browser_idx
  ON setup_sessions (browser_digest)
  WHERE consumed_at_ms IS NULL;

CREATE INDEX setup_sessions_issuer_live_idx
  ON setup_sessions (issuer_digest, expires_at_ms)
  WHERE consumed_at_ms IS NULL;

CREATE INDEX setup_sessions_expiry_idx
  ON setup_sessions (expires_at_ms);

CREATE TABLE oauth_sessions (
  state_digest TEXT PRIMARY KEY CHECK (state_digest ~ '^[A-Za-z0-9_-]{43}$'),
  browser_digest TEXT NOT NULL CHECK (browser_digest ~ '^[A-Za-z0-9_-]{43}$'),
  spotify_client_id TEXT NOT NULL CHECK (length(spotify_client_id) BETWEEN 1 AND 256),
  credential_public_id TEXT REFERENCES credentials (public_id) ON DELETE CASCADE,
  protocol_version SMALLINT NOT NULL CHECK (protocol_version = 2),
  code_verifier_ciphertext TEXT NOT NULL CHECK (length(code_verifier_ciphertext) BETWEEN 1 AND 8192),
  code_verifier_nonce TEXT NOT NULL CHECK (code_verifier_nonce ~ '^[A-Za-z0-9_-]{16}$'),
  encryption_key_id TEXT NOT NULL CHECK (encryption_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  expires_at_ms BIGINT NOT NULL
    CHECK (expires_at_ms > created_at_ms AND expires_at_ms <= created_at_ms + 600000),
  consumed_at_ms BIGINT CHECK (consumed_at_ms >= created_at_ms)
);

CREATE UNIQUE INDEX oauth_sessions_live_browser_idx
  ON oauth_sessions (browser_digest)
  WHERE consumed_at_ms IS NULL;

CREATE INDEX oauth_sessions_expiry_idx
  ON oauth_sessions (expires_at_ms);

CREATE INDEX oauth_sessions_credential_idx
  ON oauth_sessions (credential_public_id)
  WHERE credential_public_id IS NOT NULL;

CREATE TABLE callback_confirmations (
  confirmation_id TEXT PRIMARY KEY CHECK (confirmation_id ~ '^[A-Za-z0-9_-]{22}$'),
  browser_digest TEXT NOT NULL CHECK (browser_digest ~ '^[A-Za-z0-9_-]{43}$'),
  spotify_client_id TEXT NOT NULL CHECK (length(spotify_client_id) BETWEEN 1 AND 256),
  protocol_version SMALLINT NOT NULL CHECK (protocol_version = 1),
  authorization_code_ciphertext TEXT NOT NULL
    CHECK (length(authorization_code_ciphertext) BETWEEN 1 AND 8192),
  authorization_code_nonce TEXT NOT NULL
    CHECK (authorization_code_nonce ~ '^[A-Za-z0-9_-]{16}$'),
  authorization_code_key_id TEXT NOT NULL
    CHECK (authorization_code_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  code_verifier_ciphertext TEXT NOT NULL CHECK (length(code_verifier_ciphertext) BETWEEN 1 AND 8192),
  code_verifier_nonce TEXT NOT NULL CHECK (code_verifier_nonce ~ '^[A-Za-z0-9_-]{16}$'),
  code_verifier_key_id TEXT NOT NULL CHECK (code_verifier_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  expires_at_ms BIGINT NOT NULL
    CHECK (expires_at_ms > created_at_ms AND expires_at_ms <= created_at_ms + 300000),
  consumed_at_ms BIGINT CHECK (consumed_at_ms >= created_at_ms)
);

CREATE UNIQUE INDEX callback_confirmations_live_browser_idx
  ON callback_confirmations (browser_digest)
  WHERE consumed_at_ms IS NULL;

CREATE INDEX callback_confirmations_expiry_idx
  ON callback_confirmations (expires_at_ms);

CREATE TABLE spotify_backoff (
  spotify_client_id TEXT PRIMARY KEY CHECK (length(spotify_client_id) BETWEEN 1 AND 256),
  retry_until_ms BIGINT NOT NULL CHECK (retry_until_ms >= 0),
  updated_at_ms BIGINT NOT NULL CHECK (updated_at_ms >= 0)
);

INSERT INTO schema_migrations (version, applied_at_ms)
VALUES ('0001_initial', (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT);

COMMIT;
