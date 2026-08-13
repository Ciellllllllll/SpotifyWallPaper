# Optional Public Backend

## Scope

The public backend is an optional TypeScript Cloudflare Worker using D1. It exists so a Wallpaper Engine Workshop build can poll Spotify without receiving Spotify Access or Refresh Tokens.

The current architecture keeps this Worker's OAuth, D1, encryption, refresh,
and deletion state machines separate from wallpaper rendering. The Worker
conforms at its provider boundary to the versioned provider-v1 fixtures.
Invocation logs remain disabled, and the Worker remains optional for browser
mock, direct legacy, and loopback operation.

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
GET    /auth/confirm
POST   /auth/confirm
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
  acceptance from a setup-Cookie/proof-bound POST.
- `/auth/reauthorize` also requires explicit acceptance of the current legal
  documents.
- `/setup` is rate-limited before any D1 write and atomically permits at most
  three unexpired sessions per keyed issuer digest under concurrent requests.
  It creates a ten-minute, purpose-bound, single-use setup session. If an
  exact, still-valid setup Cookie is presented to `GET /setup`, the Worker
  atomically retires and replaces that Cookie's previous unconsumed session
  instead of increasing the outstanding-session count. A missing, malformed,
  or unmatched Cookie cannot retire another session. D1 stores only keyed
  browser/issuer digests, legal-document versions, expiry, and consumption
  state. The raw nonce is held in the exact
  `__Host-swp-setup=<43-character-base64url-random>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=600`
  Cookie with no `Domain`, and the signed HTML proof is bound to the session.
- `/auth/start` is rate-limited before session lookup, requires the exact
  setup Cookie, signed proof, and current legal acceptance, and atomically
  consumes the setup session. It clears the setup Cookie on every terminal
  result. A proof without its Cookie, cross-site browser form, replay, wrong
  Cookie, wrong purpose, or expired session cannot create OAuth state.
  `AUTH_FLOW_VERSION_MISMATCH` is a recoverable compatibility result rather
  than a terminal session result: it occurs before D1 lookup/mutation and
  preserves an exactly parsed hardened setup Cookie so the next hardened
  `GET /setup` can retire/replace its row. A malformed setup Cookie is cleared.
- The hardened flow uses exact, mutually exclusive protocol values:

  ```text
  setup proof       swps2.<sessionId>.<expiresAtMs>.<signature>
  OAuth state       swpo2.<43-character-base64url-random>
  confirmation      swpc1.<confirmationId>.<expiresAtMs>.<signature>
  ```

  `sessionId` and `confirmationId` are unpadded base64url encodings of 128
  random bits (22 characters), `expiresAtMs` is exactly 13 ASCII decimal
  digits, and each signature is an unpadded 32-byte HMAC-SHA-256 value (43
  characters). The exact UTF-8 HMAC inputs are
  `spotify-wallpaper:setup-session-v2:<sessionId>:<expiresAtMs>` and
  `spotify-wallpaper:oauth-confirm-v1:<confirmationId>:<expiresAtMs>`.
  OAuth state is 32 random bytes and its stored digest is HMAC-SHA-256 over
  exact UTF-8
  `spotify-wallpaper:oauth-state-v2:<complete-swpo2-state-value>`.
  The OAuth Cookie is exactly
  `__Host-swp-oauth-v2=<43-character-base64url-random>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
  with no `Domain`. Each parser requires its exact prefix, part count,
  alphabet, lengths, purpose, and database protocol version. Signed proof
  verification uses WebCrypto verification or an equivalent constant-time
  comparison after exact parsing and rate limiting.
- Setup proof, confirmation proof, state digest, and all browser/issuer digests
  use the Worker `OAUTH_STATE_HMAC_KEY`, an unpadded canonical base64url
  encoding of exactly 32 key bytes that is separate from encryption and
  Pairing HMAC keys. Every HMAC output is canonical unpadded base64url.
  Setup, OAuth, and confirmation Cookie values are each exactly the canonical
  43-character encoding of 32 CSPRNG bytes; duplicate Cookie names are
  rejected. Their other exact UTF-8 HMAC inputs are:

  ```text
  spotify-wallpaper:setup-browser-v2:<setup-cookie-value>
  spotify-wallpaper:setup-issuer-v2:<canonical-issuer>
  spotify-wallpaper:oauth-browser-v2:<oauth-cookie-value>
  spotify-wallpaper:oauth-confirm-browser-v1:<confirmation-cookie-value>
  ```

  `canonical-issuer` is the trusted Cloudflare client IP parsed strictly and
  encoded as `v4:` plus eight lowercase hexadecimal digits or `v6:` plus 32
  lowercase hexadecimal digits; IPv4-mapped IPv6 is normalized to `v4`.
  Missing or invalid input fails closed before D1 access. These short-lived
  HMAC records have no key ID or previous-key fallback. Rotating the key
  intentionally invalidates all in-flight authorization sessions, which then
  expire or are purged and must restart without downgrade.
- The baseline Worker rejects `swps2` setup proofs because its parser accepts
  only the legacy three-part `expiresAtMs.nonce.signature` shape. Its callback
  rejects `swpo2` before D1 lookup because that value is not a raw 32-byte
  base64url state. Hardened parsers reject every baseline proof, state, and
  OAuth Cookie format. No handler retries, translates, or downgrades between
  protocol versions. A request that crosses old/new edge isolates receives
  either the approved baseline's fixed invalid-proof/callback/route-not-found
  error or the hardened `AUTH_FLOW_VERSION_MISMATCH` response. The hardened
  response and the Phase 4A compatibility stub provide a safe link back to a
  freshly loaded setup or confirmation page. No cross-version failure permits
  D1 mutation, Spotify token exchange, or credential creation.
- Redirect URI and scopes are fixed by the Worker.
- State, browser nonce, and PKCE verifier use cryptographically secure randomness.
- D1 stores state/browser digests and an encrypted PKCE verifier.
- OAuth sessions expire within ten minutes and are deleted or transitioned
  atomically when consumed.
- When an opaque-origin browser omits the callback Cookie, the Worker accepts
  a first-time callback only into a five-minute pending-confirmation state; it
  does not exchange the authorization code or create credentials. The Worker
  stores the code/verifier only as key-ID/AAD-bound ciphertext, sets the exact
  `__Host-swp-confirm=<43-character-base64url-random>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300`
  Cookie with no `Domain`, and redirects with `303` to the query-free
  `GET /auth/confirm` URL. `Lax` is required so the Cookie survives the
  cross-site Spotify callback's top-level safe-method redirect; confirmation
  GET is non-mutating and confirmation POST still requires Cookie, proof,
  explicit action, and legal acceptance.
- `GET /auth/confirm` is rate-limited before D1 access and requires exactly one
  valid confirmation Cookie. A keyed digest of that Cookie identifies exactly
  one unexpired, unconsumed row under a unique index. Zero or multiple matches,
  malformed Cookies, expiry, or storage failure return a fixed no-store error
  without decrypting or consuming the row. The clean page contains no
  authorization code, OAuth state, Client ID, confirmation ID, or credential
  in its URL, JavaScript, or reflected error. It emits only the signed
  single-use `swpc1` proof and current legal-acceptance controls needed by the
  form.
- `POST /auth/confirm` requires the exact Cookie, signed proof, current legal
  acceptance, and an explicit user action. After constant-time signature
  verification, one conditional `DELETE ... RETURNING` operation may consume
  a row only when the proof's exact `confirmationId` and `expiresAtMs`, the
  HMAC digest of the presented confirmation Cookie, `protocol_version = 1`,
  unconsumed state, and current unexpired state all match that same
  `callback_confirmations` row. Only the returned row may be decrypted and
  exchanged. A zero/multiple-row result or any cross-row mismatch performs no
  decrypt, consumption, token exchange, or credential creation.
  Proof/Cookie binding mismatch is recoverable and preserves the valid Cookie
  and every candidate row so the correct pairing can retry; other terminal
  results clear the confirmation Cookie. A Phase 4A compatibility response or
  transient cross-version failure leaves the pending row and Cookie unconsumed
  so the user can return to query-free `GET /auth/confirm` and retry within
  five minutes. Reauthorization always requires the original matching
  callback Cookie and never uses this fallback. Malformed or duplicate
  callback or confirmation Cookies are rejected.
- Expired/consumed setup, OAuth, and callback-confirmation sessions are
  purged by bounded scheduled maintenance without starvation.
- Setup, callback, confirmation GET/POST, and Phase 4A compatibility-stub
  responses set `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
  restrictive CSP, frame denial, and `X-Content-Type-Options: nosniff` on both
  success and every fixed error page.
- Cloudflare invocation logs are disabled because callback URLs contain authorization codes.
- Pairing Token generation occurs only after successful Spotify token exchange.
- Initial authorization completion shows the Pairing Token once.
  Reauthorization keeps the existing Pairing Token.

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

Pending callback-confirmation authorization code and PKCE verifier fields use
the same AES-256-GCM encryption keyring, separate random 96-bit nonces and key
IDs, and exact AAD:

```text
spotify-wallpaper:oauth-confirm:v1:<confirmationId>:<spotifyClientId>:<fieldName>
```

`fieldName` is exactly `authorizationCode` or `pkceVerifier`. Moving an OAuth
session to pending confirmation re-encrypts the verifier under the new AAD.
Field swaps, row swaps, tampering, expiry, or decrypt failure fail closed.
Successful non-consuming reads under a previous key lazily rotate both fields,
and key-reference scans include pending-confirmation rows.

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

Account management is same-origin and rejects `Origin: null`. Setup
authorization treats neither the HTML proof nor its Cookie as human-presence
or browser-possession proof because a server can fetch and replay both in its
own client. Their single-use, SameSite-bound session prevents cross-site
browser CSRF and replay; server-originated setup creation is bounded by
pre-write rate limits and outstanding-session caps. If the authorization URL
is handed to a different browser, a Cookie-less initial callback cannot
exchange tokens until that browser performs the visible one-time confirmation.
The signed proof provides tamper and expiry validation, not bot resistance.
Wallpaper requests use `redirect: 'error'`, `credentials: 'omit'`, and
`referrerPolicy: 'no-referrer'`. The wallpaper permits HTTP loopback and the
exact release-configured HTTPS origin only.

Cloudflare Rate Limiting bindings protect setup before D1 insertion, auth
start, callback, confirmation-page GET, confirmation POST, and reauthorization
by IP and API routes by `publicId`. A rate-limit binding failure fails closed
before state mutation. Spotify's persisted `Retry-After` remains authoritative.

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
- Additive setup/confirmation-session tables and expiry/issuer indexes are
  migrated with an additive
  `oauth_sessions.protocol_version INTEGER NOT NULL DEFAULT 1 CHECK (protocol_version IN (1, 2))`
  column and
  verified in preview, then production, before deploying a Worker that
  requires them. Existing Workers insert/read version 1 by default and ignore
  the new tables. Hardened OAuth rows are inserted explicitly as version 2 and
  may be consumed only by a version-2 handler; setup rows require protocol
  version 2 and confirmation rows require protocol version 1.
  Missing or partial schema fails closed with a fixed unavailable response and
  never falls back to stateless setup.
- Phase 4A also routes inert `GET /auth/confirm` and `POST /auth/confirm`
  compatibility stubs. They do not parse OAuth material or read/write D1; they
  return a fixed no-store `409 AUTH_FLOW_VERSION_MISMATCH` page with a
  query-free retry link. This release must be fully deployed and verified
  before any callback can create pending-confirmation rows. A Phase 4C rollout
  is supported only over the fully deployed Phase 4A/4B generation, never
  directly over commit `455dcf1`.
- Deployment characterization freezes both protocol generations: old
  setup/start and callback parsers reject hardened values before state
  mutation, while hardened parsers reject old proof/state/Cookie values. The
  frozen `455dcf1` baseline returns its fixed 404 for both confirmation methods
  without D1 access; the Phase 4A stub returns the safe 409 recovery page.
  Mixed-isolate tests must exercise setup/start/callback plus confirmation GET
  and POST in both directions, including new callback to old stub to new retry,
  before the hardened routes are enabled.
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
