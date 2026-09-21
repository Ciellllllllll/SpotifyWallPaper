# Public Backend

## Status and purpose

The standard product now uses static GitHub Pages authorization followed by
direct Spotify requests from Wallpaper Engine. This document governs the
retained optional backend only. It is not a prerequisite for normal build,
authentication, playback, or token refresh. Migration does not unlock this
service or authorize deployment, shutdown, token extraction, or data deletion.

The optional public backend is a Node.js 22 ESM service on a Linux VPS. It
runs behind Caddy and OAuth2 Proxy, persists encrypted credential state in
PostgreSQL 17, and preserves the wallpaper's normalized playback/control
contract without placing Spotify Access or Refresh Tokens in Wallpaper
Engine.

The fixed production origin is:

`https://ciel-spotify-wallpaper.duckdns.org`

No alternate production hostname may be selected automatically. Production
is complete only in `SPOTIFY_MODE=policy_locked`; Spotify-connected setup and
API traffic are intentionally unavailable. The locked VPS deployment and the
dormant hardened OAuth implementation are separate acceptance lines. Neither
authorizes real Spotify traffic.

Browser mock, legacy direct, and loopback Rust modes remain independent. The
public backend must never become required for wallpaper startup.

## Runtime boundary

The production stack is:

- Caddy for TLS and exact external routing;
- OAuth2 Proxy for operator authentication on the admin route family;
- one Node.js 22 ESM process listening only on two permission-separated
  AF_UNIX sockets;
- PostgreSQL 17 with two independently operated databases; and
- systemd units and timers for service lifecycle, migrations, backup,
  validation, deletion reconciliation, and readiness checks.

Node must not open a TCP listener in production. The public and admin sockets
have separate owning groups and modes. Caddy can reach the public socket.
OAuth2 Proxy and the authenticated admin proxy path can reach the admin
socket. A future Spotify unlock requires a separately reviewed systemd
unit/network change as well as an application-mode change.

The Node service owns HTTP routing, dormant OAuth PKCE, encrypted persistence,
Pairing Token verification, refresh coordination, Spotify proxying,
reauthorization, and ledger-first deletion. It does not render, process audio,
mutate the DOM, replace shared playback normalization, or own Rust/WASM visual
logic.

## Modes and fail-closed startup

Exactly two application modes are recognized:

- `policy_locked`: the only production mode;
- `synthetic_test`: non-production testing with synthetic credentials and no
  externally reachable listener.

An absent or unknown `SPOTIFY_MODE` fails startup. Production service units
set `SPOTIFY_MODE=policy_locked`. `synthetic_test` must not be reachable
through Caddy, OAuth2 Proxy, a public TCP port, or a production socket.

Locked startup reads only `SPOTIFY_MODE`, `PUBLIC_SOCKET_PATH`, and
`ADMIN_SOCKET_PATH`; it does not parse database or Spotify-related secrets.
`synthetic_test` additionally requires `PUBLIC_BASE_URL`, `PG_SOCKET_DIR`, the
OAuth/encryption/Pairing key settings, current legal versions, and explicit
`SYNTHETIC_AUTHORIZE_ENDPOINT`, `SYNTHETIC_TOKEN_ENDPOINT`, and
`SYNTHETIC_PLAYBACK_ENDPOINT` values. Those three endpoints must be HTTPS and
must not use `accounts.spotify.com` or `api.spotify.com`. PostgreSQL identity is
fixed to the peer-authenticated `swp_backend` role, port `5433`, and the two
specified database names.

In `policy_locked`, every exact Spotify route/method in the socket tables below
returns the same fixed `503` response with `Cache-Control: no-store`. This
includes `GET /auth/callback`. Node selects the response before reading or
parsing:

- request body;
- Cookie or Authorization headers;
- database state;
- rate-limit state;
- random bytes;
- clock-dependent OAuth state; or
- any outbound network.

The fixed response contains no user-controlled data and does not redirect.
Wrong methods, wrong sockets, unknown paths, and trailing-slash variants are
rejected before the policy lock. Changing the route order so any listed input
is inspected first for an allowed Spotify route is a security regression.

## Exact socket route tables

Paths are exact. Trailing-slash variants are distinct and rejected. A route
that exists on one socket is rejected on the other socket.

### Public socket

| Method | Exact path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | DB-independent process liveness |
| `GET` | `/privacy` | Current Privacy Notice |
| `GET` | `/terms` | Current EULA |
| `GET` | `/auth/callback` | Dormant Spotify callback |
| `GET` | `/api/playback` | Normalized playback |
| `POST` | `/api/control` | Normalized control command |
| `DELETE` | `/api/account` | Ledger-first account deletion |
| `OPTIONS` | `/api/playback` | Fixed CORS preflight |
| `OPTIONS` | `/api/control` | Fixed CORS preflight |

### Admin socket

| Method | Exact path | Purpose |
| --- | --- | --- |
| `GET` | `/setup` | Operator-authenticated setup page |
| `POST` | `/auth/start` | Start dormant PKCE authorization |
| `GET` | `/auth/confirm` | Read confirmation state |
| `POST` | `/auth/confirm` | Confirm authorization completion |
| `POST` | `/auth/reauthorize` | Start dormant reauthorization |

Wrong socket, path, or method is rejected with a fixed response. Node does not
add a general fallback route, directory redirect, automatic `HEAD`, or
trailing-slash normalization. Caddy and OAuth2 Proxy must preserve the exact
method/path and must not expose another Node route.

`GET /health` reports process liveness without querying PostgreSQL, migrations,
backups, Spotify, or DNS. Database connectivity, migration state, backup
freshness, dump validation, disk capacity, and reconciliation readiness are
local maintenance checks and systemd timer results. They are not exposed as
another public or admin HTTP readiness route.

## Reverse proxy and origin

Caddy accepts HTTPS only for
`https://ciel-spotify-wallpaper.duckdns.org`. It forwards only the exact public
socket method/path table, the exact admin method/path table through OAuth2
Proxy, and the reviewed `GET` OAuth2 endpoints. It returns 404 for every other
method/path. Node enforces the identical socket allowlists and the early policy
lock, so bypassing Caddy cannot unlock a route. Automatic HTTP redirects are
disabled and the VPS/provider firewall denies inbound TCP 80; only TCP 443 is
opened for the public origin.

OAuth2 Proxy admits only GitHub user `Ciellllllllll` before forwarding an
admin route to the admin socket. Its externally reachable infrastructure
endpoints are limited to `GET /oauth2/sign_in`, `/oauth2/start`,
`/oauth2/callback`, `/oauth2/sign_out`, and `/oauth2/static/<asset>`.
`/oauth2/auth`, `userinfo`, `ping`, `ready`, `metrics`, and every other OAuth2
Proxy path are not externally exposed. Authentication may complete while
policy locked, but Node still returns the fixed 503 for the authenticated
Spotify setup route.

Caddy and OAuth2 Proxy request, access, and authentication logs are disabled.
Neither layer records URLs, query strings, headers, callback data, Client ID,
IP address, or credentials. Deployment and smoke commands must also avoid
verbose output and must never print the environment.

CORS applies only to `/api/playback` and `/api/control`. It permits exactly
`Origin: null` and `http://127.0.0.1:5173`; methods are the route method plus
`OPTIONS`, request headers are limited to `authorization` and `content-type`,
and `authorization` is required. Cookie credentials are disabled. A valid
preflight reads no body, database, credential, or rate-limit state. Invalid or
duplicate requested headers, methods, and origins receive a fixed rejection.

`DELETE /api/account` is not a CORS route. It requires the exact public HTTPS
origin in both request URL and `Origin`, and rejects missing Origin and
`Origin: null`. Wallpaper requests use `redirect: 'error'`,
`credentials: 'omit'`, and `referrerPolicy: 'no-referrer'`. A packaged
Wallpaper Engine build trusts only the exact release origin. Arbitrary HTTPS
origins, redirects, user information, non-standard ports, paths, queries, and
fragments never receive a Pairing Token. An invalid backend configuration
fails closed and never silently falls back to direct credentials.

## Dormant OAuth protocol

The hardened OAuth path is specified for `synthetic_test` acceptance only.
It uses each user's public Spotify Client ID, Authorization Code with PKCE,
fixed scopes, and no Client Secret. A real Spotify endpoint, credential, or
account is prohibited while production remains locked.

OAuth state is single-use and stored only as a keyed digest. The PKCE verifier
is encrypted and expires within ten minutes. Redirect URI and scopes are fixed
by the backend. Authorization codes, full callback URLs, raw state, and PKCE
verifiers are never logged or placed in another URL.

The hardened protocol uses exact, mutually exclusive values:

```text
setup proof       swps2.<sessionId>.<expiresAtMs>.<signature>
OAuth state       swpo2.<43-character-base64url-random>
confirmation      swpc1.<confirmationId>.<expiresAtMs>.<signature>
```

`sessionId` and `confirmationId` are canonical unpadded base64url encodings
of 128 random bits (22 characters). `expiresAtMs` is exactly 13 decimal ASCII
digits. Signatures are canonical unpadded 32-byte HMAC-SHA-256 values (43
characters). Exact UTF-8 HMAC inputs are:

```text
spotify-wallpaper:setup-session-v2:<sessionId>:<expiresAtMs>
spotify-wallpaper:oauth-confirm-v1:<confirmationId>:<expiresAtMs>
spotify-wallpaper:oauth-state-v2:<complete-swpo2-state-value>
spotify-wallpaper:setup-browser-v2:<setup-cookie-value>
spotify-wallpaper:setup-issuer-v2:<canonical-issuer>
spotify-wallpaper:oauth-browser-v2:<oauth-cookie-value>
spotify-wallpaper:oauth-confirm-browser-v1:<confirmation-cookie-value>
```

The setup/confirmation proof and browser/issuer/state digests use the OAuth
HMAC key, which is separate from encryption and Pairing HMAC keys. Parsers
require exact prefix, part count, canonical encoding, length, purpose, expiry,
and database protocol version. Proof verification uses Web Crypto verification
or an equivalent constant-time byte comparison after the pre-database rate
limit. There is no legacy parser, translation, or downgrade path.

Caddy removes every client-supplied `X-SWP-Client-IP` value and writes exactly
one value from its authenticated connection address. OAuth2 Proxy preserves
that Caddy-generated header without appending. Node trusts it only on its two
permission-separated sockets, rejects a missing, duplicate, comma-containing,
or malformed value, parses IPv4/IPv6 strictly, normalizes IPv4-mapped IPv6 to
IPv4, and encodes canonical issuer as `v4:` plus eight lowercase hex digits or
`v6:` plus 32 lowercase hex digits. The raw address is held only long enough
to parse and HMAC it; only the keyed issuer digest is a limiter/database key.
Raw and canonical addresses are never stored or logged.

Only these first-party cookies are permitted. Their values are each exactly a
canonical 43-character encoding of 32 random bytes, and duplicate names are
rejected:

- `__Host-swp-setup`: binds explicit Privacy/EULA consent to a setup browser;
- `__Host-swp-oauth-v2`: binds the top-level OAuth callback;
- `__Host-swp-confirm`: binds the post-callback confirmation step.

All are `HttpOnly`, `Secure`, host-only, have `Path=/`, omit `Domain`, and are
cleared when consumed. The setup cookie uses `SameSite=Strict` and
`Max-Age=600`. The OAuth and confirmation cookies use `SameSite=Lax` with
`Max-Age=600` and `Max-Age=300` respectively. Confirmation must be Lax so it
survives the first query-free top-level GET after the cross-site callback; that
GET is non-mutating. No tracking, analytics, compatibility, or legacy
`swpb_oauth` cookie is allowed. Production policy lock executes before Cookie
parsing or cookie emission.

`GET /setup` is rate-limited before PostgreSQL access. It creates a purpose-
bound, single-use, ten-minute setup row that stores only keyed browser/issuer
digests, legal versions, protocol version, and expiry. Under a transaction-
scoped advisory lock, presenting the exact live setup cookie retires its row
before the service enforces at most three live rows for that issuer and inserts
the replacement. Missing, malformed, or unmatched cookies cannot retire
another row. The signed proof is bound to the inserted session.

`POST /auth/start` is rate-limited before row lookup, requires the exact setup
cookie, signed proof, same-origin form, and current legal acceptance, and uses
one conditional delete/return operation to consume the matching session. A
missing cookie, cross-row proof/cookie, replay, expired row, or wrong protocol
creates no OAuth state. Terminal results clear the setup cookie.

The callback has three distinct paths:

1. Initial authorization with the exact OAuth cookie atomically consumes the
   matching OAuth row and may exchange its code once.
2. Initial authorization missing only that cookie atomically moves the OAuth
   row into a five-minute `callback_confirmations` row. The authorization code
   and re-encrypted verifier use separate AES-GCM fields/nonces/key IDs with
   exact AAD
   `spotify-wallpaper:oauth-confirm:v1:<confirmationId>:<spotifyClientId>:<fieldName>`,
   where `fieldName` is `authorizationCode` or `pkceVerifier`. It sets the
   confirmation cookie and returns `303` to query-free `/auth/confirm`; it does
   not exchange tokens or create a credential.
3. Reauthorization requires the original matching OAuth cookie, never creates
   a confirmation row, and preserves the Pairing identity.

`GET /auth/confirm` is rate-limited before PostgreSQL, requires exactly one
valid confirmation cookie, and performs no mutation. Its keyed cookie digest
must identify exactly one live row. The page contains only the signed `swpc1`
proof and current legal controls; no code, state, Client ID, row ID, or Pairing
data appears in its URL, script, or error.

`POST /auth/confirm` requires that same cookie, its exact proof, explicit user
action, same-origin form, and current legal acceptance. One conditional
`DELETE ... RETURNING` operation binds proof ID/expiry, confirmation-cookie
digest, protocol version, and live expiry to the same row. Only the returned
row may be decrypted and exchanged. Cross-row mismatch is non-consuming and
may retry with the correct pair. Success is single-use; other terminal results
clear the cookie. No database transaction is held across Spotify HTTPS.

The setup/confirmation pages use restrictive CSP, `Referrer-Policy:
no-referrer`, and `Cache-Control: no-store`. Initial authorization and
reauthorization both require the current Privacy Notice and EULA acceptance.
Consumed sessions are deleted atomically; abandoned expired sessions are
purged by local scheduled maintenance.

After a successful synthetic token exchange, the one-time response may show:

`swpb1.<publicId>.<secret>`

`publicId` contains at least 128 bits of CSPRNG entropy and `secret` contains
at least 256 bits. The complete token is at most 256 characters. It appears
only in the one-time no-store response and the Wallpaper Engine user property.
It never appears in a URL, Cookie, Web Storage, IndexedDB, log, metric,
database row, screenshot, fixture, or committed file.

PostgreSQL stores the `publicId`, digest-key ID, and a keyed HMAC-SHA-256
digest of the secret. Verification performs exact parsing and constant-time
comparison. Legacy `swpt1.` tokens are accepted only by direct mode and never
as public-backend Bearer credentials.

## PostgreSQL authority

PostgreSQL 17 uses exactly two databases:

- `spotify_wallpaper`: OAuth sessions, encrypted Spotify tokens, public Client
  ID, Pairing digest/key ID, refresh leases, backoff, and live credential
  state;
- `spotify_wallpaper_deletion_ledger`: non-secret `publicId` tombstones and
  reconciliation status retained for 35 days.

They use different least-privilege database roles. The Node runtime role has
only the statements required by the service. Migration, backup, restore, and
maintenance roles are separate. The service never relies on superuser access.

Each database has its own SQL migration stream. Migrations run as a separate
local operation before service restart; application startup does not mutate
schema. A migration failure, unexpected version, missing ledger database, or
failed reconciliation keeps traffic closed.

Both databases are independently dumped, validated with a temporary isolated
restore, and only then atomically retained under a backup-series name. A dump
that fails listing, checksum, isolated restore, the exact tracked migration
list, full schema/constraint/index/privilege comparison, unexpected-object
rejection, or fixed aggregate checks is deleted from its exact temporary path
and is never a recovery candidate. A successful primary dump is not evidence
that the ledger dump succeeded. Backup metadata contains only fixed names,
timestamps, sizes, checksums, and success/failure states.

There is no evidence of live D1 data. No D1 import utility or production data
conversion path is authorized. Historical Cloudflare plans and reports remain
evidence only.

## Encryption and refresh

Refresh and Access Tokens and stored PKCE verifiers use AES-256-GCM with a
fresh random 96-bit nonce per field. Token-encryption, Pairing-HMAC, and OAuth
state keys are independent secrets. Every ciphertext/digest stores a key ID.
The active/previous keyring supports lazy token re-encryption. A previous key
is not removed while a live row or retained backup can reference it.

Live Access/Refresh Token AAD is exact UTF-8
`spotify-wallpaper:v1:<recordId>:<spotifyClientId>:<fieldName>`, where
`recordId` is the credential public ID and `fieldName` is exactly
`access_token` or `refresh_token`. Row, Client-ID, and field swaps therefore
fail authentication. When refresh returns a new Refresh Token, Access and
Refresh ciphertext plus token version update atomically. If Spotify omits a
Refresh Token, the existing encrypted Refresh Token is retained.

Access-token refresh begins before expiry. A conditional PostgreSQL lease with
a unique lease ID, bounded expiry, and token version permits one refresh owner
per credential. Concurrent losers wait briefly and reload. Lease completion
requires the matching lease ID and token version. Spotify `invalid_grant`
clears token ciphertext, marks reauthorization required, releases the lease,
and stops retrying.

Spotify 429 handling stores bounded backoff by Client ID and honors a valid
`Retry-After`. Response bodies and headers are reduced to fixed internal
outcomes before logging or returning an error.

## Playback, controls, and provider behavior

`GET /api/playback`, `POST /api/control`, and `DELETE /api/account` use
`Authorization: Bearer <Pairing Token>` in the dormant protocol. Tokens never
appear in URLs. Playback returns the shared normalized provider-v1 model;
errors use fixed application codes/messages and never forward Spotify bodies.

Controls permit only the documented play, pause, previous, next, seek, volume,
shuffle, and repeat operations. Inputs are schema-validated, range-limited,
and sent to fixed Spotify endpoints. The backend never records or proxies
Spotify audio and never fetches lyrics.

Provider-v1 success and error envelopes are respectively:

```json
{ "ok": true, "value": {} }
```

```json
{
  "ok": false,
  "error": {
    "kind": "unauthorized",
    "message": "A fixed application message.",
    "status": 401,
    "retryAfterMs": 1000
  }
}
```

`retryAfterMs` is optional. No upstream body or secret is copied into the
envelope. Accepted command bodies contain exactly one of these shapes:

```json
{ "type": "play" }
{ "type": "pause" }
{ "type": "next" }
{ "type": "previous" }
{ "type": "seek", "positionMs": 0 }
{ "type": "volume", "volumePercent": 0 }
{ "type": "shuffle", "state": false }
{ "type": "repeat", "state": "off" }
```

`positionMs` is a finite integer from zero through the current item duration;
`volumePercent` is a finite integer from zero through 100; shuffle state is a
boolean; repeat state is exactly `off`, `track`, or `context`. Unknown or
missing fields, extra fields, unknown commands, non-integers, and out-of-range
values are rejected before a Spotify request.

The Wallpaper provider contract remains unchanged: mock, legacy direct,
loopback Rust, and backend providers normalize to the same playback model. In
production, backend requests receive the fixed policy-lock 503 and the
wallpaper keeps its last safe display/status. It does not downgrade to direct
mode, send a Pairing Token to another origin, or stop browser mock operation.

## Account deletion and restore safety

Account deletion is ledger-first:

1. verify the Pairing credential;
2. commit the non-secret `publicId` tombstone to
   `spotify_wallpaper_deletion_ledger`;
3. delete OAuth sessions, encrypted Spotify tokens, Client ID, Pairing digest,
   leases, backoff/cache, and live state from `spotify_wallpaper`;
4. return a fixed success only after the live credential is unusable.

Every authenticated request checks the ledger before using primary state. The
local reconciler processes retained tombstones independently and keeps failed
rows pending so one failure does not block later rows. It publishes fixed
aggregate attempted/reconciled/failed/pending/oldest-pending/retry counts only.

After a primary-only loss, public/admin Spotify routes stay closed and only
the current healthy live ledger may authorize credential recovery. Restore
the primary into a new database only when the fixed primary database name is
absent. Root uses the local peer-authenticated PostgreSQL administrator only
as a recovery broker: restored objects and the database are owned by
`swp_migrator`, runtime grants and database ACLs are restored, every retained
tombstone is applied, and zero retained credential matches is required. The
script then renames the validated recovery database to the fixed primary name
and validates owner, object owner, exact grants, migration, schema, and counts.
Reset the retained tombstones to pending, run reconciliation, and require
pending count zero before traffic can resume. Application services never run
as the PostgreSQL administrator.

If the ledger alone is lost, both databases are lost, the cluster is lost, or
only backups remain, restore no OAuth, credential, setup, confirmation, or
backoff state. Start with empty migrated databases and require every user to
authorize again. An older ledger backup is never used to justify restoring
credentials because a later deletion could be absent.

## Rate limits and observability

Rate limits are bounded in-memory controls suitable for one locked VPS
instance. Separate buckets cover authentication, unauthenticated API traffic,
authenticated playback, and controls. They use only fixed internal keys and
must not make production policy-lock responses stateful: the early 503 occurs
before rate-limit access.

Every bucket is a fixed 60-second window; expired entries are removed every 30
seconds. Setup/callback/confirm/reauthorize use 20 requests per issuer with at
most 4096 issuers. The pre-database request bucket uses 6000 per issuer with at
most 4096. Playback uses 120 per Pairing ID with at most 64 IDs. Control and
account deletion share 60 per Pairing ID with at most 64. New keys fail closed
when a map is full. Rejections return `429` and `Retry-After` of one through 60
seconds. Spotify's persisted `Retry-After` remains authoritative.

| Routes | Bucket/key | Limit/cap |
| --- | --- | --- |
| `GET /setup`, `POST /auth/start`, callback, both confirm methods, reauthorize | keyed canonical-issuer digest | 20 / 4096 issuers |
| playback, control, account before any DB access | keyed canonical-issuer digest | 6000 / 4096 issuers |
| playback after authentication | Pairing public ID | 120 / 64 IDs |
| control and account after authentication | Pairing public ID | 60 shared / 64 IDs |
| valid CORS `OPTIONS` | none | no limiter mutation |

Node emits fixed event names, fixed outcome classes, latency buckets, and
aggregate counts only. It never logs:

- URL, path with query, query string, or callback data;
- headers, Cookies, Authorization, Client ID, or IP address;
- `publicId`, state, verifier, authorization code, Spotify token, Pairing
  Token, key material, track metadata, exception message, or upstream body.

Systemd journal retention and permissions are operator-controlled. Caddy and
OAuth2 Proxy access/request/auth logs remain disabled. Operators use local
fixed-output maintenance commands for health, migration, backup, disk,
certificate, reconciliation, and service checks.

## Build and deployment artifacts

The public backend is an npm workspace named
`@spotify-wallpaper/public-backend`. It builds TypeScript to Node.js 22 ESM
without source maps. Production runtime dependencies are limited to external
`pg` plus the local product dependency
`@spotify-wallpaper/shared-types`. Node standard HTTP and Web Crypto APIs are
used instead of a framework, ORM, Redis, Docker, or a custom migration tool.

The source artifact is built only from a clean worktree whose `HEAD` equals the
reviewed 40-character release ID. The builder removes and rebuilds both
ignored `dist` trees before copying them, then records that ID in `RELEASE_ID`
and includes it in `SHA256SUMS`. The remaining allowlist is the root
`package.json` and lockfile, `apps/public-backend` manifest, compiled `dist`,
migrations, and legal files, plus the `packages/shared-types` manifest and
compiled `dist`. It excludes TypeScript source, source maps, tests, fixtures,
deployment configuration, local databases, dumps, `.env` files, secrets,
logs, and tool caches.

The build command is
`node scripts/build-public-backend-artifact.mjs <empty-output-directory> <reviewed-HEAD-SHA>`.
It fails before producing a checksum manifest when the repository root, HEAD,
or clean-worktree check differs.

Deployment extracts that allowlist into a new empty temporary release
directory, runs workspace-scoped `npm ci --omit=dev`, verifies shared-type
import, startup, and health, and only then writes and checks a sorted SHA-256
manifest over the complete runtime tree including `node_modules`. The verified
tree is made readable/executable but never writable by the non-root runtime
user, then atomically promoted by switching `current`.
Neither dependency installation nor any other mutation occurs after the final
runtime manifest. The transport artifact has its own checksum; it is not
mistaken for the final release-tree checksum.

Caddy, OAuth2 Proxy, systemd, PostgreSQL, and timer configuration is delivered
as a separate config bundle generated only from tracked deployment files at
the same reviewed Git SHA. It has its own sorted manifest and SHA-256 checksum
recorded with the release ID. Operators install only that verified bundle,
never files read directly from a mutable Git checkout.
Fixed operating-system paths are root-created links through the configuration
inside `/opt/spotify-wallpaper/current`. The application and its exact config
bundle share one immutable generation, so deployment and rollback switch one
verified pointer and cannot expose mismatched versions. The two real
environment files remain root-owned local secret files and are never linked
from a bundle.

Every setup, callback success/error, confirmation GET/POST, and one-time token
display HTML response sets `Cache-Control: no-store`, `Referrer-Policy:
no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and
the exact CSP base
`default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.
Pages needing inline script/style add only per-response nonces; pages that do
not need them omit those sources. Fixed error HTML uses the same boundary.

## Acceptance and release gates

The phase has two separate completion lines:

1. locked VPS: exact origin, TLS/proxy chain, two socket permissions, early
   policy lock, two-database migrations/backups/restores, local readiness,
   packaging, alerts, rollback, and soak;
2. dormant hardened OAuth: synthetic-only setup/callback/confirmation,
   encryption, pairing, refresh, normalized playback/controls,
   reauthorization, deletion, and reconciliation tests.

The dormant line includes the tracked `deploy/public-backend/test` integration
suite. Build `Dockerfile.synthetic-e2e`, then run `synthetic-e2e.sh` in that
image with the repository mounted read-only. It uses Node 22, a real
PostgreSQL 17 cluster, both real AF_UNIX sockets, and a private self-signed
HTTPS provider, and validates the tracked Caddyfile with the Caddy binary. It
must finish with only `SYNTHETIC_E2E_PASS`; no state,
Cookie, Client ID, authorization code, token, or callback URL is printed.

Passing either or both lines does not authorize real Spotify traffic.
Unlocking requires updated current specifications, Spotify policy/legal
approval, operator identity and private contacts, reviewed Privacy/EULA,
registered callback, a separately reviewed production mode and systemd/network
unit, security and SpecGuard approval, alert-delivery evidence, limited beta,
and the required soak. The production origin remains policy-locked until that
separate change is approved.
