# Cloudflare Worker Public Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure public Cloudflare backend that keeps Spotify tokens out of Wallpaper Engine, supports automatic access-token refresh and six-month reauthorization, and preserves direct, local Rust, and browser mock modes.

**Architecture:** Add a TypeScript Cloudflare Worker backed by D1. The first release uses each user's own Spotify Client ID with Authorization Code + PKCE and no Client Secret; a shared managed Spotify app is explicitly out of scope until Extended Quota approval. The existing Rust backend remains loopback-only for local development.

**Tech Stack:** Cloudflare Workers, TypeScript, Wrangler 4, D1, Web Crypto AES-256-GCM/HMAC-SHA-256, Cloudflare Rate Limiting bindings, Vitest 4 with `@cloudflare/vitest-pool-workers`, Svelte/Vite wallpaper, existing Rust local backend.

## Release Reality

- Spotify Development Mode is limited to five authorized users and requires the app owner to have Premium.
- Spotify accepts new Extended Quota applications only from qualifying organizations.
- BYO Client ID can be implemented for private/limited beta, but general Workshop publication requires written confirmation that this use complies with Spotify policy.
- Spotify Refresh Tokens expire after six months. Reauthorization is part of v1, not a later enhancement.
- The current circular/cropped artwork, blurred artwork background, and audio-reactive presentation require a separate Spotify policy review before general publication.
- Cloudflare Workers Paid is required for public operation. A continuously playing wallpaper polling every two seconds produces about 1.3 million Worker requests per user per month.

## Global Constraints

- Work only in `D:\Git\SpotifyWallPaper`.
- Do not add `SPOTIFY_CLIENT_SECRET` to the public Worker v1, wallpaper, repository secrets, tests, or docs.
- Do not log Access Token, Refresh Token, Pairing Token, OAuth code, OAuth state, PKCE verifier, request body, or full callback URL.
- Disable Cloudflare Worker invocation logs because callback URLs contain authorization codes.
- Generate Pairing Tokens only after successful Spotify token exchange.
- Use Pairing Token format `swpb1.<publicId>.<secret>` with 128-bit `publicId` and 256-bit `secret`.
- Store only `publicId` and a keyed HMAC digest of the Pairing secret.
- Encrypt Spotify Refresh and Access Tokens before D1 storage. A D1 export alone must not recover either token.
- Preserve `NormalizedPlayback.source === 'spotify'`, `fetchedAt`, current command JSON, and existing error shape.
- Preserve browser mock, direct legacy, and loopback Rust backend modes.
- Never silently fall back from an explicitly selected backend provider to direct credentials.
- Never send a Pairing Token to an arbitrary HTTPS origin or across an HTTP redirect.
- Keep Spotify polling interval-based and preserve `Retry-After`.
- Read `docs/how-to-use-h5i.md` before running resource-intensive commands, then use `h5i capture run -- ...`.
- Commit after each task using the existing sentence-style commit convention.

## Public Interfaces

Worker routes:

```text
GET    /health
GET    /setup
POST   /auth/start
GET    /auth/callback
POST   /auth/reauthorize
GET    /api/playback
POST   /api/control
DELETE /api/account
```

API success and error envelopes:

```ts
type ApiResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        kind:
          | 'unauthorized'
          | 'forbidden'
          | 'rate_limited'
          | 'network_error'
          | 'unavailable'
          | 'unknown_response_shape'
          | 'item_null';
        message: string;
        status?: number;
        retryAfterMs?: number;
      };
    };
```

Authenticated wallpaper requests use:

```http
Authorization: Bearer swpb1.<publicId>.<secret>
```

The token never appears in a URL, cookie, log, exception, telemetry field, or response after initial issuance.

## File Map

- Create `apps/cloudflare-worker/` for the public Worker.
- Create `apps/cloudflare-worker/migrations/0001_initial.sql` for D1 schema.
- Create `apps/cloudflare-worker/migrations/deletion-ledger/0001_initial.sql` for restore-safe deletion records.
- Create `apps/cloudflare-worker/src/contracts.ts` for API and environment types.
- Create `apps/cloudflare-worker/src/crypto.ts` for random values, HMAC, AES-GCM, AAD, and key rotation.
- Create `apps/cloudflare-worker/src/db.ts` for typed D1 operations and refresh leases.
- Create `apps/cloudflare-worker/src/auth.ts` for setup, start, callback, and reauthorization.
- Create `apps/cloudflare-worker/src/pairing.ts` for Pairing Token parsing and verification.
- Create `apps/cloudflare-worker/src/spotify.ts` for Spotify token/API requests and error classification.
- Create `apps/cloudflare-worker/src/normalize.ts` for server-side normalized playback output.
- Create `apps/cloudflare-worker/src/api.ts` for playback, control, and account deletion.
- Create `apps/cloudflare-worker/src/http.ts` for routing, headers, CORS, redacted errors, and body limits.
- Create `apps/cloudflare-worker/src/index.ts` for Worker entrypoint.
- Create `apps/cloudflare-worker/test/` for Worker and D1 tests.
- Modify `apps/wallpaper/src/spotify/polling.ts` and tests for trusted public origin and redirect rejection.
- Modify settings/property/project tests without changing `schemaVersion`.
- Modify root scripts and CI to include Worker checks.
- Update project specs before implementation and add a phase report after verification.

---

### Task 1: Formally Approve The Optional Public Backend

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/README.md`
- Modify: `docs/01-project-goals-and-non-goals.md`
- Modify: `docs/02-repository-structure.md`
- Modify: `docs/03-implementation-phases.md`
- Modify: `docs/04-quality-gates.md`
- Modify: `docs/10-spotify-integration.md`
- Modify: `docs/11-wallpaper-engine.md`
- Modify: `docs/13-settings-schema.md`
- Modify: `docs/19-player-clock.md`
- Modify: `docs/20-tauri-configurator.md`
- Modify: `docs/22-performance.md`
- Modify: `docs/23-test-qa.md`
- Modify: `docs/24-docs-and-reporting.md`
- Modify: `docs/30-subagent-matrix.md`
- Create: `docs/25-public-backend.md`

**Interfaces:**
- Produces the normative public-backend specification used by every later task.
- Does not change runtime behavior.

- [ ] **Step 1: Add the architecture decision**

Document TypeScript Worker + D1, BYO Client ID + PKCE, local Rust fallback, optional backend runtime, six-month reauthorization, and the managed-app no-go gate.

- [ ] **Step 2: Add security acceptance criteria**

Define Pairing Token format, HMAC verification, AES-GCM encryption, key IDs, AAD, callback logging prohibition, CORS policy, refresh single-flight, account deletion, and no-secret export rules.

- [ ] **Step 3: Add compatibility acceptance criteria**

Fix these invariants: direct/backend provider names, mock startup, local Rust routes, `swpt1.` legacy parsing, normalized playback, command JSON, error shape, previous-track retention, and no per-frame API calls.

- [ ] **Step 4: Add the publication policy gate**

State that backend implementation and limited beta may proceed, but general Workshop publication is blocked until Spotify confirms the BYO model and current artwork/visualizer use, or the product is changed to comply.

- [ ] **Step 5: Review and commit**

Run:

```powershell
git diff --check
```

Expected: exit code 0.

Commit:

```powershell
git add -u AGENTS.md docs
git add -f docs/25-public-backend.md
git commit -m "Approve optional public Spotify backend"
```

### Task 2: Scaffold The Worker And Real D1 Test Harness

**Files:**
- Create: `apps/cloudflare-worker/package.json`
- Create: `apps/cloudflare-worker/tsconfig.json`
- Create: `apps/cloudflare-worker/wrangler.jsonc`
- Create: `apps/cloudflare-worker/vitest.config.ts`
- Create: `apps/cloudflare-worker/worker-configuration.d.ts`
- Create: `apps/cloudflare-worker/src/contracts.ts`
- Create: `apps/cloudflare-worker/src/index.ts`
- Create: `apps/cloudflare-worker/test/health.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces `Env`, `ApiResult<T>`, and an ES-module Worker `fetch`.
- Produces a `/health` response with no secret or deployment detail.

- [ ] **Step 1: Write a failing Worker health test**

Use `SELF.fetch('https://worker.test/health')` and assert:

```ts
expect(response.status).toBe(200);
expect(await response.json()).toEqual({
  ok: true,
  value: { service: 'spotify-wallpaper-backend' }
});
```

- [ ] **Step 2: Add the package and Wrangler config**

Use Vitest 4.1+, `@cloudflare/vitest-pool-workers`, Wrangler 4.36+, generated runtime types via `wrangler types`, separate preview/production bindings, and:

```jsonc
"observability": {
  "enabled": true,
  "logs": {
    "invocation_logs": false,
    "head_sampling_rate": 0
  }
}
```

Do not declare a Spotify Client Secret binding.
Declare only named secret keyrings and active key IDs:

```text
TOKEN_ENCRYPTION_KEYRING
TOKEN_ENCRYPTION_ACTIVE_KEY_ID
PAIRING_HMAC_KEYRING
PAIRING_HMAC_ACTIVE_KEY_ID
OAUTH_STATE_HMAC_KEY
```

- [ ] **Step 3: Implement the minimal typed entrypoint**

Route only `/health`; return a redacted 404 envelope for every other path.

- [ ] **Step 4: Verify**

```powershell
h5i capture run -- npm install
h5i capture run -- npm run types -w @spotify-wallpaper/cloudflare-worker
h5i capture run -- npm run test -w @spotify-wallpaper/cloudflare-worker
h5i capture run -- npm run check -w @spotify-wallpaper/cloudflare-worker
```

Expected: health test and TypeScript check pass.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json apps/cloudflare-worker
git commit -m "Add Cloudflare worker test scaffold"
```

### Task 3: Add D1 Schema, Pairing Verification, And Token Encryption

**Files:**
- Create: `apps/cloudflare-worker/migrations/0001_initial.sql`
- Create: `apps/cloudflare-worker/migrations/deletion-ledger/0001_initial.sql`
- Create: `apps/cloudflare-worker/src/crypto.ts`
- Create: `apps/cloudflare-worker/src/pairing.ts`
- Create: `apps/cloudflare-worker/src/db.ts`
- Create: `apps/cloudflare-worker/test/crypto.test.ts`
- Create: `apps/cloudflare-worker/test/db.test.ts`

**Interfaces:**
- Produces `generatePairingToken()`, `parsePairingToken()`, `pairingDigest()`, `encryptSecret()`, and `decryptSecret()`.
- Produces atomic OAuth-session consume and credential CRUD.
- Produces a conditional refresh lease with `leaseId`, `leaseUntilMs`, and `tokenVersion`.

- [ ] **Step 1: Write failing crypto and D1 tests**

Cover:

```text
256-bit OAuth state
128-bit publicId and 256-bit Pairing secret
strict swpb1 token parsing
constant-time HMAC digest verification
AES-256-GCM round trip
wrong key, AAD, nonce, or record ID fails
database text contains no plaintext Pairing/Refresh/Access token
OAuth state can be consumed once only
revoked credential cannot authenticate
only one concurrent refresh lease succeeds
```

- [ ] **Step 2: Create the schema**

Use these tables:

```sql
CREATE TABLE oauth_sessions (
  state_digest TEXT PRIMARY KEY,
  browser_digest TEXT NOT NULL,
  spotify_client_id TEXT NOT NULL,
  credential_public_id TEXT,
  code_verifier_ciphertext TEXT NOT NULL,
  code_verifier_nonce TEXT NOT NULL,
  encryption_key_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER
);

CREATE TABLE credentials (
  public_id TEXT PRIMARY KEY,
  pairing_digest TEXT NOT NULL,
  pairing_key_id TEXT NOT NULL,
  spotify_client_id TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  refresh_token_nonce TEXT,
  refresh_token_key_id TEXT,
  access_token_ciphertext TEXT,
  access_token_nonce TEXT,
  access_token_key_id TEXT,
  access_token_expires_at_ms INTEGER,
  refresh_authorized_at_ms INTEGER NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  refresh_lease_id TEXT,
  refresh_lease_until_ms INTEGER,
  auth_status TEXT NOT NULL DEFAULT 'active',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  last_used_at_ms INTEGER
);

CREATE TABLE spotify_backoff (
  spotify_client_id TEXT PRIMARY KEY,
  retry_until_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
```

Add constraints for `auth_status IN ('active','reauth_required')` and indexes for expired sessions and active credentials.

The separate deletion-ledger D1 database stores no Spotify data:

```sql
CREATE TABLE deletion_tombstones (
  public_id TEXT PRIMARY KEY,
  deleted_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
```

- [ ] **Step 3: Implement cryptography**

Use separate Worker secrets for encryption and Pairing HMAC. Store independent `refresh_token_key_id` and `access_token_key_id` values because either field may be re-encrypted separately; store the Pairing digest key ID independently. AES-GCM uses a random 96-bit nonce and AAD:

```text
spotify-wallpaper:v1:<recordId>:<spotifyClientId>:<fieldName>
```

Support an active key plus previous keys. Re-encrypt with the active key after a successful read.

- [ ] **Step 4: Implement atomic D1 operations**

Use a single conditional write for session consumption and for refresh-lease acquisition. Lease completion must match both `leaseId` and `tokenVersion`; stale workers cannot overwrite newer rotated tokens.

- [ ] **Step 5: Verify and request Security review**

```powershell
h5i capture run -- npm run test -w @spotify-wallpaper/cloudflare-worker -- crypto.test.ts db.test.ts
h5i capture run -- npm run check -w @spotify-wallpaper/cloudflare-worker
```

Launch an independent Security Reviewer with only the task goal, changed paths, schema, and commands. Triage findings as `valid`, `invalid`, `duplicate`, or `deferred`. Add a failing regression test before each valid fix.

- [ ] **Step 6: Commit**

```powershell
git add apps/cloudflare-worker
git commit -m "Secure worker credential storage"
```

### Task 4: Implement BYO Client ID OAuth And Reauthorization

**Files:**
- Create: `apps/cloudflare-worker/src/auth.ts`
- Create: `apps/cloudflare-worker/src/pages.ts`
- Create: `apps/cloudflare-worker/test/auth.test.ts`
- Modify: `apps/cloudflare-worker/src/index.ts`
- Modify: `apps/cloudflare-worker/src/db.ts`

**Interfaces:**
- Produces `GET /setup`, `POST /auth/start`, `GET /auth/callback`, and `POST /auth/reauthorize`.
- Consumes a user-owned Spotify Client ID and fixed `PUBLIC_BASE_URL`.
- Produces one Pairing Token only after a successful first authorization.

- [ ] **Step 1: Write failing OAuth tests**

Cover missing/invalid Client ID, fixed redirect URI, PKCE S256, state digest storage, encrypted verifier, Secure/HttpOnly/SameSite=Lax browser cookie, expiry, browser mismatch, replay, Spotify denial, malformed token response, callback redaction, setup-page headers, setup input non-persistence, and reauthorization that retains the existing Pairing Token.

- [ ] **Step 2: Implement `/setup` and `/auth/start`**

`/auth/start` accepts a same-origin form POST with a bounded alphanumeric Client ID. It creates random state, browser nonce, and PKCE verifier; D1 stores only state/browser digests and the encrypted verifier. It issues a 303 redirect to Spotify with fixed scopes and callback URI. It accepts no caller-provided return URL or scope.

`/setup` uses the same `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and restrictive CSP/frame protections as callback. Setup JavaScript has no external dependencies and clears Pairing Token inputs immediately after use without writing DOM copies, Web Storage, IndexedDB, cookies, URLs, or exception messages.

- [ ] **Step 3: Implement callback**

Atomically consume the session, exchange the code using PKCE and `client_id`, and generate the Pairing Token only after a valid Refresh Token is received. Store only the HMAC digest and encrypted Spotify tokens.

Callback HTML must set:

```http
Cache-Control: no-store
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
```

The inline script immediately calls `history.replaceState({}, '', '/setup/complete')`.

- [ ] **Step 4: Implement reauthorization**

`POST /auth/reauthorize` requires a valid Bearer Pairing Token from same-origin setup JavaScript. It creates an OAuth session tied to the existing `publicId`. Callback replaces encrypted tokens, clears `reauth_required`, increments `tokenVersion`, and never emits a new Pairing Token.

- [ ] **Step 5: Verify and repeat Security review**

```powershell
h5i capture run -- npm run test -w @spotify-wallpaper/cloudflare-worker -- auth.test.ts
h5i capture run -- npm run check -w @spotify-wallpaper/cloudflare-worker
```

Re-dispatch Security Review because callback, cookies, token issuance, and storage behavior changed. Fix valid findings test-first.

- [ ] **Step 6: Commit**

```powershell
git add apps/cloudflare-worker
git commit -m "Add worker Spotify PKCE authorization"
```

### Task 5: Implement Spotify Client, Normalization, Refresh Rotation, And Backoff

**Files:**
- Create: `apps/cloudflare-worker/src/spotify.ts`
- Create: `apps/cloudflare-worker/src/normalize.ts`
- Create: `apps/cloudflare-worker/test/spotify.test.ts`
- Create: `apps/cloudflare-worker/test/normalize.test.ts`
- Create: `apps/cloudflare-worker/test/refresh-concurrency.test.ts`
- Modify: `apps/cloudflare-worker/src/db.ts`

**Interfaces:**
- Produces normalized playback only, never raw Spotify JSON.
- Produces the existing `SpotifyPlaybackCommand` semantics.
- Produces a single-flight refresh path with encrypted D1 access-token cache.

- [ ] **Step 1: Write failing Spotify contract tests**

Use existing fixtures from `tests/fixtures/spotify/`. Assert track, episode, null item, missing image, malformed shape, 204, 401, 403, 429, network failure, token rotation, and `NormalizedPlayback.source === 'spotify'`.

- [ ] **Step 2: Implement PKCE token exchange and refresh**

Send `client_id` and no Basic Authorization header. Refresh 60 seconds before Access Token expiry. If Spotify omits a new Refresh Token, retain the previous one; if it returns one, atomically rotate it with the Access Token.

- [ ] **Step 3: Implement refresh coordination**

Read encrypted cached Access Token first. If refresh is required, acquire the D1 lease. The winner refreshes and commits using matching `leaseId` and `tokenVersion`; losers wait with bounded jitter, reload D1, and never call Spotify's token endpoint.

- [ ] **Step 4: Implement terminal and transient failures**

On `invalid_grant`, delete both encrypted tokens, set `auth_status='reauth_required'`, release the lease, and return `unauthorized` without retry. On Spotify 429, upsert `spotify_backoff` by Client ID and return the same `Retry-After` without calling Spotify again during that interval.

- [ ] **Step 5: Verify**

```powershell
h5i capture run -- npm run test -w @spotify-wallpaper/cloudflare-worker -- spotify.test.ts normalize.test.ts refresh-concurrency.test.ts
```

Expected: fifty concurrent expired-token requests cause exactly one refresh request.

- [ ] **Step 6: Commit**

```powershell
git add apps/cloudflare-worker
git commit -m "Add worker Spotify proxy logic"
```

### Task 6: Implement Authenticated API, CORS, Rate Limits, And Deletion

**Files:**
- Create: `apps/cloudflare-worker/src/api.ts`
- Create: `apps/cloudflare-worker/src/http.ts`
- Create: `apps/cloudflare-worker/test/api.test.ts`
- Create: `apps/cloudflare-worker/test/cors.test.ts`
- Create: `apps/cloudflare-worker/test/rate-limit.test.ts`
- Modify: `apps/cloudflare-worker/src/index.ts`
- Modify: `apps/cloudflare-worker/wrangler.jsonc`

**Interfaces:**
- Produces playback, control, and account-deletion routes.
- CORS permits only Wallpaper Engine `Origin: null` and explicit local preview origins for playback/control.
- Account management remains same-origin and never permits `Origin: null`.

- [ ] **Step 1: Write failing API security tests**

Cover missing/malformed/unknown/revoked Bearer tokens, strict command validation, request-size limit, method mismatch, arbitrary origin, preflight, redirects, 429 propagation, unavailable Spotify/D1, and secret-free error bodies.

- [ ] **Step 2: Implement playback and control**

Return the existing envelope and command semantics. Add `Vary: Origin`, explicit allowed methods/headers, no cookies, and no reflected arbitrary origins. Keep CORS separate from Bearer authentication.

- [ ] **Step 3: Implement rate limiting**

Use Cloudflare Rate Limiting bindings keyed by route plus IP for auth and route plus `publicId` for authenticated API calls. Use separate limits for auth, playback, and control. Treat these limits as abuse protection only; persisted Spotify `Retry-After` remains authoritative.

- [ ] **Step 4: Implement account deletion**

`DELETE /api/account` is called by same-origin setup JavaScript with Bearer authorization. It first writes a 35-day `public_id` tombstone to the separate deletion-ledger D1 binding, then removes token ciphertext, Client ID, Pairing digest, leases, and cache from the primary D1 database.

Every authenticated request checks the deletion ledger by `publicId` before trusting the primary credential row, so a crash after tombstone creation cannot leave the credential usable. Add a scheduled reconciler that reapplies tombstones to the primary D1 database and deletes any surviving credential rows. Test failures at every point between ledger write and primary delete. The restore runbook must run the same reconciler before traffic resumes.

- [ ] **Step 5: Verify and request Security/Operations review**

```powershell
h5i capture run -- npm run test -w @spotify-wallpaper/cloudflare-worker -- api.test.ts cors.test.ts rate-limit.test.ts
h5i capture run -- npm run check -w @spotify-wallpaper/cloudflare-worker
```

Security Reviewer checks token leakage, CORS, CSRF, command validation, deletion, and logs. Cloudflare Operations Reviewer checks bindings, environments, migrations, rate limits, restore behavior, and cost controls. Fix valid findings test-first and re-review material changes.

- [ ] **Step 6: Commit**

```powershell
git add apps/cloudflare-worker
git commit -m "Expose secure worker playback API"
```

### Task 7: Connect The Wallpaper To The Trusted Public Backend

**Files:**
- Modify: `apps/wallpaper/src/spotify/polling.ts`
- Modify: `apps/wallpaper/src/spotify/polling.test.ts`
- Modify: `apps/wallpaper/src/settings/defaultSettings.ts`
- Modify: `apps/wallpaper/src/settings/repairSettings.test.ts`
- Modify: `apps/wallpaper/src/settings/loadSettings.test.ts`
- Modify: `apps/wallpaper/src/wallpaperEngine/properties.test.ts`
- Modify: `apps/wallpaper/src/wallpaperEngine/projectJson.test.ts`
- Modify: `apps/wallpaper/public/project.json`
- Create: `apps/wallpaper/prepare-workshop.mjs`
- Modify: `apps/wallpaper/package.json`

**Interfaces:**
- Accepts HTTP loopback or the exact build-time official HTTPS origin.
- Rejects every other origin before constructing a request.
- Keeps the direct/local/mock behavior and settings schema version 1.

- [ ] **Step 1: Add failing provider-policy tests**

Assert official HTTPS succeeds, arbitrary HTTPS is rejected without a fetch, URL userinfo/query/hash/path is rejected, loopback remains valid, redirects fail, backend misconfiguration does not fall through to direct, and errors preserve the last displayed/previous track.

- [ ] **Step 2: Implement trusted-origin handling**

Release builds require `VITE_SPOTIFY_BACKEND_ORIGIN`; validate it as an origin-only HTTPS URL. Backend fetch uses:

```ts
{
  redirect: 'error',
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  headers: { authorization: `Bearer ${pairingToken}` }
}
```

- [ ] **Step 3: Make Workshop packaging deterministic**

`prepare-workshop.mjs` reads and writes structured JSON in `dist/project.json`, sets backend provider as the release default, injects the exact official origin, and fails if the origin is absent or not HTTPS. Source `project.json` remains safe for local direct/mock development.

- [ ] **Step 4: Set backend polling defaults**

For the public backend use two seconds while playing and five seconds while paused; continue local progress interpolation. Direct and local backend compatibility tests retain their documented behavior.

- [ ] **Step 5: Verify and request compatibility review**

```powershell
h5i capture run -- npm run test -w @spotify-wallpaper/wallpaper
h5i capture run -- npm run check -w @spotify-wallpaper/wallpaper
```

SpecGuard and Wallpaper Compatibility reviewers verify mock/direct/local/public paths, settings repair, previous-track retention, no Pairing Token in debug/error text, and no API-per-frame regression.

- [ ] **Step 6: Commit**

```powershell
git add apps/wallpaper
git commit -m "Connect wallpaper to public backend"
```

### Task 8: Add CI, Staging, Production, And Operational Runbooks

**Files:**
- Create: `.github/workflows/cloudflare-worker-ci.yml`
- Create: `docs/operations/cloudflare-worker-deploy.md`
- Create: `docs/operations/cloudflare-worker-key-rotation.md`
- Create: `docs/operations/cloudflare-worker-incident-response.md`
- Create: `docs/operations/cloudflare-worker-restore.md`
- Modify: `package.json`

**Interfaces:**
- Produces reproducible local, staging, and production verification.
- Requires a fixed production custom domain before Spotify setup.

- [ ] **Step 1: Add CI**

Run Worker tests/checks, wallpaper tests/checks, Rust tests, secret-pattern scans, `git diff --check`, and generated Worker-type consistency. CI must not deploy from pull requests.

- [ ] **Step 2: Separate environments**

Use distinct D1 databases, encryption/HMAC keys, rate-limit namespaces, and domains for preview and production. Production deploy requires Workers Paid and a custom HTTPS domain.

- [ ] **Step 3: Add deployment and migration runbooks**

Document D1 create/migrate commands, `wrangler secret put` for encryption and HMAC keyrings, smoke tests, rollback, and release artifact build with the exact production origin. Do not place real values in commands or files.

- [ ] **Step 4: Add key rotation and restore runbooks**

Add active/previous key rollout, lazy re-encryption verification, old-key retirement criteria, D1 Time Travel restore, and deletion-record replay before traffic resumes.

- [ ] **Step 5: Add monitoring without sensitive logs**

Use an Analytics Engine binding for aggregate metrics only: route class, status class, latency bucket, rate-limit event, refresh outcome class, and cost. Configure budget alerts at 50%, 80%, and 100%. Do not enable request URL invocation logs.

- [ ] **Step 6: Verify and commit**

```powershell
git diff --check
```

Commit:

```powershell
git add .github package.json docs/operations
git commit -m "Add public backend operations"
```

### Task 9: Update User Documentation, Privacy, And Release Gates

**Files:**
- Modify: `README.md`
- Modify: `docs/user-guide.md`
- Modify: `docs/qa-checklist.md`
- Create: `docs/privacy.md`
- Create: `docs/release-notes-public-backend-beta.md`
- Create: `docs/phase-reports/cloudflare-worker-public-backend.md`
- Modify: `.github/workflows/spotify-auth-pages.yml`

**Interfaces:**
- Documents BYO setup, reauthorization, deletion, and legacy direct mode.
- Prevents the existing shared GitHub Pages auth build from being presented as the public one-click path.

- [ ] **Step 1: Document BYO setup**

Explain creating one Spotify app, registering the exact callback URI, Premium/Development Mode restrictions, opening `/setup`, pasting the one-time Pairing Token into Wallpaper Engine, and never sharing it.

- [ ] **Step 2: Document reauthorization and deletion**

Explain six-month expiry, `unauthorized` status, same Pairing Token reauthorization, account deletion, backup retention, Spotify-side disconnect, and incident contact.

- [ ] **Step 3: Mark direct auth as legacy**

Keep `swpt1.` and direct mode for compatibility, but stop describing the shared GitHub Pages Client ID flow as the Workshop default. Change the Pages deployment workflow to manual `workflow_dispatch` for developer-only legacy testing so its output cannot accidentally become the managed public path.

- [ ] **Step 4: Add the policy publication checklist**

General Workshop release requires:

```text
Spotify approval or documented policy-compatible redesign
uncropped artwork and required Spotify attribution/link
privacy policy published
production custom domain fixed
limited beta completed
72-hour Wallpaper Engine soak completed
cost and incident alerts verified
```

- [ ] **Step 5: Complete the phase report and commit**

```powershell
git diff --check
git add README.md docs .github/workflows/spotify-auth-pages.yml
git commit -m "Document public backend beta"
```

### Task 10: Final Verification And SubAgent Review Loop

**Files:**
- Modify as required by valid findings only.
- Finalize: `docs/phase-reports/cloudflare-worker-public-backend.md`

**Implementation:**
- Verify all four runtime paths and both Cloudflare environments.

**SubAgent Review:**
- Launch independent Security, SpecGuard, Wallpaper Compatibility, Cloudflare Operations, and Spotify Policy reviewers.
- Give each reviewer only the goal, relevant changed paths, current diff/commit range, test commands, and required docs.
- Ask for behavioral bugs, regressions, missing tests, unsafe assumptions, convention violations, persistence/concurrency risks, and user-visible failure cases.

**Review Loop:**
- Classify every finding as `valid`, `invalid`, `duplicate`, or `deferred`.
- Add a failing regression test before fixing each valid finding.
- Re-run targeted checks.
- Re-dispatch the affected reviewer whenever a fix changes auth, crypto, persistence, API contract, CORS, settings behavior, or release policy.
- Stop only when no valid finding remains. Policy findings may block general release even when implementation is complete.

**Verification:**

- [ ] **Step 1: Run all automated gates**

```powershell
h5i capture run -- npm run test -w @spotify-wallpaper/cloudflare-worker
h5i capture run -- npm run check -w @spotify-wallpaper/cloudflare-worker
h5i capture run -- npm run test -w @spotify-wallpaper/wallpaper
h5i capture run -- npm run check -w @spotify-wallpaper/wallpaper
h5i capture run -- cargo test
git diff --check
codegraph index
```

- [ ] **Step 2: Run staging integration**

Verify initial auth, playback, every control command, 50-request refresh concurrency, Spotify 429, Worker rate limits, `invalid_grant`, reauthorization, deletion, arbitrary-origin rejection, and D1 failure.

- [ ] **Step 3: Inspect secret surfaces**

Confirm Worker bundle, wallpaper bundle, D1 export, custom metrics, errors, stored/cached pages, CI artifacts, and Cloudflare configuration contain no plaintext token, code, verifier, callback URL, or key. The only permitted plaintext Pairing Token surface is the successful initial OAuth callback's one-time `Cache-Control: no-store` response shown to that browser; static source and every persisted artifact must remain secret-free.

- [ ] **Step 4: Run Wallpaper Engine soak**

Run at least 72 hours across playing, paused, stopped, track changes, network loss, Worker deploy, Access Token refresh, and backend outage. Confirm the wallpaper preserves its last safe display and recovers polling.

- [ ] **Step 5: Record reviewer outcomes**

The phase report lists reviewer names/roles, findings, classifications, fixes, deferred policy blockers, and exact verification commands/results.

- [ ] **Step 6: Commit**

```powershell
git add .
git commit -m "Verify public Spotify backend"
```

## Completion Criteria

- The Worker backend passes all automated and staging tests.
- D1, logs, metrics, errors, bundles, and docs contain no plaintext secret.
- Fifty concurrent requests perform one Spotify refresh.
- `invalid_grant` stops retries and provides working reauthorization.
- Account deletion immediately invalidates the Pairing Token and removes live secrets.
- Arbitrary origins and redirects never receive the Pairing Token.
- Mock, direct, loopback Rust, and public Worker modes all pass.
- No unresolved valid Security, SpecGuard, Compatibility, or Operations findings remain.
- General Workshop publication remains blocked until the Spotify policy gate is explicitly closed.

## Execution Order

Use SubAgent-driven development. Keep Worker and wallpaper write scopes separate:

1. Spec worker: Task 1.
2. Worker foundation worker: Tasks 2-3.
3. Security review and fix loop.
4. OAuth worker: Task 4.
5. Security review and fix loop.
6. Spotify/API worker: Tasks 5-6.
7. Security and Operations review and fix loop.
8. Wallpaper compatibility worker: Task 7.
9. SpecGuard and Compatibility review and fix loop.
10. Operations/docs worker: Tasks 8-9.
11. Independent final reviewers and Task 10 verification.
