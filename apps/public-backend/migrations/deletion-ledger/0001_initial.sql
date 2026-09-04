BEGIN;

SELECT pg_advisory_xact_lock(1937072752, 1684368750);

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at_ms BIGINT NOT NULL CHECK (applied_at_ms >= 0)
);

CREATE TABLE deletion_tombstones (
  public_id TEXT PRIMARY KEY CHECK (public_id ~ '^[A-Za-z0-9_-]{22}$'),
  deleted_at_ms BIGINT NOT NULL CHECK (deleted_at_ms >= 0),
  expires_at_ms BIGINT NOT NULL
    CHECK (expires_at_ms = deleted_at_ms + 3024000000),
  reconciled_at_ms BIGINT CHECK (reconciled_at_ms >= deleted_at_ms),
  reconciliation_attempts BIGINT NOT NULL DEFAULT 0 CHECK (reconciliation_attempts >= 0),
  last_attempt_at_ms BIGINT CHECK (last_attempt_at_ms >= deleted_at_ms)
);

CREATE INDEX deletion_tombstones_pending_idx
  ON deletion_tombstones (last_attempt_at_ms NULLS FIRST, public_id)
  WHERE reconciled_at_ms IS NULL;

CREATE INDEX deletion_tombstones_expiry_idx
  ON deletion_tombstones (expires_at_ms)
  WHERE reconciled_at_ms IS NOT NULL;

INSERT INTO schema_migrations (version, applied_at_ms)
VALUES ('0001_initial', (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT);

COMMIT;
