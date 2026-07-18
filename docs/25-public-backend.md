# Optional Public Backend

## Scope

The public backend is an optional TypeScript Cloudflare Worker using D1. It exists so a Wallpaper Engine Workshop build can poll Spotify without receiving Spotify Access or Refresh Tokens.

The loopback Rust backend remains the local-development backend. Direct browser-side refresh and `swpt1.` remain legacy-compatible. Browser mock mode remains available without any backend.

The loopback Rust backend contract remains:

```text
GET  /health
GET  /auth/start
GET  /auth/callback
GET  /api/playback
POST /api/control
```

It binds only to `127.0.0.1` or `::1` and uses the same success/error envelope, normalized playback, and control JSON as the public Worker.

Legacy direct token grammar is `swpt1.<base64url-json>`, with a maximum total length of 20,000 characters. The decoded JSON must be an object containing exactly compatible `v: 1`, non-empty string `clientId`, and non-empty string `refreshToken` fields. Invalid encoding, JSON, version, types, empty values, or excessive length is rejected without logging the input. `swpt1.` is parsed only by direct legacy mode and is never accepted as a public Worker Bearer token.

## Spotify application mode

The initial Worker uses BYO Client ID with Authorization Code + PKCE and no Client Secret. A managed shared Spotify application is out of scope until Extended Quota approval and a separate threat-model review.

Development Mode is limited by Spotify and is not a scalable managed public-app foundation. General Workshop publication requires policy confirmation for the BYO model and for the wallpaper's use of artwork and audio-reactive visuals.

## Routes

```text
GET    /health
GET    /setup
GET    /privacy
GET    /terms
POST   /auth/start
GET    /auth/callback
POST   /auth/reauthorize
GET    /api/playback
POST   /api/control
DELETE /api/account
```

Playback and control accept `Authorization: Bearer swpb1.<publicId>.<secret>`. Pairing Tokens never use URL parameters or cookies.

## OAuth

- `/setup` shows Development Mode limits plus links to the Privacy Notice and
  EULA before authorization.
- `/auth/start` accepts a bounded Spotify Client ID and explicit legal
  acceptance from a same-origin POST.
- `/auth/reauthorize` also requires explicit acceptance of the current legal
  documents.
- Redirect URI and scopes are fixed by the Worker.
- State, browser nonce, and PKCE verifier use cryptographically secure randomness.
- D1 stores state/browser digests and an encrypted PKCE verifier.
- Sessions expire within ten minutes, are deleted atomically when consumed,
  and abandoned expired sessions are purged by scheduled maintenance.
- Callback and setup pages set `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, restrictive CSP, frame denial, and `nosniff`.
- Cloudflare invocation logs are disabled because callback URLs contain authorization codes.
- Pairing Token generation occurs only after successful Spotify token exchange.
- Initial callback shows the Pairing Token once. Reauthorization keeps the existing Pairing Token.

## Pairing Token

Format:

```text
swpb1.<publicId>.<secret>
```

`swpb1` is protocol version 1. `publicId` contains 128 bits of CSPRNG entropy. `secret` contains 256 bits. The encoded token must not exceed 256 characters. D1 stores `publicId`, a HMAC-SHA-256 digest, and digest-key ID. Verification is constant-time after an exact format parse.

Pairing Tokens remain valid until account deletion or explicit revocation. Spotify reauthorization retains the same Pairing Token. `swpt1.` is accepted by direct legacy mode only and is never accepted by the public Worker.

## Token encryption

Refresh and Access Tokens use AES-256-GCM with random 96-bit nonces. Encryption and Pairing HMAC keys are separate Worker secrets. Each encrypted field stores its own key ID.

AAD:

```text
spotify-wallpaper:v1:<recordId>:<spotifyClientId>:<fieldName>
```

The active key and previous keys form a keyring. Successful reads using an old key lazily re-encrypt the field with the active key. An old key is removed only after no D1 row references its key ID. A D1 export without Worker secrets cannot recover Spotify tokens.

## Refresh and backoff

Encrypted Access Tokens may be cached in D1 because Workers are stateless. Refresh begins 60 seconds before Access Token expiry.

A conditional D1 lease permits one refresh owner per credential. The lease has a unique ID and bounded expiry. Lease completion requires matching lease ID and token version. Concurrent losers wait briefly, reload D1, and do not call Spotify. Every success and failure path releases or expires the lease.

When Spotify rotates the Refresh Token, both token updates are committed atomically. If Spotify omits it, retain the previous Refresh Token.

`invalid_grant` deletes encrypted Spotify tokens, marks reauthorization required, releases the lease, and is not retried. Spotify 429 backoff is persisted by Client ID and preserves `Retry-After`.

## API contract

Success:

```json
{ "ok": true, "value": {} }
```

Error:

```json
{
  "ok": false,
  "error": {
    "kind": "unauthorized",
    "message": "Spotify authorization is required.",
    "status": 401,
    "retryAfterMs": 1000
  }
}
```

The envelope and command format are protocol version 1 through the `swpb1` credential version. Accepted command JSON is:

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

`positionMs` is a finite integer from 0 through the current item duration. `volumePercent` is a finite integer from 0 through 100. `shuffle.state` is boolean. `repeat.state` is exactly `off`, `track`, or `context`. Unknown fields, missing fields, unknown commands, non-integer numbers, and out-of-range values are rejected before a Spotify request.

The Worker returns normalized playback only. `source` remains `spotify` and `fetchedAt` is required. Errors contain fixed application messages, not Spotify response bodies or secrets.

## Origin and request policy

Playback/control CORS permits Wallpaper Engine `Origin: null` and explicit local preview origins only. Allowed methods and headers are fixed, `Authorization` is required, and credentialed cookie CORS is disabled. CORS is not authentication.

Setup/account management is same-origin and rejects `Origin: null`. Wallpaper requests use `redirect: 'error'`, `credentials: 'omit'`, and `referrerPolicy: 'no-referrer'`. The wallpaper permits HTTP loopback and the exact release-configured HTTPS origin only.

Cloudflare Rate Limiting bindings protect auth start, callback, and
reauthorization by IP and API routes by `publicId`. Spotify's persisted
`Retry-After` remains authoritative.

## Reauthorization and deletion

Spotify Refresh Tokens expire six months from the original authorization time. There is no server-side grace period after `invalid_grant`; the wallpaper keeps its last safe display and reports reauthorization required.

Setup JavaScript may submit the existing Pairing Token through an Authorization header to begin reauthorization. It never stores the token in DOM copies, URLs, Web Storage, IndexedDB, cookies, or errors.

Account deletion first writes a 35-day non-secret `publicId` tombstone to a separate deletion-ledger D1 database, then removes the primary OAuth sessions, token ciphertext, Client ID, Pairing digest, leases, and cache. Every authenticated request checks the ledger first. A scheduled reconciler reapplies tombstones to the primary database, including after Time Travel restoration.

The reconciler isolates each failed tombstone so one permanent primary-D1
failure cannot block later deletions. The ledger records retry count and last
attempt time. Aggregate scheduled metrics report attempted, reconciled,
failed, pending, oldest-pending age, and maximum retry counts without
identifiers.

## Operations

- Preview and production use different domains, D1 databases, keyrings, and rate-limit namespaces.
- Production uses Workers Paid and a fixed custom HTTPS domain.
- Aggregate metrics use Analytics Engine and contain only route/status/latency classes and outcome counters.
- Request URL invocation logs remain disabled.
- Deployment, key rotation, incident response, migration, cost, and restore runbooks are release requirements.

## Completion and publication

Implementation completion requires automated Worker/wallpaper/Rust gates,
staging integration, secret-surface inspection, independent Security and
SpecGuard approval, and a 72-hour Wallpaper Engine soak.

Private local or mock-only staging may proceed without Spotify users. A
Spotify-connected Limited beta is blocked until either a dated Spotify policy
decision or a policy-compatible build covers BYO authorization, visual
synchronization, product naming, Spotify Marks/links, and artwork treatment.
It also requires published operator/privacy/incident contacts, the Privacy
Notice and EULA consent flow, real preview infrastructure, smoke tests, alert
delivery tests, and independent Security/SpecGuard approval.

General Workshop publication additionally requires the completed Limited beta,
72-hour Wallpaper Engine soak, and every publication checklist item recorded
with reviewer/owner and evidence location in the public-backend phase report.
Implementation completion alone does not authorize Spotify-connected
distribution.
