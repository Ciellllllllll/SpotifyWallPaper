CREATE TABLE deletion_tombstones (
  public_id TEXT PRIMARY KEY,
  deleted_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  CHECK (expires_at_ms > deleted_at_ms)
);

CREATE INDEX deletion_tombstones_expiry_idx
  ON deletion_tombstones (expires_at_ms);
