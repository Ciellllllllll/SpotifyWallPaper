# Cloudflare Worker D1 Restore Runbook

## Safety model

The public backend uses two independent D1 databases:

- **primary:** OAuth sessions, encrypted Spotify tokens, Pairing HMAC digests,
  refresh leases, and Spotify backoff;
- **deletion ledger:** 35-day tombstones used to prevent a primary restore from
  resurrecting deleted accounts.

Restore the primary database without rolling the deletion ledger backward.
After any primary restore, replay every retained tombstone before public traffic
resumes. The Worker reconciler processes at most 100 unreconciled tombstones per
scheduled run and marks each row only after primary data deletion succeeds.

D1 Time Travel overwrites a database in place and cancels in-flight queries.
Workers Paid retains up to 30 days of Time Travel history; the deletion ledger
retains tombstones for 35 days to cover that restore window.

## Required operator variables

Supply values from the deployment inventory or restricted incident record:

```text
CLOUDFLARE_DEPLOY_ENV
CLOUDFLARE_GENERATED_CONFIG
CLOUDFLARE_PRIMARY_D1_NAME
CLOUDFLARE_DELETION_D1_NAME
CLOUDFLARE_PRIMARY_RESTORE_BOOKMARK
CLOUDFLARE_DELETION_RESTORE_BOOKMARK
CLOUDFLARE_PREVIEW_PUBLIC_BASE_URL
CLOUDFLARE_PRODUCTION_PUBLIC_BASE_URL
```

Use the environment-prefixed public base URL matching
`CLOUDFLARE_DEPLOY_ENV`. Do not create or rely on an unprefixed
`CLOUDFLARE_PUBLIC_BASE_URL` generator input.

`CLOUDFLARE_DELETION_RESTORE_BOOKMARK` is used only when the deletion ledger
itself is corrupt. Do not set or use it for an ordinary primary restore.

Do not place bookmark values in the repository. Bookmarks are operational
metadata and belong in the restricted incident record.

## 1. Stop traffic and preserve recovery points

1. Freeze deployments.
2. Remove the affected Custom Domain or route it to the pre-approved
   maintenance Worker in the Cloudflare dashboard.
3. Confirm account-deletion actions are also unavailable so no new tombstone is
   written while restore sequencing is undecided.
4. Record current Worker version and both current bookmarks:

   ```powershell
   npx wrangler deployments list --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
   npx wrangler d1 time-travel info $env:CLOUDFLARE_PRIMARY_D1_NAME --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
   npx wrangler d1 time-travel info $env:CLOUDFLARE_DELETION_D1_NAME --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
   ```

The restore command returns a bookmark that can undo the restore. Record it
outside the repository before continuing.

## 2. Validate the target

Confirm:

- the selected bookmark precedes the corrupt write but is no older than the
  available Time Travel window;
- the database reports the production D1 storage backend;
- the generated config points to the intended environment's two database IDs;
- the deletion ledger contains the complete period from the selected primary
  bookmark through the incident; and
- required old encryption/HMAC keys remain available in offline escrow if the
  restored rows reference them.

Inspect database metadata:

```powershell
npx wrangler d1 info $env:CLOUDFLARE_PRIMARY_D1_NAME --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
npx wrangler d1 info $env:CLOUDFLARE_DELETION_D1_NAME --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
```

Do not export either database for inspection.

## 3. Restore the primary database

This command is destructive. A second operator must verify the environment,
database name, and bookmark before confirmation:

```powershell
if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_PRIMARY_RESTORE_BOOKMARK)) {
  throw 'Primary restore bookmark is required.'
}
npx wrangler d1 time-travel restore $env:CLOUDFLARE_PRIMARY_D1_NAME `
  --bookmark $env:CLOUDFLARE_PRIMARY_RESTORE_BOOKMARK `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG
```

Do not resume traffic. Do not restore the deletion ledger as part of this step.

## 4. Reapply schema gates

List and apply migrations for both bindings, then require a clean second list:

```powershell
npx wrangler d1 migrations list DB --remote --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
npx wrangler d1 migrations apply DB --remote --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
npx wrangler d1 migrations list DB --remote --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG

npx wrangler d1 migrations list DELETION_DB --remote --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
npx wrangler d1 migrations apply DELETION_DB --remote --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
npx wrangler d1 migrations list DELETION_DB --remote --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
```

Both final lists must report no unapplied migrations.

## 5. Reset deletion reconciliation checkpoints

Reset every retained tombstone and its retry telemetry, including rows
reconciled before the restore:

```powershell
npx wrangler d1 execute $env:CLOUDFLARE_DELETION_D1_NAME --remote `
  --command "UPDATE deletion_tombstones SET reconciled_at_ms = NULL, reconciliation_attempts = 0, last_attempt_at_ms = NULL;" `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG
```

Count pending rows:

```powershell
npx wrangler d1 execute $env:CLOUDFLARE_DELETION_D1_NAME --remote `
  --command "SELECT COUNT(*) AS pending FROM deletion_tombstones WHERE reconciled_at_ms IS NULL;" `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG
```

The reset must occur after primary restore and before any traffic resumes.

## 6. Complete 100-row reconciliation batches

The production cron invokes the same reconciler used by account deletion. Each
run processes at most 100 rows ordered by `public_id`. Keep traffic closed and
wait for the configured scheduled run. Cron changes can take up to 15 minutes
to propagate, so do not change the schedule during an incident.

After each scheduled run, repeat:

```powershell
npx wrangler d1 execute $env:CLOUDFLARE_DELETION_D1_NAME --remote `
  --command "SELECT COUNT(*) AS pending FROM deletion_tombstones WHERE reconciled_at_ms IS NULL;" `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG

npx wrangler d1 execute $env:CLOUDFLARE_DELETION_D1_NAME --remote `
  --command "SELECT COUNT(*) AS reconciled FROM deletion_tombstones WHERE reconciled_at_ms IS NOT NULL;" `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG
```

Expected behavior:

- `pending` decreases by no more than 100 per successful scheduled run;
- a failed primary deletion leaves that tombstone pending;
- rerunning a batch is idempotent; and
- expired tombstones are removed only after they are reconciled.

Do not resume traffic until `pending` is exactly zero. Confirm the Analytics
Engine scheduled-reconciler aggregate reports success for every required batch.
For more than 100 tombstones, continue scheduled runs until all batches finish;
do not assume the first run completed the restore.

## 7. Validate restored data

Use aggregate-only queries:

```powershell
npx wrangler d1 execute $env:CLOUDFLARE_PRIMARY_D1_NAME --remote `
  --command "SELECT auth_status, COUNT(*) AS row_count FROM credentials GROUP BY auth_status;" `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG

npx wrangler d1 execute $env:CLOUDFLARE_PRIMARY_D1_NAME --remote `
  --command "SELECT refresh_token_key_id, COUNT(*) AS row_count FROM credentials GROUP BY refresh_token_key_id;" `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG

npx wrangler d1 execute $env:CLOUDFLARE_PRIMARY_D1_NAME --remote `
  --command "SELECT pairing_key_id, COUNT(*) AS row_count FROM credentials GROUP BY pairing_key_id;" `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG
```

If a restored row references a retired key ID, restore that key from offline
escrow to the live keyring before smoke testing. Never rewrite a key ID to make
the row appear current.

## 8. Deletion-ledger restore exception

Restore the deletion ledger only when it is independently corrupt and no
newer healthy copy exists. Before restoring it:

1. preserve every known deletion after the target bookmark in a restricted
   incident record without Pairing Tokens;
2. stop all setup and account-deletion traffic;
3. require Security and Operations approval; and
4. record the current ledger bookmark for undo.

Then:

```powershell
if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_DELETION_RESTORE_BOOKMARK)) {
  throw 'Deletion-ledger restore bookmark is required.'
}
npx wrangler d1 time-travel restore $env:CLOUDFLARE_DELETION_D1_NAME `
  --bookmark $env:CLOUDFLARE_DELETION_RESTORE_BOOKMARK `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG
```

Reinsert every post-bookmark deletion through the approved tombstone-writing
procedure, reapply ledger migrations, reset all `reconciled_at_ms` values, and
run every 100-row batch to `pending = 0`. If any post-bookmark deletion cannot
be proven present, do not resume traffic; invalidate the potentially affected
credentials and require account deletion/reconnect.

## 9. Smoke and resume

Before restoring the Custom Domain:

- `/health` returns the expected service value;
- `/setup` returns without cached or secret-bearing content;
- malformed Bearer authentication returns fixed 401;
- a synthetic preview credential can authorize and refresh;
- existing credentials using active/previous keys can decrypt;
- reauthorization works without changing Pairing identity;
- account deletion writes the ledger first;
- `pending` remains zero; and
- invocation logs remain disabled.

Restore traffic as a limited beta and monitor aggregate status, refresh,
rate-limit, reconciliation, D1, and cost metrics.

## 10. Roll back the restore

If the restore worsens integrity, stop traffic again and restore the primary to
the pre-restore bookmark returned by Cloudflare:

```powershell
if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_PRIMARY_UNDO_BOOKMARK)) {
  throw 'Primary undo bookmark is required.'
}
npx wrangler d1 time-travel restore $env:CLOUDFLARE_PRIMARY_D1_NAME `
  --bookmark $env:CLOUDFLARE_PRIMARY_UNDO_BOOKMARK `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG
```

Repeat migration gates, `reconciled_at_ms` reset, every 100-row batch, and all
smoke tests. A Worker code rollback alone does not undo D1 restoration.

## 11. Post-restore soak

Complete a new 72-hour Wallpaper Engine soak before normal traffic or release.
Cover playing, paused, stopped, Access Token refresh, Spotify 429,
`invalid_grant`, reauthorization, deletion, scheduled reconciliation, Worker
deploy, backend outage, D1 failure, and Wallpaper Engine restart.

Document bookmark IDs, aggregate counts, batch count, migration names, Worker
version, reviewer approvals, and soak result. Do not attach D1 exports, request
logs, callback URLs, or secret values.

## References

- [D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
