ALTER TABLE deletion_tombstones
  ADD COLUMN reconciled_at_ms INTEGER;

CREATE INDEX deletion_tombstones_reconciliation_idx
  ON deletion_tombstones (reconciled_at_ms, public_id);
