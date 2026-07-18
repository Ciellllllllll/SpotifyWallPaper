# Cloudflare Worker Incident Response Runbook

## Scope

Use this runbook for security, privacy, availability, data-integrity, or cost
incidents affecting the public Spotify backend. Preview and production are
handled independently unless evidence shows shared Cloudflare account
compromise.

Never place any of the following in tickets, chat, screenshots, shell history,
metrics, or incident documents:

- Spotify Access or Refresh Token;
- Pairing Token;
- authorization code;
- OAuth state, browser nonce, or PKCE verifier;
- full OAuth callback URL;
- encryption or HMAC key;
- raw request URL or Authorization header; or
- D1 row export.

Record only timestamps, environment, Worker/version IDs, D1 bookmark IDs,
aggregate counts, status classes, route classes, and approved key IDs.
Invocation logs remain disabled. Do not enable them temporarily and do not use
`wrangler tail` on this Worker.

## Severity

- **SEV-1:** confirmed secret/key exposure, unauthorized account access,
  deletion rollback, production domain takeover, or uncontrolled cost.
- **SEV-2:** sustained auth/playback outage, D1 corruption, refresh storm,
  deletion reconciler backlog, or widespread false reauthorization.
- **SEV-3:** isolated user failure with no evidence of secret disclosure or
  persistent data loss.

Assign incident commander, security lead, operations lead, and communications
owner. Use a separate operator for command review on SEV-1.

## First 15 minutes

1. Declare severity and freeze production deployments.
2. Preserve the current Worker version ID and current D1 Time Travel bookmarks
   in the restricted incident record:

   ```powershell
   npx wrangler deployments list --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
   npx wrangler d1 time-travel info $env:CLOUDFLARE_PRIMARY_D1_NAME --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
   npx wrangler d1 time-travel info $env:CLOUDFLARE_DELETION_D1_NAME --env $env:CLOUDFLARE_DEPLOY_ENV --config $env:CLOUDFLARE_GENERATED_CONFIG
   ```

3. Inspect aggregate Analytics Engine and built-in Worker metrics only. Query
   by route class, status class, latency bucket, rate-limit class, refresh
   outcome, and cost counters.
4. For a suspected active compromise or destructive write, remove the
   production Custom Domain or route traffic to a pre-approved maintenance
   Worker in the Cloudflare dashboard. Keep the deletion ledger available to
   responders.
5. Revoke compromised Cloudflare API tokens and sessions through Cloudflare's
   account controls. Do not paste replacement credentials into this repository.
6. If integrity is uncertain, do not run migrations, account cleanup, or code
   rollback until bookmarks are recorded.

## Incident classification and containment

### Pairing Token disclosure

For a single user, instruct the user to:

1. open the official setup page directly;
2. delete the backend account using the same-origin account-deletion action;
3. disconnect the app in Spotify account settings; and
4. reconnect to obtain a new Pairing Token.

Do not ask the user to send the token. Account deletion writes the
35-day tombstone before primary credential deletion.

For disclosure caused by a compromised Pairing HMAC key, delete every
credential referencing the compromised key through an approved, reviewed
administrative process, retain deletion tombstones, rotate the keyring, and
require new Pairing Tokens. Reauthorization alone does not rotate Pairing
digests.

### Spotify token or encryption-key disclosure

Immediately:

1. rotate token-encryption keys using the emergency path in the key-rotation
   runbook;
2. disconnect affected authorizations through Spotify;
3. force affected credentials to reauthorize; and
4. remove token ciphertext and active refresh leases.

For a confirmed environment-wide disclosure, this fixed SQL invalidates all
live Spotify tokens without exposing row data:

```powershell
npx wrangler d1 execute $env:CLOUDFLARE_PRIMARY_D1_NAME --remote `
  --command "UPDATE credentials SET auth_status = 'reauth_required', refresh_token_ciphertext = NULL, refresh_token_nonce = NULL, refresh_token_key_id = NULL, access_token_ciphertext = NULL, access_token_nonce = NULL, access_token_key_id = NULL, access_token_expires_at_ms = NULL, refresh_lease_id = NULL, refresh_lease_until_ms = NULL, token_version = token_version + 1, updated_at_ms = CAST(unixepoch() AS INTEGER) * 1000;" `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG
```

Verify only aggregate status:

```powershell
npx wrangler d1 execute $env:CLOUDFLARE_PRIMARY_D1_NAME --remote `
  --command "SELECT auth_status, COUNT(*) AS row_count FROM credentials GROUP BY auth_status;" `
  --env $env:CLOUDFLARE_DEPLOY_ENV `
  --config $env:CLOUDFLARE_GENERATED_CONFIG
```

All affected users must complete a new Spotify authorization. Do not attempt to
recover or reuse exposed tokens.

### OAuth-state or callback handling compromise

1. Rotate `OAUTH_STATE_HMAC_KEY` interactively.
2. Delete all `oauth_sessions`.
3. Keep invocation logs disabled.
4. Require users with in-flight setup to restart from `/setup`.
5. Verify callback responses contain no code, state, callback URL, or exception
   text.

### Deletion failure or restored deleted accounts

1. Stop public traffic.
2. Do not restore the deletion-ledger D1 to an older point unless that ledger
   itself is corrupt.
3. Follow the restore runbook to reset `reconciled_at_ms`, replay every
   tombstone in batches of 100, and verify zero pending rows before resuming
   traffic.
4. Confirm the scheduled reconciler aggregate shows success and no growing
   backlog.
5. Notify affected users to disconnect the app in Spotify if token exposure is
   possible.

### Abuse, refresh storm, or cost incident

1. Confirm the 50%, 80%, or 100% budget alert and identify the aggregate route
   and status classes causing growth.
2. Keep Cloudflare Rate Limiting bindings enabled. Do not increase limits
   during the incident.
3. Confirm Spotify `Retry-After` backoff is being honored by Client ID.
4. If spend is uncontrolled, remove the Custom Domain or use the maintenance
   Worker.
5. Review Worker request/CPU, D1 rows read/written, Analytics Engine data
   points, and Spotify refresh outcome counts.
6. Treat per-location Rate Limiting as abuse mitigation, not a globally strict
   Spotify quota.
7. Before reopening public traffic, repeat the external zone-level WAF,
   shared-NAT, distributed invalid-token, authenticated-token, Spotify upstream,
   and Worker/D1/Analytics cost gates. Keep public traffic closed if any gate
   lacks current evidence.

## Investigation

Allowed evidence:

- Cloudflare account audit events;
- deployment and version metadata;
- D1 Time Travel bookmarks;
- migration lists;
- aggregate Analytics Engine data;
- built-in request/error/CPU metrics; and
- aggregate D1 counts grouped by status or key ID.

Forbidden evidence:

- invocation/request logs;
- raw callback or request URLs;
- browser history exports;
- Authorization headers;
- raw D1 exports; and
- screenshots containing setup success tokens.

If a diagnostic tool would collect a forbidden field, do not run it. Reproduce
in preview with synthetic credentials and fixed secret-free errors instead.

## Recovery

1. Apply the relevant key-rotation or restore runbook.
2. Run both D1 `migrations list` gates and confirm no unapplied migration.
3. Deploy or roll back only with a reviewed generated config.
4. Run secret-free health, setup, malformed-token 401, OAuth, playback,
   control, reauthorization, deletion, and reconciler smoke tests.
5. Confirm invocation logs are still disabled in the deployed version.
6. Verify aggregate alerts and the 50%, 80%, and 100% budget alerts deliver to
   at least two maintainers.
7. Resume a limited production beta before restoring normal traffic.

## User communication

State what capability is affected and whether reauthorization, account
deletion, Spotify disconnect, or a new Pairing Token is required. Never include
or request a token, callback URL, Client ID, or key.

For confirmed credential exposure:

- explain that existing backend authorization was invalidated;
- require Spotify-side disconnect and reauthorization;
- require account deletion/reconnect when Pairing authentication was affected;
  and
- provide the official setup origin as a plain origin, not a callback link.

## Closure and soak

The incident remains open until:

- containment and invalidation are verified;
- D1 and deletion-ledger consistency gates pass;
- no forbidden data was persisted in metrics or artifacts;
- aggregate error, refresh, rate-limit, reconciliation, and cost metrics return
  to baseline;
- Security and Operations reviewers approve recovery; and
- a new 72-hour Wallpaper Engine soak completes.

The soak must include playback state changes, Access Token refresh, Spotify
429, backend outage, D1 failure, reauthorization, account deletion, cron
reconciliation, Worker deploy, and Wallpaper Engine restart. Any material auth,
crypto, persistence, CORS, binding, or origin fix restarts the 72-hour clock.

## References

- [Cloudflare Worker observability](https://developers.cloudflare.com/workers/observability/)
- [Cloudflare usage-based billing](https://developers.cloudflare.com/billing/understand/usage-based-billing/)
- [Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
