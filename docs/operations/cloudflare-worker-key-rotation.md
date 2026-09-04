# Public Backend VPS Key Rotation Runbook

> The filename is retained temporarily for path compatibility. These
> instructions apply to the Node.js/PostgreSQL VPS backend.

## Scope and invariants

Production remains `SPOTIFY_MODE=policy_locked` throughout rotation. Rotate in
an externally unreachable synthetic environment first. Never reuse material
between environments or between:

- Spotify token AES-256-GCM encryption;
- Pairing Token HMAC-SHA-256;
- OAuth state/browser binding HMAC; and
- OAuth2 Proxy session encryption.

Key values live only in the approved secret manager and root-owned systemd
credentials. Never print, export, diff, log, paste into a command line, store
in `.env`, or attach them to an incident. Record only key IDs, release ID,
timestamps, aggregate row counts, and reviewer approvals.

Stop Caddy/OAuth2 Proxy request/auth/access logging from the start; it must
remain disabled. Node logs fixed events/counts only.

## Rotation model

Token-encryption keyrings support active and previous keys. A read made with a
previous key may lazily decrypt and re-encrypt with the active key. The old key
remains available while any live row or retained backup can reference its key
ID.

Pairing-HMAC rotation cannot rewrite an existing digest because the Pairing
secret is not stored. New credentials use the new active key. The old key
remains until its aggregate row count reaches zero through deletion/reconnect
or approved expiry cleanup.

OAuth-state HMAC rotation invalidates every in-flight synthetic OAuth session.
OAuth2 Proxy session-key rotation is independent and must follow that
component's active/previous-key compatibility and force-login procedure.

## Planned token-encryption rotation

1. Create a new independent 32-byte CSPRNG AES key in the secret manager.
2. Assign a non-secret unique key ID.
3. update the root-owned systemd credential containing the keyring so it holds
   old and new keys while the old key remains active;
4. restart the Node service and verify policy-lock behavior;
5. in externally unreachable `synthetic_test`, verify existing synthetic
   ciphertext decrypts and new synthetic OAuth/refresh writes succeed;
6. switch the active ID to the new key and restart;
7. query only aggregate counts grouped by token/verifier key ID in
   `spotify_wallpaper`; and
8. complete the required synthetic soak before production credential update.

Do not scan, export, or decrypt row contents to accelerate rotation. Lazy
rewrite is traffic-driven. Production policy lock must not access rows merely
for rotation.

## Planned Pairing-HMAC rotation

1. Create a new independent CSPRNG HMAC key and key ID.
2. install an old-plus-new keyring while the old ID remains active;
3. restart and verify the complete policy-lock matrix;
4. switch the active ID to the new key;
5. in externally unreachable synthetic tests, verify a new credential uses
   the new ID and an existing synthetic credential still authenticates; and
6. query only aggregate credential counts grouped by Pairing key ID.

Keep the old key until its count is zero and every retained backup that can
reintroduce the old digest has expired or has an escrowed key. Reauthorization
does not change Pairing identity or digest.

## OAuth-state HMAC rotation

1. schedule interruption of synthetic setup tests;
2. install the new independent HMAC value through a root-owned systemd
   credential;
3. use the approved local maintenance transaction to delete every
   `oauth_sessions` row in `spotify_wallpaper`;
4. restart Node;
5. verify an old synthetic callback receives a fixed rejection and a new
   synthetic session completes; and
6. verify no callback, state, verifier, Client ID, header, or exception text
   entered logs.

Production policy-lock requests must remain identical before and after this
rotation and must not parse a callback Cookie.

## OAuth2 Proxy session-key rotation

Rotate OAuth2 Proxy credentials separately from application keys:

1. put the admin path into maintenance;
2. install the reviewed active/previous session-key configuration without
   printing it;
3. validate configuration and restart OAuth2 Proxy;
4. require a new operator login if compatibility cannot be preserved;
5. verify only the approved operator identity reaches the admin proxy path;
   and
6. confirm request/auth/access logging remains disabled.

This does not unlock Spotify routes and does not justify changing Node socket
permissions.

## Retirement criteria

Remove an old encryption key only when:

- token and OAuth-session aggregate counts for the key ID are zero;
- the synthetic soak and rollback window pass;
- no unresolved fixed decryption/refresh outcome exists; and
- the key remains recoverable for every retained backup that can reference it.

Remove an old Pairing key only when:

- its aggregate Pairing-digest count is zero;
- the soak and rollback window pass; and
- no retained backup can restore a digest without the escrowed key.

After retirement, repeat the two independent database backup/validation gates,
policy-lock matrix, socket checks, and local readiness checks.

## Rollback and emergency compromise

For a normal regression, restore the old-plus-new keyring and prior active ID,
restart, and repeat aggregate checks. Do not roll back either PostgreSQL
database just to undo key configuration.

For suspected disclosure:

- encryption key: rotate immediately, use the reviewed maintenance transaction
  to mark affected rows `reauth_required`, clear token ciphertext/leases, and
  preserve ledger safety;
- Pairing HMAC key: ledger-first delete every affected credential and require
  a new Pairing Token after any future approved unlock;
- OAuth-state key: rotate and delete all OAuth sessions;
- OAuth2 Proxy key: rotate, revoke operator sessions, and reverify the admin
  boundary.

Follow the incident-response runbook. Keep traffic policy-locked and never
attempt to recover or reuse exposed credentials.
