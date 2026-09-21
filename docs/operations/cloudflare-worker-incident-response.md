> Archived on 2026-09-21: the hosted backend has been retired. This is historical evidence, not a current deployment procedure or active service agreement. See `docs/25-public-backend.md`.

# Public Backend VPS Incident Response Runbook

> The filename is retained temporarily for path compatibility. This is the
> current Node.js/PostgreSQL/Caddy/OAuth2 Proxy response procedure.

## Scope and evidence rules

Use this runbook for security, privacy, availability, integrity, deletion,
backup, certificate, host, or cost incidents affecting the public backend.
Production remains `SPOTIFY_MODE=policy_locked` unless a later separately
approved specification says otherwise.

Never place these in tickets, chat, screenshots, shell history, metrics,
journal excerpts, mail, or incident documents:

- Spotify Access/Refresh Token or Pairing Token;
- authorization code, OAuth state, PKCE verifier, or callback data;
- URL, query string, header, Cookie, Client ID, IP address, or `publicId`;
- encryption/HMAC/session key or systemd credential;
- PostgreSQL row/export/dump content; or
- raw exception/upstream response text.

Record only timestamps, release ID/checksum, fixed service/database names,
component versions, migration IDs, backup checksums, key IDs, fixed event and
status classes, aggregate counts, and approvals. Caddy/OAuth2 Proxy
request/auth/access logs remain disabled. Node emits fixed events/counts only;
do not enable more verbose logging during an incident.

## Severity

- **SEV-1:** confirmed key/credential exposure, unauthorized admin access,
  lost deletion tombstone, restored deleted account, host takeover, or
  uncontrolled public exposure/cost.
- **SEV-2:** sustained outage, PostgreSQL corruption, failed backup validation,
  reconciliation backlog, socket boundary failure, or widespread false
  reauthorization.
- **SEV-3:** isolated fixed-outcome failure without disclosure or persistent
  data-loss evidence.

Assign incident commander, security lead, operations lead, and communications
owner. A second operator reviews every destructive SEV-1 command.

## First 15 minutes

1. Declare severity and freeze releases, migrations, rotations, and restores.
2. Confirm the fixed production origin still returns the policy-lock 503 for
   all `/setup`, `/auth/*`, and `/api/*` routes.
3. If routing, host, or integrity is uncertain, stop Caddy public traffic and
   the Node service. Preserve the deletion-ledger database.
4. Record current release checksum, installed component versions, both schema
   versions, latest independent backup metadata, timer states, socket
   ownership/modes, and aggregate ledger backlog.
5. Preserve systemd/Caddy/OAuth2 Proxy configuration checksums and approved
   fixed-event counters. Do not collect request logs.
6. Revoke compromised host/operator credentials using provider controls and
   install replacements only through the secret manager/systemd credential
   path.
7. If data integrity is uncertain, do not migrate, clean rows, rotate keys, or
   roll back until both databases and deletion history are accounted for.

## Classification and containment

### Unexpected Spotify-route behavior

Any allowed Spotify route/method returning other than the fixed no-store 503,
or any unlisted method/path reaching Node, is SEV-1. Stop Caddy and Node,
preserve configuration checksums, and verify `SPOTIFY_MODE=policy_locked` without printing its
environment file. Check that `synthetic_test` is not installed in a
production unit and no Node TCP listener exists.

### Socket or admin-boundary failure

Stop traffic if a route works on the wrong socket, a trailing-slash variant is
accepted, Caddy can reach the admin socket directly, OAuth2 Proxy admits an
unapproved identity, or socket modes are broader than tracked configuration.
Restore the reviewed unit/proxy configuration; do not chmod/chown ad hoc.

### Pairing or Spotify credential disclosure

Production should have no live public-backend credential. If dormant or
restored data is affected, keep traffic closed. For Pairing compromise,
ledger-first delete affected credentials and require new Pairing Tokens only
after a future approved unlock. For Spotify token/encryption-key compromise,
rotate with the emergency key procedure, clear affected ciphertext/leases,
mark reauthorization required, and disconnect affected Spotify authorization.
Never ask a user to send a credential.

### OAuth/callback compromise

Rotate the OAuth-state key, delete all OAuth sessions through the approved
maintenance transaction, revoke OAuth2 Proxy operator sessions if applicable,
and verify old synthetic callbacks receive fixed rejection. Production policy
lock must reject the callback before Cookie/database access.

### Database corruption, deletion failure, or restore regression

Stop traffic and follow the restore runbook. Credential recovery is allowed
only for primary-only loss while the current live deletion ledger remains
healthy. Replay every retained tombstone and require pending count zero before
reopening even locked proxy traffic. Ledger-only, combined-database, cluster,
or backup-only loss restores no OAuth or credential state and requires every
user to authorize again.

### Backup, disk, or timer failure

Stop promotion. Check only fixed metadata: unit/timer state, backup timestamp,
size/checksum, isolated validation result, disk/inode percentage, and
database/migration identifier. Never open a dump to collect incident evidence.
Repair capacity or scheduling, then produce and validate a new independent
dump for each database.

### Abuse or cost incident

Because production Spotify routes are locked before rate limiting/database
access, unexpected application cost indicates routing, health-check, host, or
configuration failure. Stop public traffic if cost is uncontrolled. Use fixed
service counters and provider billing totals only; do not enable access logs
or collect IP addresses.

## Investigation

Allowed evidence:

- systemd unit/timer state and configuration checksums;
- artifact checksum and component versions;
- PostgreSQL schema versions and aggregate status/key-ID counts;
- independent backup timestamps, sizes, checksums, and validation outcomes;
- socket file ownership/mode and local listener inventory;
- certificate lifetime and DNS record state;
- fixed Node outcome counters and secret-free Postfix delivery outcomes; and
- provider account audit/billing events that contain no prohibited request
  data.

If a tool would collect a URL, query, header, callback, identity token, IP,
row, dump content, or secret, do not run it. Reproduce with synthetic input in
an externally unreachable environment.

## Recovery

1. Apply the relevant key-rotation or restore runbook.
2. Verify exact migrations for both PostgreSQL databases.
3. produce and independently validate new dumps;
4. deploy or roll back only a checksum-verified artifact;
5. verify public/admin socket route matrices, permissions, and absence of a
   Node TCP listener;
6. run DB-independent health plus the complete early policy-lock matrix;
7. confirm Caddy/OAuth2 Proxy logging is disabled and Node events are fixed;
8. verify local readiness and every alert-delivery path; and
9. complete the required soak while real Spotify traffic remains prohibited.

## Communication and closure

Communicate only affected capability, time range, safe user action, and
whether a future reauthorization/deletion/disconnect would be required. Give
the official origin as a plain origin only; never publish a callback link or
request a token.

Close only after containment, independent database/backup validation,
ledger reconciliation, socket/policy-lock verification, alert recovery,
Security/Operations approval, and the new soak are recorded. A material auth,
crypto, persistence, route, socket, proxy, origin, or logging fix restarts the
soak and requires updated review.
