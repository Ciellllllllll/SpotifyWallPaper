> Archived on 2026-09-21: the hosted backend has been retired. This is historical evidence, not a current deployment procedure or active service agreement. See `docs/25-public-backend.md`.

# Public Backend PostgreSQL Restore Runbook

> The filename is retained temporarily for path compatibility. This runbook
> applies to the two PostgreSQL 17 databases on the VPS.

## Safety model

The public backend uses:

- `spotify_wallpaper` for live OAuth/credential state;
- `spotify_wallpaper_deletion_ledger` for 35-day non-secret deletion
  tombstones and reconciliation state.

The databases are dumped, checksummed, validation-restored, retained, and
restored independently. A primary restore must not erase newer deletion
history. Public/admin Spotify routes remain closed throughout recovery even
though production is normally policy-locked.

Credential recovery is allowed only when the primary database alone is lost
and the current live deletion ledger remains healthy. If the ledger alone is
lost, both databases are lost, the cluster is lost, or only backups remain,
do not restore any OAuth, credential, setup, or confirmation state. Recreate
empty databases and require every user to authorize again.

## Required evidence

Before a destructive command, two operators verify:

- incident ID and fixed database name;
- selected dump timestamp, checksum, PostgreSQL major version, and migration
  set;
- isolated validation-restore result;
- current release ID and schema versions;
- the complete deletion-history interval covered by the retained ledger; and
- availability of every key ID needed by restored ciphertext/digests.

Credentials come from restricted PostgreSQL service definitions. Do not put a
password, row value, dump path containing sensitive text, or connection URI on
the command line or in the repository. Record only fixed names, timestamps,
sizes, checksums, migration IDs, aggregate counts, and approvals.

Before any dump or validation copy, root sets `umask 077`. Every backup and
temporary archive remains on the same VPS, is owned by root with mode `0600`,
is created at an exact absolute path, and is atomically renamed only after
`pg_restore --list` and checksum validation. Refuse wrong owner/mode/path.
An emergency dump remains at its unique temporary path until an isolated
restore plus schema/count validation succeeds; only then may it be atomically
renamed into a retained series. A failed candidate is deleted at its exact
verified temporary path and is never presented as a backup.

## 1. Stop traffic and writes

1. freeze deploys, migrations, rotations, backup pruning, and timers that
   mutate either database, and stop the migration unit with
   `systemctl stop swp-migrate.service`;
2. stop Caddy, OAuth2 Proxy, and the Node service;
3. verify the public/admin sockets are absent or unreachable;
4. record current artifact checksum, schema versions, and latest independent
   backup metadata;
5. take new emergency custom-format dumps of both current databases when they
   remain readable through separate root-owned temporary files; and
6. checksum and validation-restore those emergency dumps independently.

Do not enable request logging or use application traffic as a readiness test.

## 2. Validate candidate dumps

For each database separately:

1. verify checksum and ownership;
2. inspect the archive table-of-contents only for expected schema objects;
3. restore into an explicitly named isolated temporary PostgreSQL 17
   validation database owned by the restore role;
4. apply no automatic application migration;
5. verify exact schema version, required constraints/indexes, and fixed
   aggregate status/key-ID counts;
6. verify no unexpected extension, owner, executable procedure, or public
   privilege; and
7. drop only that explicit validation database after evidence is recorded.

Delete validation copies and failed temporary archives immediately after
exact path/owner/mode validation. Retention pruning applies independently to
each database and never uses a broad path or unresolved glob. No dump is
copied off the VPS; VPS/disk loss therefore starts from empty databases and
requires reauthorization.

Do not select credential columns or include dump/listing output in a report.
A candidate that does not validate exactly is rejected.

## 3. Choose restore sequence

### Healthy ledger, primary restore

Keep `spotify_wallpaper_deletion_ledger` at its current point. Restore only
`spotify_wallpaper`, then replay every retained ledger tombstone before any
traffic resumes.

### Ledger, combined, cluster, or backup-only loss

Reject credential recovery. Do not rebuild a live ledger from an older dump
and then restore the primary: a deletion after that dump could be missed.
Create empty databases, apply the tracked migrations, and require every user
to authorize again. This deliberately sacrifices availability to prevent a
deleted credential from returning.

## 4. Restore

Use the dedicated restore role and `ON_ERROR_STOP`. The primary-only procedure
requires the fixed `spotify_wallpaper` database name to be absent; if it still
exists, stop and investigate instead of renaming or dropping it automatically.
Restore into a new explicitly named recovery database and never overwrite an
active database in place. Root may use the local peer-authenticated PostgreSQL
administrator only as the recovery broker; application services never use it.

1. create the recovery database from a clean template;
2. set the recovery database owner to `swp_migrator`, revoke all database
   privileges from `PUBLIC`, and grant only the fixed CONNECT set;
3. restore the validated custom-format dump with `--role=swp_migrator`,
   `--no-owner`, and `--no-privileges`;
4. apply every retained live-ledger tombstone and clear transient OAuth/setup/
   confirmation/backoff rows while acting as `swp_migrator`;
5. apply the tracked runtime grants, validate the recovery database against the
   recovery profile, then close all connections and rename it to
   `spotify_wallpaper`;
6. verify the fixed database name, database/object owner, database/table/schema
   ACLs, exact migration/schema state, and aggregate counts again against the
   live profile;
7. do not restore the deletion ledger in a credential-recovery procedure; and
8. keep Node, OAuth2 Proxy, and Caddy stopped.

The procedure deletes only its newly created recovery database when a step
fails. It never drops or renames an existing fixed primary database.

## 5. Reconcile deletions

After any primary restore:

1. reset reconciliation checkpoints for every retained tombstone that could
   overlap the restored primary;
2. run the local ledger reconciler in bounded batches ordered by stable
   `publicId`;
3. continue after a row failure while leaving that row pending;
4. verify fixed aggregate attempted, reconciled, failed, pending,
   oldest-pending, and retry counts; and
5. require `pending = 0`.

Every authenticated operation checks the ledger first in the dormant
protocol. Expired tombstones are removed only after successful reconciliation
and the full 35-day retention. Do not resume traffic when one row remains
pending or a known deletion is missing.

## 6. Keys and migrations

If a restored row references a previous key ID, restore that key from approved
offline escrow before synthetic verification. Never rewrite a key ID to make a
row appear current.

Run only tracked, reviewed SQL migrations as a separate operation after the
restore. Verify both databases independently. An unexpected or missing
migration keeps traffic closed; application startup must not repair schema.

## 7. Verification

Before restarting:

- independent fresh dumps of the restored databases pass checksum and isolated
  validation restore;
- both schema versions match the intended release;
- ledger pending count is zero and the deletion interval is complete;
- roles/grants are least-privilege;
- local disk/inode, backup freshness, timer, and certificate checks pass;
- the artifact and systemd/proxy configurations match reviewed checksums; and
- Caddy/OAuth2 Proxy logging remains disabled.

Restart Node in `SPOTIFY_MODE=policy_locked`, then OAuth2 Proxy and Caddy.
Verify DB-independent `/health`, exact socket route tables, absence of a Node
TCP listener, and the fixed early no-store 503 for each allowed Spotify
route/method. Verify wrong methods and paths remain rejected. Do not run a real
Spotify OAuth or Bearer-token smoke test.

## 8. Failed restore and rollback

If recovery worsens integrity, stop all services and switch back only to an
independently validated emergency recovery point. Repeat the full ledger
preservation, restore, reconciliation, migration, dump-validation, socket, and
policy-lock gates.

Binary rollback alone does not undo a database restore. Never roll the ledger
back merely to match a primary timestamp.

## 9. Closure

Complete a new soak and record database/dump identifiers, checksums, schema
versions, batch/aggregate reconciliation results, key IDs, artifact checksum,
operator approvals, alerts, and soak result. Do not attach dumps, row content,
URLs, callback data, request logs, headers, IP addresses, or credentials.
