CREATE TABLE oauth_sessions (
  state_digest TEXT PRIMARY KEY,
  browser_digest TEXT NOT NULL,
  spotify_client_id TEXT NOT NULL,
  credential_public_id TEXT,
  code_verifier_ciphertext TEXT NOT NULL,
  code_verifier_nonce TEXT NOT NULL,
  encryption_key_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  CHECK (expires_at_ms > created_at_ms)
);

CREATE INDEX oauth_sessions_expiry_idx
  ON oauth_sessions (expires_at_ms, consumed_at_ms);

CREATE TABLE credentials (
  public_id TEXT PRIMARY KEY,
  pairing_digest TEXT NOT NULL,
  pairing_key_id TEXT NOT NULL,
  spotify_client_id TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  refresh_token_nonce TEXT,
  refresh_token_key_id TEXT,
  access_token_ciphertext TEXT,
  access_token_nonce TEXT,
  access_token_key_id TEXT,
  access_token_expires_at_ms INTEGER,
  refresh_authorized_at_ms INTEGER NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  refresh_lease_id TEXT,
  refresh_lease_until_ms INTEGER,
  auth_status TEXT NOT NULL DEFAULT 'active',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  last_used_at_ms INTEGER,
  CHECK (auth_status IN ('active', 'reauth_required')),
  CHECK (token_version > 0),
  CHECK (
    (refresh_token_ciphertext IS NULL AND refresh_token_nonce IS NULL AND refresh_token_key_id IS NULL)
    OR
    (refresh_token_ciphertext IS NOT NULL AND refresh_token_nonce IS NOT NULL AND refresh_token_key_id IS NOT NULL)
  ),
  CHECK (
    (access_token_ciphertext IS NULL AND access_token_nonce IS NULL AND access_token_key_id IS NULL)
    OR
    (access_token_ciphertext IS NOT NULL AND access_token_nonce IS NOT NULL AND access_token_key_id IS NOT NULL)
  ),
  CHECK (
    (refresh_lease_id IS NULL AND refresh_lease_until_ms IS NULL)
    OR
    (refresh_lease_id IS NOT NULL AND refresh_lease_until_ms IS NOT NULL)
  ),
  CHECK (
    auth_status = 'active'
    OR
    (
      refresh_token_ciphertext IS NULL
      AND refresh_token_nonce IS NULL
      AND refresh_token_key_id IS NULL
      AND access_token_ciphertext IS NULL
      AND access_token_nonce IS NULL
      AND access_token_key_id IS NULL
      AND access_token_expires_at_ms IS NULL
    )
  )
);

CREATE INDEX credentials_active_idx
  ON credentials (auth_status, last_used_at_ms);

CREATE TABLE spotify_backoff (
  spotify_client_id TEXT PRIMARY KEY,
  retry_until_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
