ALTER TABLE deletion_tombstones
  ADD COLUMN reconciliation_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE deletion_tombstones
  ADD COLUMN last_attempt_at_ms INTEGER;
