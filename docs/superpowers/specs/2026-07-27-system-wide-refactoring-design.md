# System-Wide Refactoring Design

## Status

Approved on 2026-07-27 after independent Architecture SpecGuard, Worker
protocol, and Security review. Each review returned PASS with no unresolved
valid findings. The user has authorized autonomous execution.

Authoritative baseline:

```text
Feature/cloudflare-worker-public-backend
455dcf183c62a9b9162c081a1d8fd38aae9e1dc5
```

Implementation branch:

```text
Fix/system-wide-refactor
```

The implementation uses the primary checkout at
`D:\Git\SpotifyWallPaper`. It does not use a linked worktree.

## Goal

Refactor the repository as one coherent system rather than optimizing
individual files in isolation. The result must have:

- one reproducible source branch and one complete specification set;
- explicit ownership for settings, credentials, playback contracts, runtime
  lifecycle, visual logic, native integration, and remote persistence;
- deterministic browser mock behavior;
- equivalent Rust/WASM and TypeScript fallback behavior;
- testable security and performance invariants;
- smaller composition roots with stable interfaces;
- reproducible release artifacts tied to source revisions.

The refactor preserves supported user-facing behavior and data formats unless
a behavior is unsafe, contradictory to the approved specifications, or
demonstrably defective.

## Non-Goals

- Do not add new visual effects or product features during structural phases.
- Do not reintroduce Lyrics/LRC in v1.
- Do not replace the Wallpaper Engine Web Wallpaper with a native renderer.
- Do not make Tauri, Rainmeter, WASM, Spotify, or the public Worker mandatory
  for browser mock startup.
- Do not merge OAuth, persistence, or session implementations across browser,
  Tauri, loopback Rust, and Cloudflare environments merely because they share
  protocol concepts.
- Do not use the untracked Worker or WASM build outputs as source.
- Do not rewrite or squash the reviewed public-backend history.

## Architectural Problems Being Solved

### Repository truth is fragmented

`develop` is 37 commits behind the approved baseline. Required specifications
are divided between tracked Feature files and ignored local files. CI branch
filters do not match the actual integration branches. Generated Worker and
WASM artifacts remain in the working directory without provenance.

### Settings and credentials share multiple sources of truth

Settings types, defaults, repair, migrations, presets, Wallpaper Engine
property merging, Configurator export, Rust validation, and Tauri validation
are independently implemented. Credentials live inside the same serializable
object as ordinary preferences. The current Feature also copies a Refresh
Token into plaintext `localStorage`.

### Runtime orchestration lives in UI roots

`apps/wallpaper/src/App.svelte` owns networking, polling, credentials,
timers, transitions, theme extraction, audio, visualizer state, controls,
markup, and CSS. `apps/configurator/src-tauri/src/main.rs` owns OAuth,
loopback HTTP parsing, Spotify exchange, Rainmeter validation and writing,
scheduling, browser launch, redaction, and command registration.

### Protocols are duplicated without full conformance

Wallpaper, loopback Rust, and Cloudflare Worker independently normalize
playback and validate controls. Their accepted fields, range behavior,
204 behavior, retry handling, and error envelopes differ.

### WASM is optional but not semantically equivalent

Normal builds do not regenerate WASM. The TypeScript fallback and Rust
implementation differ for safe-area layout and unequal visualizer sample
lengths. No real-WASM conformance test or ABI version handshake exists.

### Security-critical services are difficult to change safely

The Worker has strong tests but large auth, database, refresh, and Spotify
modules. The loopback backend and Tauri have substantially weaker
characterization coverage. Module extraction before fixing those contracts
would turn reviewed invariants into implicit behavior.

## Considered Approaches

### 1. Contract-first incremental refactoring on `455dcf1` — selected

First make repository truth and executable contracts reproducible. Add
characterization and conformance coverage. Then extract runtime and service
boundaries one subsystem at a time.

Advantages:

- preserves all reviewed OAuth and Worker history;
- supports phase-by-phase rollback;
- makes every extraction evidence-driven;
- fixes cross-application drift before rearranging files;
- permits independent SpecGuard and security review per phase.

Trade-offs:

- requires temporary adapters while consumers migrate;
- produces more phase commits than a rewrite;
- delays cosmetic file splitting until contracts are stable.

### 2. UI-shell-first decomposition

Split Svelte and Tauri composition roots immediately, then repair contracts
inside the new modules.

Advantages:

- quickly reduces visible file size;
- produces immediately understandable component files.

Rejected because:

- moves duplicated settings and lifecycle defects into new files;
- lacks sufficient timer, provider, credential, and WASM characterization;
- creates churn without resolving ownership.

### 3. Big-bang rewrite or reimplementation from `develop`

Build a new architecture in parallel and replace the current apps at once.

Advantages:

- no migration adapters;
- maximum freedom in the final directory layout.

Rejected because:

- discards 37 commits of reviewed behavior and security reasoning;
- multiplies OAuth, credential, and migration risk;
- cannot be meaningfully reviewed or rolled back phase-by-phase;
- violates the repository's required implementation and review order.

## Target Architecture

### Repository and specification ownership

Tracked repository files are the only normative source.

```text
AGENTS.md
docs/
  README.md
  00-*.md ... 30-*.md
  operations/
  superpowers/specs/
  superpowers/plans/
```

`.codex/`, generated Worker configs, Worker distributions, WASM packages,
Vite outputs, Cargo targets, and deployment outputs remain ignored.

CI has three explicit layers:

1. repository and cross-workspace baseline on pull requests, `develop`, and
   `master`;
2. path-scoped Worker security/release verification;
3. manual deployment/release workflows with environment approval.

The legacy static Spotify auth page remains a compatibility surface. It is not
an automatically deployed replacement for public Worker setup.

### Shared settings contract

Create `packages/settings-contract/` as the TypeScript runtime authority for:

- schema version;
- settings types used by applications;
- defaults;
- migrations;
- repair and validation;
- layout presets;
- import/export;
- secret-free serialization;
- settings diff classification.

`settings-contract` owns its setting-related types and has no dependency on
`packages/shared-types` or any app. `packages/shared-types` may depend on and
re-export those types during compatibility migration; the reverse dependency
is forbidden.

The settings contract contains preferences only. It does not contain live
credential values.

```ts
interface WallpaperPreferences {
  schemaVersion: 2;
  spotify: {
    provider: 'mock' | 'direct' | 'backend';
    backendOrigin?: string;
    pollIntervalPlayingMs: number;
    pollIntervalPausedMs: number;
  };
  // visual and integration preferences
}

type CredentialInput =
  | { kind: 'direct'; clientId: string; refreshToken: string }
  | { kind: 'backend'; pairingToken: string };

interface CredentialRef {
  readonly kind: 'none' | 'direct' | 'backend';
  readonly revision: number;
  readonly opaqueCredentialRef: unique symbol;
}
```

Rules:

- version 2 defaults to provider `mock`;
- preferences can be serialized, exported, logged in redacted form, and
  migrated;
- raw credential inputs are transient, values are vault-only, and neither has
  a generic serializer or public state projection;
- public-backend Pairing Tokens are never exported;
- direct Refresh Token export remains explicit legacy behavior only;
- the wallpaper does not automatically persist credentials to
  `localStorage`;
- future schema versions are rejected to safe defaults with a warning rather
  than silently downgraded and written back.

Version 2 is required because removing credentials from the serializable
settings shape and making provider selection explicit are breaking schema
changes. Two deliberately separate boundaries handle legacy input:

1. `containLegacyBrowserSecrets(storage)` is an idempotent startup side
   effect that completes before normal settings migration/repair or provider
   startup. Its allowlisted legacy parser exists only for containment. It
   removes `spotify-wallpaper-spotify-credentials` without using its value.
   For a valid unversioned/v1 `spotify-wallpaper-settings` document, it writes
   back only the allowlisted known v1 preference fields and drops credential
   fields. A malformed or future-version document is removed in full rather
   than partially rewriting unknown fields that may contain secrets. No value
   is copied into another browser store, warning, error, provider, or report.
2. `migratePreferencesV1ToV2(input, source)` is a pure function. It has no
   storage access and repairs/retains preferences, including `albumArt`,
   `text`, Rainmeter, and both polling intervals.

A complete Wallpaper Engine property snapshot may create a memory-only
credential overlay only after it has selected its provider. Configurator
imports ignore credential fields by default; the existing direct Refresh
Token compatibility path requires a separate user-initiated native
import/export command and remains memory-only. Cleanup and pure migration
both handle repeated execution, unavailable storage, and corrupt input
without reflecting removed values.

`containLegacyBrowserSecrets` returns a secret-free readiness result. If
sanitized `setItem` fails, it attempts to remove the entire settings document.
If any credential-key removal, fallback document removal, or storage access
fails, the runtime stays in deterministic mock mode, disables every network
provider, and shows only a fixed cleanup-required warning. It retries on the
next startup or explicit repair action and never starts networking while
uncertain that a legacy browser secret remains.

Existing users whose only credential copy is the unsafe browser cache must
reauthorize. This deliberate one-time compatibility break is preferable to
silently retaining or relocating plaintext secrets.

Migration by input surface:

| Input | Version 2 preference result | Credential result |
| --- | --- | --- |
| Unversioned or v1 settings JSON | Pure, idempotent v1-to-v2 migration followed by repair | Secret fields ignored by default and never written to v2 |
| `settings_json` Wallpaper Engine property | Same v1-to-v2 preference migration | Embedded secrets ignored; only dedicated credential properties may create an overlay |
| Dedicated Wallpaper Engine Spotify properties | Provider preference is applied after the complete snapshot | Exact direct or backend overlay created in memory; an invalid explicit provider is an error, never mock/direct fallback |
| `swpt1.<base64url-json>` | Not a settings schema and never converted to v2 JSON | Legacy direct-only parser keeps the exact v1 grammar and 20,000-character limit, then creates a memory-only overlay |
| Configurator import | v1-to-v2 preferences by default | Direct legacy credential import requires a separate native file-picker/parser opt-in that returns presence only; Pairing Token is always rejected |
| Legacy browser storage | Preferences repaired after secret fields are removed | Delete-only migration; no provider startup and no secret relocation |

Migration fixtures cover every row, repeated migration, malformed input,
future versions, missing storage APIs, and secret-free warnings.

After legacy browser secrets are scrubbed, a stored v1 default
`playbackProvider: 'direct'` with no authorized credential source migrates to
the safe v2 mock default with a warning. In an explicit external settings or
host snapshot, selecting direct/backend without its matching dedicated input
is instead an invalid configuration and never a fallback.

`packages/shared-types/` keeps domain DTOs and re-exports stable public types,
but executable settings behavior moves to `settings-contract`.

`CredentialInput`, the private vault, and `CredentialRef` belong to the
provider/runtime contract, not to `settings-contract`. Raw input is captured
at one boundary and is never published as runtime state or retained as an
event payload.

Credential sources and ownership are surface-specific:

| Surface | Accepted source | Persistence owner | Rotation and clear contract |
| --- | --- | --- | --- |
| Browser preview | Explicit session input only | None | Lost on reload; logout and dispose drop the only owned reference |
| Wallpaper Engine | Complete property snapshot | Wallpaper Engine host | Rotated direct tokens stay in the runtime session; the UI reports reauthorization when the host cannot accept an explicit update |
| Configurator | Explicit user input or OAuth result | Process-memory native credential vault behind narrow commands | Vault atomically replaces rotation, clears on logout, shutdown, or `invalid_grant`, and never returns secrets through settings/debug commands |
| Loopback backend | OAuth result | Encrypted backend storage | Storage transaction owns rotation, reset, and terminal reauthorization |
| Public Worker | OAuth result | Encrypted D1 token row | Versioned lease completion owns rotation; deletion and terminal `invalid_grant` clear by generation |
| Legacy browser storage | Read never; delete-only migration | None | Both dedicated-cache and settings-embedded secrets are scrubbed before provider startup |

Source precedence is explicit session/native or host input, then `none`.
Legacy browser storage never participates in precedence. The runtime assigns
and monotonically increments credential revisions; untrusted inputs cannot
select a revision. A provider captures one revision, rejects completions from
older revisions, and clears its owned references on replacement, logout,
`invalid_grant`, deletion, or disposal.

Within one complete host snapshot, the explicit provider kind selects exactly
one matching credential input. Conflicting direct and backend values are not
merged or retained as fallback; an incomplete selected input produces a fixed
invalid-configuration state and no network request.

JavaScript cannot guarantee physical string-memory zeroization; the contract
minimizes copies and deterministically drops owner references. Native Rust
vault buffers use zeroizing containers on replacement and drop.

Refresh Token rotation cannot be made durable by the wallpaper alone when the
source is a Wallpaper Engine property. The direct provider therefore keeps a
rotated token only for the current process and exposes a secret-free
`reauthorizationRequired` status if the session ends or persistence cannot be
updated. Installing Tauri is never required for browser mock, Wallpaper
Engine host input, loopback backend, or public-backend operation.

The Configurator does not create an automatic credential database. OAuth
results remain in a native process-memory vault. On an explicit legacy export
action, a narrow native command writes the selected settings/token artifact or
clipboard value without returning the secret through ordinary WebView state.
Closing the Configurator clears the vault. The durable direct-mode copy, when
the user deliberately chooses that legacy path, remains the Wallpaper Engine
property managed by the host.

Credential values are held only inside private provider credential-vault
closures. Providers are created from an opaque `CredentialRef`; no vault
method returns a raw value. The readonly public runtime state projects
`{ kind, present, revision }` and never exposes credential input, raw values,
a generic getter, or a secret-bearing serializable snapshot.

The currently isolated `crates/config-schema` is removed after its useful
test vectors have moved to the shared contract. Tauri uses the shared
Configurator validation path; Rust remains responsible for visual core and
native security boundaries, not a disconnected duplicate of the complete
web settings object.

Removing `config-schema` does not remove native validation. Every Tauri
command accepts a narrow Rust DTO with unknown fields denied and validates
security-sensitive invariants again at the IPC boundary. Generated fixtures
may keep TypeScript and Rust DTOs aligned, but a WebView caller is always
treated as untrusted.

### Playback and provider contracts

Split shared DTO declarations by responsibility under
`packages/shared-types/src/`:

```text
playback.ts
provider.ts
settings.ts        # compatibility re-exports during migration
theme.ts
visualizer.ts
rainmeter.ts
index.ts
```

Create versioned golden fixtures in:

```text
tests/contracts/provider-v1/
```

Fixtures define:

- upstream Spotify HTTP `204 No Content` as a transport case, separately from
  the provider-v1 normalized success envelope whose value has
  `itemType: 'none'`;
- success and error envelopes;
- error taxonomy and bounded `retryAfterMs`;
- exact playback-control grammar;
- unknown-field rejection;
- safe integer and range rules.

Spotify-backed providers require `source: 'spotify'` and finite `fetchedAt`;
only the deterministic mock provider may emit `source: 'mock'`. Nested track,
episode, device, context, image, and restriction fields are validated rather
than accepted by a shallow top-level guard.

Every provider must conform:

- direct browser provider;
- loopback Rust backend;
- public Worker backend;
- deterministic mock provider.

Provider creation returns a discriminated result:

```ts
type ProviderSelection =
  | { kind: 'mock'; provider: PlaybackProvider }
  | { kind: 'ready'; provider: PlaybackProvider }
  | { kind: 'invalid'; error: SpotifyPlaybackError };
```

An explicit invalid backend never becomes direct or silent mock mode.

All network providers use bounded response reads, abortable deadlines,
redirect denial, non-reflective fixed errors, and generation checks. Backend
requests use `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`; HTTP
is allowed only for numeric loopback and HTTPS only for the exact
release-configured origin. A Pairing Token cannot be sent until that complete
origin check succeeds.

The direct provider has an explicit authentication state machine shared as
fixtures with local and Worker semantics where applicable:

- one refresh owner for concurrent poll and control calls;
- atomic in-memory Access/Refresh Token rotation for one credential revision;
- retain the old Refresh Token if Spotify omits rotation;
- clear the active revision and enter terminal reauthorization on
  `invalid_grant`;
- invalidate, refresh, and retry once after an early Spotify 401;
- discard stale completions after credential replacement or disposal;
- abort outstanding requests and clear owned references on disposal.

### Wallpaper runtime

Create a framework-independent runtime under:

```text
apps/wallpaper/src/runtime/
  WallpaperRuntime.ts
  runtimeState.ts
  runtimeEvents.ts
  settingsDiff.ts
  timers.ts
```

`WallpaperRuntime` owns:

- preferences and opaque credential references;
- provider selection and disposal;
- polling scheduling and backoff;
- playback history;
- progress interpolation;
- clock scheduling;
- audio bridge lifetime;
- visualizer idle scheduling;
- transition lifetime;
- theme request generation and stale-result rejection.

It exposes readonly state plus explicit commands. Svelte owns rendering only.

All external lifetimes return disposers. Reapplying settings restarts only
affected subsystems. A numeric credential revision replaces secret-bearing
JSON identity strings.

Create presentational components:

```text
components/AlbumLayer.svelte
components/TrackInfoLayer.svelte
components/PlayerControls.svelte
components/SeekbarLayer.svelte
components/ClockLayer.svelte
components/DebugOverlay.svelte
```

`App.svelte` becomes the composition shell. Network requests, timers,
settings repair, and secret handling never live in a component.

The current implicit `album-only` mode becomes an explicit preference/preset
or is removed. It must not silently overwrite layout units or hide the
required mock title, artists, and clock.

Track transitions keep a complete immutable `DisplaySnapshot` containing the
previous playback, theme, participating layout values, and required
visualizer state until completion.

### WASM and visual logic

`crates/visual-core` remains deterministic pure logic. It owns only algorithms
that provide measured value over a TypeScript implementation.

Layout CSS construction and viewport safe-area behavior remain
TypeScript/CSS-owned. The Rust layout ABI is removed because it has no hot-path
benefit and currently disagrees with the browser fallback. Rust retains
visualizer normalization and readability calculations, with equivalent
TypeScript fallbacks for mock-safe startup.

The ABI is versioned:

```ts
interface VisualCoreCapabilities {
  abiVersion: 1;
  functions: readonly string[];
}
```

Rules:

- release builds regenerate WASM from current Rust sources;
- generated packages record source revision and source hash;
- TypeScript validates ABI version and output shapes;
- actual-WASM tests and fallback tests consume the same fixtures;
- missing WASM preserves mock startup without semantic visualizer or
  readability changes;
- UI code talks only to one visual-core adapter;
- visualizer and readability behavior must be equal within documented numeric
  tolerances;
- JSON-string frame transport is replaced with typed arrays where it is on a
  hot audio path;
- the Rust layout JSON ABI, dead animation helpers, and other unexposed
  algorithms are removed.

Before the Rust layout ABI is removed, golden fixtures freeze the chosen
TypeScript/CSS viewport, safe-area, anchor, and saved-layout semantics. The
same fixtures characterize the old Rust output so every intentional
difference is recorded rather than hidden by the structural change.

Typed arrays contain only transient Wallpaper Engine spectrum/amplitude
samples, never PCM audio. They are not persisted, recorded, logged, or sent
over a network. The adapter owns the input/output shapes, copies each input
into an owned WASM buffer, reacquires views after any memory growth, validates
finite output, and publishes explicit absolute/relative numeric tolerances to
the fallback fixtures.

### Configurator and Tauri

The Configurator imports defaults, repair, presets, and export behavior from
`settings-contract`.

Tauri modules become:

```text
src-tauri/src/
  commands/
  oauth/session.rs
  oauth/loopback.rs
  oauth/spotify.rs
  rainmeter/payload.rs
  rainmeter/path_policy.rs
  rainmeter/writer.rs
  rainmeter/scheduler.rs
  security/redaction.rs
  app_state.rs
  main.rs
```

`main.rs` registers state and commands only.

The native boundary is authoritative even if the WebView is modified:

- replace `csp: null` with a restrictive application CSP;
- grant only the exact commands and window capabilities required by the
  Configurator; do not expose generic shell or filesystem access;
- deny arbitrary navigation and new windows, and permit external opening only
  for the exact Spotify Accounts HTTPS origin and `/authorize` path;
- deserialize bounded command-specific Rust DTOs with unknown fields denied;
- return credential presence, status, or an opaque vault handle from ordinary
  commands, never raw credentials, callback URLs, or upstream error bodies;
- keep OAuth token exchange and the credential vault native; explicit legacy
  export is a separate user-initiated native sink with its own allowlist and
  audit tests.

A legacy export capability is single-use and bound to the current process,
window label, and vault revision with a short expiry. File export requires a
destination capability returned by the native save dialog. Clipboard export
requires a native confirmation surface at the moment of use. Ordinary IPC,
replayed capabilities, another window, a replaced vault revision, and
background JavaScript cannot trigger either sink.

OAuth rules:

- exact numeric loopback host, explicit port, and exact callback path;
- bounded request line and upstream response;
- expiring, single-use state;
- shared validation for automatic and pasted callbacks;
- no callback/code/state/verifier reflection;
- no-store, no-referrer, CSP, frame denial, and `nosniff`;
- Spotify-only external authorization URL;
- redirect denial and timeouts.

Rainmeter rules:

- deserialize an allowlisted `RainmeterOutput` DTO with unknown fields denied;
- recursively reject every credential and OAuth field;
- accept a destination only from the native save dialog and retain it as an
  opaque path capability rather than accepting arbitrary WebView path strings;
- allow one regular local `.json` file under the selected existing parent;
  reject UNC paths, device namespaces, alternate data streams, reserved
  Windows names, reparse points, and symlinks, and never create parent
  directories;
- use atomic same-directory replacement;
- create the random temporary file with create-new semantics, flush it, never
  weaken inherited ACLs, and preserve the previous file if replacement fails;
- report scheduler failures;
- stop the previous writer before replacement;
- never affect wallpaper runtime.

### Loopback Rust backend

The loopback backend remains independent from the Worker implementation but
conforms to the same provider fixtures.

Target modules:

```text
routes/
auth_sessions/
token_coordinator/
storage/
spotify_client/
contract/
```

Required behavior:

- loopback bind only;
- bounded, expiring OAuth sessions;
- refresh single-flight;
- atomic Refresh/Access Token rotation;
- terminal reauthorization state on `invalid_grant`;
- one invalidate/refresh/retry after Spotify 401;
- bounded persistent 429 handling;
- timeouts and redirect denial;
- strict control grammar;
- fixed non-reflective errors.

The local Pairing Token has exact grammar
`swpl1.<43-character-base64url-secret>` where the decoded secret is exactly
256 CSPRNG bits; the total length is exactly 49 characters. It is generated
only by the backend, cannot be user-selected, is parsed exactly before any
hash/KDF work, and is accepted only as a Bearer authorization value. Invalid
alphabet, padding, prefix, length, duplicate authorization, or oversized
header fails with a fixed error. Verification is constant-time after exact
parse.

Initial provisioning shows the Pairing Token once on a callback response with
`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, restrictive CSP,
frame denial, and `nosniff`, using one visible text node and no JavaScript
state, hidden input, or DOM attribute copy. It never appears in a URL, log,
generic API envelope, debug state, storage, or reflected error.

The backend owns a versioned SQLite schema and transactional migrations.
Existing encrypted credential rows must survive a successful migration;
unknown future schemas, corruption, missing key material, or partial
migration fail closed without overwriting the database. Refresh/Access
Tokens use independently nonced AES-GCM records bound by AAD to schema,
credential identity, Client ID, and field name. The encryption key comes from
HKDF over the user-held Pairing Token and a per-database random salt. The
database stores only the salt and a domain-separated constant-time verifier,
never enough material to derive the key by itself; the Pairing Token never
enters the database, source tree, command line, or logs.

Open-time migration changes metadata/schema only and marks legacy ciphertext
rows; it cannot re-encrypt because the Pairing Token is not available.

An existing pre-ledger database is eligible for exactly one authenticated
bootstrap only when its schema fingerprint exactly matches the approved
baseline and its legacy Pairing Token is exactly the former 43-character
base64url encoding of 256 CSPRNG bits. The backend starts in locked migration
mode and accepts that value only through a dedicated loopback migration UI,
never as a general API Bearer token. It verifies the old salted digest,
derives the old key, and decrypts/validates every credential before changing
state.

Successful bootstrap creates an atomically written `pending` reset ledger
with epoch 1 and a random migration ID, then uses one SQLite transaction to
re-encrypt under the canonical `swpl1.<same-secret>` token, current AAD/new
salt/verifier, epoch, and migration ID. It finally marks the ledger `active`.
A pending-ledger journal makes interruption before/after the DB commit
fail-closed and resumable only with the same verified legacy token. The new
canonical token is shown once through the protected provisioning sink so the
user can update Wallpaper Engine.

Before this one-time bootstrap completes, the legacy installation had no
rollback anchor; that residual first-upgrade limitation is explicit. After
activation, old rows/ledgers mismatch the active epoch/migration ID. Any
schema mismatch or verification/decrypt/validation/encrypt/commit failure
leaves the legacy DB unchanged and requires quarantine plus reauthorization.

Database, WAL, reset-ledger, and application-managed backup handling use
user-only filesystem permissions where the platform supports them. A
monotonic credential epoch lives in an atomically replaced reset ledger
outside the database and is excluded from managed backups. The epoch is part
of token AAD and every credential row.

The reset ledger may be created only for a verified fresh provisioning state
with no database/WAL/SHM/managed backup or through the exact authenticated
legacy bootstrap above. In every other case, if an artifact exists and the
ledger is missing, truncated, corrupt, future-versioned, or older than a
row/backup epoch, startup fails closed. Recovery quarantines and invalidates
all credential database/WAL/managed-backup material and requires
reauthorization; it never reconstructs an epoch from arbitrary database
metadata.

Reset provides logical invalidation plus managed-data deletion/rejection:
it increments the reset-ledger epoch first, drops all in-memory credentials,
then transactionally clears credentials, verifier, sessions, and caches,
checkpoints/truncates WAL, and deletes or permanently rejects
application-managed backups from older epochs. A crash after the epoch
increment fails closed because old rows no longer match. New provisioning
uses a new salt, verifier, and key generation.

Failure-injection tests prove that the old Pairing Token, an old database
file, residual WAL, and every application-managed backup cannot be restored
through the current epoch. The project does not claim forensic erasure from
OS snapshots, disk-recovery tools, or external backups that also roll back
the reset ledger; this limitation is documented and those restores are
outside the application's trust boundary.

Storage tests also cover atomic token rotation, migration rollback, reset,
backup/restore, abnormal token lengths, constant-time verification paths, and
the rule that an in-memory token cannot become newer than durable state.
They also cover missing/truncated/future ledgers, interrupted atomic
replacement, an older ledger beside a newer database, and fresh-only ledger
creation, plus exact-schema legacy bootstrap, wrong token/schema rejection,
pending-journal crash points, canonical-token handoff, and second-bootstrap
rejection.

Worker D1 lease or storage code is not copied into Rust. Only state-machine
fixtures and protocol contracts are shared.

### Cloudflare Worker

The reviewed Worker remains the reference implementation for remote
credential handling. Before file movement, add missing race and sink tests.
Every requirement in the approved baseline `docs/25-public-backend.md` is
normative. The summary below cannot be interpreted as deleting a requirement
that it does not repeat. This design and the accompanying
`docs/25-public-backend.md` correction deliberately strengthen the setup-proof
threat model described below.

The HTML proof and Cookie are not human-presence or browser-possession
evidence: a server can fetch both and create its own setup session. They
prevent cross-site browser CSRF and replay because an attacker cannot make a
victim browser send the attacker's `SameSite=Strict` Cookie. Server-originated
session creation is instead bounded by rate limits and outstanding-session
caps, and cannot complete victim authorization without a separate user action.

`GET /setup` is rate-limited before any D1 write, uses an atomic conditional
insert/count that permits at most three unexpired sessions per keyed issuer
digest even under concurrent requests, and fails closed if the limiter is
unavailable. It creates a single-use D1 session with nonce/issuer digests,
purpose, legal-document versions, and ten-minute expiry. The raw nonce exists
only in the exact
`__Host-swp-setup=<43-character-base64url-random>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=600`
Cookie with no `Domain`; the signed HTML proof is bound to that session.
`/auth/start` is rate-limited first, then requires the exact Cookie, proof, and
current legal acceptance, atomically consumes the session, and clears the
Cookie on every terminal result.

If `GET /setup` receives an exact still-valid setup Cookie, one D1 transaction
retires that Cookie's previous unconsumed session and inserts its replacement
without increasing the issuer's outstanding count. A missing, malformed,
expired, or unmatched Cookie cannot retire any row. This bounded replacement
lets a user recover repeatedly when a rolling deployment sends new setup to an
older start handler, while the three-session issuer cap still bounds
server-created sessions.

`AUTH_FLOW_VERSION_MISMATCH` occurs before session lookup/mutation and is a
recoverable compatibility result, not a terminal session result. A hardened
start handler preserves an exactly parsed hardened setup Cookie on this result
so a later hardened GET can retire/replace the row; malformed setup Cookies
are cleared. This also covers the alternating
new-setup → old-start → old-setup → new-start → new-GET sequence.

Mixed old/new edge isolates fail closed through exact protocol domains:

```text
setup proof       swps2.<sessionId>.<expiresAtMs>.<signature>
OAuth state       swpo2.<43-character-base64url-random>
confirmation      swpc1.<confirmationId>.<expiresAtMs>.<signature>
```

`sessionId` and `confirmationId` are unpadded base64url encodings of 128
random bits (22 characters), `expiresAtMs` is exactly 13 ASCII decimal digits,
and each signature is an unpadded 32-byte HMAC-SHA-256 value (43 characters).
The exact UTF-8 HMAC inputs are
`spotify-wallpaper:setup-session-v2:<sessionId>:<expiresAtMs>` and
`spotify-wallpaper:oauth-confirm-v1:<confirmationId>:<expiresAtMs>`. OAuth
state is 32 random bytes, and its stored digest is HMAC-SHA-256 over exact
UTF-8 `spotify-wallpaper:oauth-state-v2:<complete-swpo2-state-value>`.

The new OAuth Cookie is exactly
`__Host-swp-oauth-v2=<43-character-base64url-random>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
with no `Domain`. Every parser requires its exact prefix, part count, alphabet,
lengths, purpose, and database protocol version. Signature verification uses
WebCrypto verification or an equivalent constant-time comparison after exact
parsing and rate limiting. The baseline stateless setup parser rejects `swps2`
by shape, and the baseline callback rejects `swpo2` before D1 lookup because it
is not a raw 32-byte base64url state. New parsers reject all baseline
proof/state/Cookie formats. No handler retries, downgrades, or translates
across versions.

The approved `455dcf1` baseline returns its fixed invalid-proof/callback errors
or fixed route-not-found 404 and performs no D1/token mutation for hardened
values. Hardened handlers return `409 AUTH_FLOW_VERSION_MISMATCH`. Phase 4A
adds inert GET/POST confirmation compatibility stubs with the same 409 outcome
and a query-free recovery link; the stubs never parse OAuth material or access
D1. Phase 4A must be fully deployed and verified before a later generation can
create pending-confirmation rows, and Phase 4C may roll only over the fully
deployed Phase 4A/4B generation. Direct `455dcf1`-to-Phase-4C rollout is
unsupported.

Setup proof, confirmation proof, OAuth state digest, and all browser/issuer
digests use `OAUTH_STATE_HMAC_KEY`, the canonical unpadded base64url encoding
of exactly 32 key bytes, independent from the encryption and Pairing HMAC
keyrings. Every HMAC output is canonical unpadded base64url. Setup, OAuth, and
confirmation Cookie values are each exactly the canonical 43-character
encoding of 32 CSPRNG bytes; duplicate Cookie names are rejected. The
remaining exact UTF-8 HMAC inputs are:

```text
spotify-wallpaper:setup-browser-v2:<setup-cookie-value>
spotify-wallpaper:setup-issuer-v2:<canonical-issuer>
spotify-wallpaper:oauth-browser-v2:<oauth-cookie-value>
spotify-wallpaper:oauth-confirm-browser-v1:<confirmation-cookie-value>
```

`canonical-issuer` is the trusted Cloudflare client IP parsed strictly and
serialized as `v4:` plus eight lowercase hexadecimal digits or `v6:` plus 32
lowercase hexadecimal digits; IPv4-mapped IPv6 normalizes to `v4`. Missing or
invalid input fails before D1 access. These ten/five-minute records carry no
HMAC key ID and accept no previous key. Operational HMAC-key rotation
intentionally invalidates every in-flight authorization session; rows expire
or are purged and users restart without fallback to a previous protocol/key.

The initial opaque-origin callback fallback is user-mediated rather than an
automatic token exchange. If the original OAuth Cookie is missing, the
callback atomically consumes OAuth state into a five-minute pending
confirmation row containing only encrypted authorization code/verifier
material and a new browser-nonce digest. It sets the exact
`__Host-swp-confirm=<43-character-base64url-random>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300`
Cookie with no `Domain` and redirects with `303` to query-free
`GET /auth/confirm`. `Lax` is deliberate: the Cookie must be sent after the
cross-site Spotify callback's top-level safe-method redirect. Confirmation GET
does not mutate state, while POST still requires the Cookie, signed proof,
explicit action, and current legal acceptance.

That GET is rate-limited before D1 access. The keyed digest of exactly one
valid confirmation Cookie resolves through a unique index to exactly one
unexpired, unconsumed row. Zero/multiple rows, malformed Cookies, expiry, or
storage failure return a fixed no-store error without decrypting or consuming
the row. The page puts no authorization code, OAuth state, Client ID,
confirmation ID, or credential in its URL, JavaScript, or reflected error. It
emits only a signed `swpc1` proof and current legal-acceptance controls.

`POST /auth/confirm` requires that exact Cookie, a single-use signed proof, an
explicit user click, and current legal acceptance. After constant-time proof
signature verification, one conditional `DELETE ... RETURNING` may consume a
row only when the proof's exact `confirmationId` and `expiresAtMs`, the HMAC
digest of the presented confirmation Cookie, `protocol_version = 1`,
unconsumed status, and current unexpired status all match that same
`callback_confirmations` row. Only that returned row may be decrypted and
exchanged. Zero/multiple results or any cross-row mismatch cause no decrypt,
consumption, token exchange, or credential creation.

Proof/Cookie binding mismatch is recoverable: it preserves the syntactically
valid Cookie and every candidate row so the correct pairing can retry. Other
terminal results clear the Cookie. A compatibility-stub or transient
cross-version result likewise does not consume the row or Cookie, so the user
can return to query-free GET and retry within five minutes. Reauthorization
never uses this fallback. A server that fetches setup, starts OAuth, and hands
the URL to another browser cannot create a credential unless that browser
completes the visible confirmation.

The primary-D1 migration adds `setup_sessions` and
`callback_confirmations`, keyed-digest and expiry/issuer indexes, encrypted
confirmation fields with key IDs/AAD, and scheduled purge for expired or
consumed rows. It also adds
`oauth_sessions.protocol_version INTEGER NOT NULL DEFAULT 1 CHECK (protocol_version IN (1, 2))`;
old Workers
therefore keep inserting/reading v1 rows, while hardened starts explicitly
insert v2 and hardened callbacks consume only v2. Setup rows require protocol
v2 and confirmation rows protocol v1. The migration is applied and verified
in preview, then production, before the new Worker is deployed; the old Worker
ignores the additive tables/column. A missing/partial schema, failed rate-limit
binding, or failed session write returns a fixed unavailable response and
never falls back to the stateless proof or creates OAuth state. Purge is
bounded and starvation-tested.

Pending confirmation uses AES-256-GCM from the Worker encryption keyring
(never the Pairing HMAC keyring), an independent random 96-bit nonce and key
ID for each field, and exact UTF-8 AAD:

```text
spotify-wallpaper:oauth-confirm:v1:<confirmationId>:<spotifyClientId>:<fieldName>
```

`fieldName` is exactly `authorizationCode` or `pkceVerifier`.
`confirmationId` is the canonical random record identifier. Transition from
the OAuth row atomically consumes state, decrypts the old verifier only in
request memory, and re-encrypts both fields under their new AAD. Field/row
swaps, tampering, expiry, and decrypt failure fail closed. A non-consuming
read under a previous encryption key atomically rotates both fields to the
active key; confirmation consumption may decrypt a previous key and delete
the row in the same operation. Key-reference scans include pending rows, so
an old key cannot be removed while any confirmation field references it.

Safe extraction order:

1. Spotify HTTP boundary;
2. refresh coordinator while preserving D1 conditional updates;
3. OAuth session and callback state machine;
4. deletion ledger without merging it with primary credential storage;
5. presentation and route wiring.

Never change refresh coordination SQL and its state machine in the same
extraction step. Never combine the deletion ledger and primary D1 behind a
single failure domain.

The following remain invariant:

- BYO bounded Client ID with Authorization Code plus PKCE and no Spotify
  Client Secret;
- explicit current legal acceptance and the Cookie-bound ten-minute,
  purpose-bound, atomically consumed setup session for every setup
  authorization; it prevents browser CSRF/replay but does not claim human
  presence, and cannot authorize reauthorization or account management;
- cryptographically random state, browser nonce, and verifier; D1 stores
  state/browser digests and only an encrypted PKCE verifier;
- ten-minute, atomically single-use OAuth sessions and abandoned-session
  purge;
- initial-only opaque-origin callback fallback through the visible,
  Cookie-bound, single-use confirmation step before token exchange;
- exact matching Cookie for reauthorization; missing, duplicate, malformed,
  or mismatched Cookies fail without consuming the session;
- setup/auth/callback/confirmation rate limiting before state hashing or D1
  mutation, with fail-closed limiter errors;
- fixed Spotify redirect URI/scopes/endpoints plus bounded, abortable,
  redirect-denying upstream requests;
- exact `swpb1.<publicId>.<secret>` grammar with 128-bit public ID entropy,
  256-bit secret entropy, a 256-character maximum, and constant-time
  HMAC-SHA-256 verification after exact parse;
- the initial no-store authorization-completion response may show a newly
  issued Pairing Token once in one visible text node; it is never copied into
  JavaScript state, hidden
  inputs, DOM attributes, URLs, cookies, Web Storage, IndexedDB, or errors,
  and reauthorization never reflects the existing token into the DOM;
- AES-256-GCM token encryption with random 96-bit nonces, exact AAD, per-field
  key IDs, and lazy keyring rotation;
- separate encryption and Pairing HMAC keyrings with old-key removal only
  after reference scans;
- refresh single-flight and versioned leases;
- atomic Access/Refresh Token rotation, generation-safe `invalid_grant`
  clearing, one 401 refresh/retry, and Client-ID-scoped persisted 429 backoff;
- a separate 35-day deletion ledger, ledger-first tombstones, fail-closed
  ledger outage behavior, restore replay, per-row failure isolation,
  starvation resistance, and completed-only expiry;
- strict fixed CORS including the documented `Origin: null` exception for API
  routes only, same-origin account management, no credentialed cookie CORS,
  and exact HTTP-loopback or configured HTTPS release origin on the wallpaper;
- wallpaper backend requests use `redirect: 'error'`,
  `credentials: 'omit'`, and `referrerPolicy: 'no-referrer'`;
- no-store/security headers, fixed non-reflective errors, identifier-free
  aggregate metrics, and disabled request URL invocation logs; setup,
  callback, confirmation GET/POST, and compatibility-stub success/error
  responses all carry no-store, no-referrer, restrictive CSP, frame denial,
  and `nosniff`;
- environment separation and deployment fail-closed rules.

## Data Flows

### Startup and settings

```text
defaults / settings JSON / Wallpaper Engine properties
  -> settings-contract parser and migration
  -> WallpaperPreferences
  -> private credential vault -> opaque CredentialRef (separate source)
  -> settings diff
  -> affected runtime services only
  -> readonly RuntimeState
  -> Svelte components
```

Browser startup always begins deterministically in mock mode. Direct or
backend requests start only after an explicit valid credential overlay is
available. Cached direct credentials cannot race a later backend property
snapshot.

### Playback

```text
PlaybackProvider
  -> strict provider-v1 envelope validation
  -> NormalizedPlayback
  -> playback history reducer
  -> DisplaySnapshot / RuntimeState
  -> Svelte
```

Raw Spotify responses do not cross provider boundaries.

### Visual core

```text
validated numeric DTO
  -> visual-core adapter
  -> WASM ABI v1 or equivalent TypeScript fallback
  -> validated result
  -> runtime state
```

### Native and remote secrets

```text
credential input
  -> private runtime/native vault or encrypted backend storage
  -> one provider boundary
  -> redacted fixed-status output
  -> exceptional user-mediated one-time provisioning/export sink
```

Access Tokens, Refresh Tokens, Pairing Tokens, Client Secrets, encryption
keys, and HMAC keys never enter URLs. OAuth authorization codes and state may
appear only in the fixed Spotify authorization/callback protocol URLs; they
must not survive in logs, browser history created by this application,
referrers, errors, response bodies, debug models, phase reports, or stored
full callback URLs. No secret enters preferences, Rainmeter payloads, generic
exports, generated artifacts, or public runtime state.

The only secret-bearing outputs are the documented one-time local/backend
Pairing Token provisioning response and explicit legacy direct export. They
require the user-mediated, no-store, capability-bound sinks defined above and
are covered by dedicated replay and sink tests.

## Error Handling

- Parsing returns repaired preferences plus structured warnings.
- Explicit invalid provider configuration returns a visible fixed error.
- Provider operations use abortable deadlines.
- Stale async completions are rejected by generation/version.
- Poll failures retain the last safe current/previous display.
- `invalid_grant` enters a terminal reauthorization state.
- Spotify 401 retries once after invalidation.
- Retry delays are finite, bounded, and monotonic.
- Native and Worker errors are mapped to fixed application-owned messages.
- Optional integration failure never prevents browser mock startup.
- Cleanup is idempotent and every registered timer/listener/provider has one
  owner.

## Performance Design

- Apply settings by subsystem diff, not whole-runtime restart.
- Never duplicate credentials in serialized comparison keys.
- Clock scheduling matches visible granularity.
- Visualizer computes only the selected mode.
- Low-power mode reduces callback processing as well as rendered complexity.
- Album theme extraction runs once per generation and rejects stale results.
- Hot WASM visualizer input uses typed arrays.
- Provider polling and refresh are independent of render frequency.
- Worker, loopback backend, and direct providers use bounded single-flight
  refresh behavior appropriate to their environment.

Performance changes require before/after deterministic counters or timing
evidence; visual simplification alone is not treated as optimization.

## Artifact and Toolchain Contract

Release artifacts are generated only from a clean tracked source state. Node,
npm, Rust, Cargo, wasm-pack, and Wrangler versions are pinned in repository
toolchain/configuration files and verified by CI. Each generated artifact set
has a machine-readable manifest containing:

- full source commit and whether the tracked tree was dirty;
- lockfile hash and relevant Rust/TypeScript/source hashes;
- exact toolchain versions and build command;
- target environment (`preview`, `production`, or local release);
- artifact file hashes and generation timestamp.

Build verification rejects dirty release input, missing provenance, stale
source hashes, an artifact older than its sources, environment mismatch, or
an output that cannot be regenerated byte-for-byte except for explicitly
documented timestamp fields. Source maps, JavaScript glue, WASM, Worker
bundles, configuration, and manifest files all pass the workspace secret
scanner. Ignored local Worker/WASM output never becomes an implicit build
input.

## Testing and Review Strategy

### Test-first rule

Every behavioral correction or extraction starts with:

1. a green characterization test for behavior being preserved, or a red
   security/conformance test for behavior being corrected;
2. the smallest implementation or extraction that satisfies the test;
3. affected tests from CodeGraph plus the subsystem suite;
4. full phase verification;
5. independent code-quality review;
6. SpecGuard review.

### Required suites

- repository contract and required-document checks;
- settings round-trip, migration, preset, and secret-export tests;
- provider-v1 golden contract in TypeScript and Rust;
- wallpaper fake-timer, cleanup, mock-startup, transition, and theme-race tests;
- real-WASM/fallback ABI and parity tests;
- Tauri OAuth callback, URL, path, payload, and scheduler tests;
- loopback refresh, OAuth, storage, and provider contract tests;
- Worker OAuth, refresh, deletion race, and credential-sink tests;
- artifact provenance and secret scans;
- browser mock visual smoke;
- Wallpaper Engine manual checklist when the application is available.

### Quality gates

Resource-intensive commands run through `h5i capture run`.

At minimum:

```text
h5i capture run -- npm test
h5i capture run -- npm run check
h5i capture run -- npm run build:wasm
h5i capture run -- npm run build
h5i capture run -- npm run audit:dependencies
h5i capture run -- cargo fmt --all -- --check
h5i capture run -- cargo clippy --workspace --all-targets --all-features -- -D warnings
h5i capture run -- cargo test --workspace --all-features
h5i capture run -- cargo check -p spotify-wallpaper-visual-core --target wasm32-unknown-unknown
h5i capture run -- cargo fmt --manifest-path apps/backend/Cargo.toml -- --check
h5i capture run -- cargo clippy --manifest-path apps/backend/Cargo.toml --all-targets --all-features -- -D warnings
h5i capture run -- cargo test --manifest-path apps/backend/Cargo.toml --all-features
h5i capture run -- cargo fmt --manifest-path apps/configurator/src-tauri/Cargo.toml -- --check
h5i capture run -- cargo clippy --manifest-path apps/configurator/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
h5i capture run -- cargo test --manifest-path apps/configurator/src-tauri/Cargo.toml --all-features
git diff --check
```

Worker tests, generated types, dry-run build, and secret scans are mandatory
when Worker code or any shared provider/security contract changes. The real
WASM gate builds wasm-bindgen JavaScript glue from a clean source state,
imports it in the conformance suite, compares it with fallback fixtures, and
rejects missing or stale output. The dependency gate permits no unresolved
moderate, high, or critical advisory; any exceptional false-positive
classification requires recorded evidence and independent SpecGuard review.

## Refactoring Phase Sequence

These phases operate over an already implemented product and preserve the
foundation-first order in `docs/03-implementation-phases.md`. Every heading is
one independently reviewed implementation commit. A phase is split again
before implementation if its diff cannot expose one coherent invariant set.

### Phase 0 — Repository specification truth

- track all mandatory and domain specifications plus historical phase reports;
- remove blanket ignore rules for tracked project authority while preserving
  explicit ignores for local archives and generated output;
- align `docs/README.md`, `AGENTS.md`, and the real tree;
- add required-document and generated-source ownership checks;
- document the ignored/generated artifact policy.

### Phase 1 — Reproducible quality gates

- pin the supported Node/npm/Rust/wasm-pack/Wrangler toolchains;
- align CI triggers with `develop`, `master`, and pull requests;
- add copyable workspace, backend, Tauri, real-WASM, Worker, secret-scan, and
  CA-compatible dependency-audit scripts;
- fix existing Rust formatting so the declared gate is initially green.

### Phase 2 — Build dependency remediation

- update only the Vite-to-PostCSS build-time CSS chain that owns the known
  advisory;
- review the lockfile/runtime diff and rerun existing TypeScript/Svelte tests,
  checks, mock smoke, builds, and audit;
- defer the change if resolution reaches Wrangler, runtime HTTP/crypto, or a
  security-state owner.

### Phase 3 — Provider and credential-sink freeze

- establish provider-v1 transport/envelope/control and refresh-state fixtures;
- add workspace export, Rainmeter, runtime-state, error, debug, and artifact
  sink fixtures;
- characterize invalid explicit provider selection and deterministic mock
  startup without moving production boundaries.

### Phase 4A — Worker additive D1 compatibility

- add setup/confirmation tables, unique/expiry/issuer indexes, additive
  `oauth_sessions.protocol_version DEFAULT 1`, generated types, migration
  tests, and inert GET/POST confirmation compatibility stubs;
- make each stub return a fixed no-store
  `409 AUTH_FLOW_VERSION_MISMATCH` recovery page without parsing OAuth
  material or reading/writing D1;
- assert no-store, no-referrer, restrictive CSP, frame denial, and `nosniff`
  on both confirmation-stub methods;
- prove old Worker/new schema and new Worker/missing-or-partial-schema
  behavior, preview-before-production ordering, and fixed fail-closed errors;
- freeze compatibility vectors for the baseline and hardened protocol parsers:
  old setup rejects `swps2`, new setup rejects the old three-part proof, old
  callback rejects `swpo2` before D1/token access, and new callback rejects old
  raw state and Cookie formats; prove the frozen baseline's GET/POST confirm
  404 and the compatibility stub's GET/POST confirm 409 are both mutation-free;
- require verified full rollout of this compatibility generation before Phase
  4C can be deployed; do not route production requests through the new tables
  yet.

### Phase 4B — Worker setup session

- implement and test the Cookie-bound setup-session service behind an
  unrouted/disabled boundary;
- add pre-write limiter failure, atomic concurrent three-session cap,
  same-Cookie atomic retire/replace recovery, consumption, replay/CSRF, expiry,
  and starvation-resistant purge tests;
- test canonical setup Cookie/HMAC grammar, duplicate rejection, exact domains,
  and constant-time setup-proof verification;
- repeat new-setup to old-start rejection followed by fresh GET replacement
  more than three times and prove the user neither exceeds nor self-exhausts
  the outstanding-session cap;
- repeat the full new-setup → old-start → old-setup → new-start-version-mismatch
  → new-GET sequence more than three times and prove the valid hardened Cookie
  survives mismatch long enough to retire/replace its row;
- keep every production route on the reviewed baseline until confirmation is
  ready, so no partially hardened flow can be deployed.

### Phase 4C — Worker callback confirmation

- add the encrypted five-minute pending-confirmation state machine and
  user-mediated query-free confirmation GET/POST routes before token exchange;
- atomically switch setup/start/callback routing to the Phase 4B service and
  confirmation flow, then remove the stateless setup path;
- run mixed-isolate setup/start/callback/confirmation-GET/confirmation-POST
  requests in both old-to-new and new-to-old directions before enabling the
  hardened routes;
- specifically prove new callback to Phase 4A/4B confirmation stub to new GET
  retry leaves the pending row/Cookie unconsumed until the valid POST, and
  never performs premature D1 mutation, token exchange, downgrade, or
  credential creation;
- test server-fetched proof+Cookie followed by another browser's Cookie-less
  callback creates no credential before explicit confirmation;
- test confirmation GET's exact Cookie lookup, unique-row invariant, query-free
  URL, no-secret page/JavaScript/reflection policy, expiry, fixed error, and
  non-consuming retry;
- create concurrent rows A/B and reject both `proofA + CookieB` and
  `proofB + CookieA`; prove neither row is decrypted/consumed, no Spotify or
  credential call occurs, both valid Cookies are preserved in their
  respective requests, and each correct pairing can still complete;
- prove the single conditional consume binds proof ID/expiry, Cookie digest,
  protocol version, unconsumed state, and current expiry to one returned row;
- assert the complete no-store/no-referrer/CSP/frame-denial/nosniff header set
  on setup, callback, confirmation GET/POST success, and every fixed error;
- test exact AAD, independent nonce/key IDs, field/row swap, tamper, expiry,
  previous-key rotation/reference scan, atomic consumption, constant-time
  proof verification, exact HMAC/Cookie domains, OAuth protocol-version
  rejection, and fixed failure.

### Phase 4D — Worker security regression freeze

- add remaining Cookie/state, rotation, refresh/delete,
  reauthorization/delete, ledger-outage, and sink barriers;
- validate strengthened `docs/25-public-backend.md`, update full traceability
  and the Worker test manifest, and require zero unresolved Security/SpecGuard
  finding before later shared-contract work.

### Phase 5 — Tauri security freeze

- add adversarial IPC/result, callback, state, navigation, CSP/capability,
  redaction, and Windows path/write fixtures;
- make only the minimum security corrections required to turn those fixtures
  green;
- do not alter the Configurator settings schema or move native modules.

### Phase 6 — Loopback security freeze

- characterize bind, OAuth, provider, refresh, encrypted storage, migration,
  corruption, and rollback;
- freeze exact `swpl1`, provisioning headers/sinks, credential epoch, WAL, and
  managed-backup reset behavior;
- make only required security corrections and do not split modules.

### Phase 7 — Visual behavior freeze

- import actual generated WASM in tests and record the current ABI;
- characterize TypeScript/CSS and old Rust layout differences;
- establish visualizer/readability fallback fixtures and tolerances before
  removal or optimization.

### Phase 8 — Legacy credential containment

- run `containLegacyBrowserSecrets` before parsing/provider startup;
- stop automatic plaintext cache reading and persistence;
- test write/remove/storage failures, whole-document fallback, fixed warning,
  retry, and fail-closed network disablement;
- replace secret-bearing comparison strings with runtime-owned revisions;
- keep sanitized v1 preferences through a compatibility overlay;
- require a complete explicit provider/credential snapshot before networking.

### Phase 9 — Settings contract version 2

- create the dependency-independent `settings-contract` package;
- implement pure v1-to-v2 migration, defaults, repair, presets, secret-free
  serialization, diffs, and all surface fixtures;
- add compatibility re-exports without migrating either application.

### Phase 10 — Wallpaper settings cutover

- migrate only Wallpaper settings loading, repair, presets, property merge,
  and diff consumers to the shared contract;
- correct `albumArt`, `text`, Rainmeter, polling, and round-trip omissions;
- remove superseded Wallpaper settings implementations after consumer tests.

### Phase 11 — Wallpaper provider hardening

- split provider factory, mock, direct, backend, scheduler, and history;
- add deadlines, direct single-flight, one 401 retry, terminal reauthorization,
  strict deep validation, revision checks, and disposal;
- preserve exact trusted-origin/redirect/credentials/referrer rules.

### Phase 12 — Wallpaper runtime lifecycle

- extract provider scheduling, clock/audio/theme/transition services, readonly
  state, and disposers into the framework-independent runtime;
- apply settings by subsystem diff and reject stale asynchronous work;
- add fake-timer, teardown, rapid-track-change, and theme-race tests.

### Phase 13 — Wallpaper presentation boundaries

- split presentational components and leave `App.svelte` as composition;
- make display mode explicit without overriding saved layout;
- preserve complete transition snapshots and deterministic mock content.

### Phase 14 — Visual-core ABI and release build

- freeze chosen TS/CSS layout semantics and remove only the Rust layout ABI;
- version real WASM, align fallbacks, and add parity/import/stale tests;
- add the transient typed-array path and reproducible WASM generation.

### Phase 15 — Tauri OAuth and IPC boundary

- first rerun every Phase 5 adversarial test and require zero drift;
- make CSP, capabilities, navigation, DTOs, result projection, vault, and
  redaction authoritative;
- split OAuth session, loopback parser, Spotify exchange, vault, and commands;
- harden callback, URL, bounds, redirect, timeout, and composition root.

### Phase 16 — Configurator settings cutover

- migrate only secret-free preferences, presets, repair, import, and generic
  export to settings contract version 2;
- keep raw credentials in the native vault and return presence only;
- rerun Phase 5 IPC/sink suites and shared settings fixtures.

### Phase 17 — Legacy direct export sink

- add the short-lived process/window/vault-revision-bound one-shot capability;
- require native save-dialog destination or native clipboard confirmation;
- reject replay, replacement, another window, and background invocation;
- never return the raw secret through ordinary WebView state or IPC.

### Phase 18 — Tauri Rainmeter boundary

- replace blacklist validation with the allowlisted DTO;
- split opaque path capability, path policy, atomic writer, and scheduler;
- harden Windows reparse/replace/cancellation/failure behavior;
- prove optional Rainmeter failure cannot affect the wallpaper.

### Phase 19 — Native settings-schema retirement

- rerun settings and native DTO conformance after both application cutovers;
- move remaining useful Rust config vectors into shared fixtures;
- remove only the disconnected whole-settings crate and references.

### Phase 20 — Loopback storage boundary

- implement versioned transactional SQLite migration, AES-GCM AAD, external
  credential epoch, reset, WAL, and managed-backup contracts;
- keep open-time migration metadata-only, then run the exact-schema,
  old-token-authenticated, journaled bootstrap/re-encryption flow;
- fail closed on missing/corrupt/future/rolled-back reset ledgers and require
  destructive credential quarantine plus reauthorization for recovery;
- split storage/crypto without changing OAuth or refresh orchestration;
- satisfy Phase 6 storage and failure-injection barriers.

### Phase 21 — Loopback OAuth/session boundary

- enforce loopback bind, exact callback grammar, bounded single-use sessions,
  provisioning response, and non-reflective errors;
- split OAuth session and callback logic without moving refresh coordination.

### Phase 22 — Loopback route and Spotify HTTP boundary

- extract HTTP envelope/grammar and bounded Spotify client calls;
- conform normalized playback and controls to provider-v1 fixtures;
- keep token refresh state transitions unchanged.

### Phase 23 — Loopback refresh coordinator

- implement atomic rotation, single-flight, terminal `invalid_grant`, one 401
  retry, persistent bounded 429, timeout, and stale-generation rejection;
- split the coordinator from routes and storage.

### Phase 24 — Worker contract resynchronization

- adapt only to finalized shared provider/security fixtures;
- rerun Phase 4A-4D barriers and update traceability for all intervening
  changes;
- require zero drift before Worker extraction.

### Phase 25 — Worker Spotify HTTP boundary

- extract only bounded Spotify HTTP, parsing, and fixed error mapping;
- preserve endpoints, redirects, timeouts, scopes, and response limits.

### Phase 26 — Worker refresh coordinator

- extract state transitions while leaving D1 conditional SQL unchanged;
- preserve lease/version/expiry, rotation, `invalid_grant`, 401, and 429.

### Phase 27 — Worker OAuth boundary

- extract setup sessions, OAuth classification, and callback orchestration;
- preserve BYO PKCE, legal acceptance, Cookie/state consumption, opaque-origin
  fallback, and rate-limit ordering.

### Phase 28 — Worker deletion ledger

- extract tombstone/reconciliation without combining D1 failure domains;
- preserve fail-closed ledger-first deletion, restore replay, fairness,
  completed-only expiry, and in-flight races.

### Phase 29 — Worker route and presentation wiring

- reduce roots to routes and secret-free presentation;
- preserve CORS, headers, errors, logs, legal pages, environments, and
  fail-closed deployment checks.

### Phase 30 — Measured system optimization

- measure restarts/timers, visualizer work, artifact size, and backend request
  and concurrency counters;
- optimize only evidence-backed changes, separate visual changes from
  lifecycle changes, and rerun equivalence/security suites.

### Phase 31 — Final source and integration freeze

- integrate the latest `develop` into the Fix branch before final review;
- remove obsolete adapters/dead code and make final CI consistency changes;
- update affected docs/report, run all gates, review, and commit;
- record that exact clean commit as `artifactSourceCommit`.

If `develop` advances after this phase, Phase 31 and every later phase repeat.

### Phase 32 — Artifact generation and evidence

- require clean HEAD exactly equal to `artifactSourceCommit`;
- generate ignored release artifacts and preliminary manifests without using
  untracked output as source;
- verify hashes, reproducibility, source maps, stale rejection, and secrets;
- commit the reviewed evidence/docs as `evidenceCommit`;
- regenerate only external manifest metadata so it records distinct
  `artifactSourceCommit` and `evidenceCommit`;
- rerun the full phase gate and independent quality, Security, and SpecGuard
  review against the exact evidence commit plus final external manifest.

Any post-commit finding creates an explicit corrective subphase/commit and
repeats artifact generation and the post-commit gate; Phase 32 cannot exit on
the earlier pre-commit review alone.

### Phase 33 — Final branch integration

- require `develop` still at the merge base integrated in Phase 31;
- fast-forward `develop` to the reviewed evidence commit; otherwise return to
  Phase 31;
- rerun the full gate on the integrated branch and commit the final integration
  report with the integrated/evidence/artifact-source SHAs;
- rerun the full gate and independent quality, Security, and SpecGuard review
  on the resulting final `develop` SHA.

Any final-report or review fix is a new corrective subphase/commit and repeats
the post-integration full gate; only the exact final authority SHA may be used
as completion evidence.

The Worker phases are deliberately separate. Refresh coordination SQL, OAuth
state consumption, primary credential deletion, and the deletion ledger are
never redesigned in the same phase or commit.

## Commit and Review Policy

- One scoped implementation commit per completed phase, using existing
  imperative commit-message style.
- If a phase exposes more than one security state machine or cannot be
  reviewed atomically, split it before implementation rather than expanding
  its commit.
- After this design receives SpecGuard PASS and before Phase 0, create a
  documentation bootstrap commit that force-adds this design and
  `docs/how-to-use-h5i.md` and includes the reviewed setup-proof correction in
  `docs/25-public-backend.md`; implementation plans may use subsequent
  documentation commits. The exact staged bootstrap diff requires independent
  Security and SpecGuard PASS before commit.
- Use the current `h5i capture commit` command for provenance; this satisfies
  the `AGENTS.md` "`h5i commit`" workflow while avoiding its deprecated alias.
- Do not stage `.codex/reports`.
- Every phase updates its affected specifications and tracked phase report in
  the same review diff; documentation is an exit artifact, not deferred to
  the final phase. Each report contains Summary, Changed files, Relevant docs
  read, Implemented requirements, Known gaps, Tests run, Risks introduced,
  Review outcome, Fixes from review, Verification commands, and Next
  recommended task.
- Each phase includes independent quality review and SpecGuard approval before
  the phase commit.
- Every review prompt includes the objective, normative specifications,
  complete target diff, and exact test evidence and does not suggest a desired
  verdict. Findings are recorded as `valid`, `invalid`, `duplicate`, or
  `deferred` with evidence. Every valid finding is fixed and the reviewer is
  redispatched; every fix reruns affected tests and the full phase gate before
  redispatch. Security-sensitive phases also require an independent Security
  reviewer, and every valid Security finding is redispatched to a Security
  reviewer after verification. Zero unresolved valid findings is the phase
  exit condition.
- Keep the implementation branch until all phases and the final completion
  audit pass.
- Preserve all pre-existing commits; do not rebase or squash the approved
  baseline.
- `Fix/system-wide-refactor` is temporary implementation authority,
  `develop` is final integration authority, and `master` remains release
  authority.
- Integrate the latest `develop` before the final source freeze, then require
  fast-forward-only final integration. Any later `develop` movement restarts
  the source freeze, full gates, review, and artifact evidence.
- Do not push or deploy unless publication is explicitly in scope.

## Completion Criteria

The refactor is complete only when:

- every required document exists in the tracked tree;
- a clean source checkout can discover and run all documented gates;
- settings schema version 2 migrates every v1 surface idempotently, rejects
  future versions safely, and leaves no browser-stored credential;
- settings and credentials each have one explicit authority;
- all providers pass the same versioned contract;
- browser mock startup is deterministic and credential-free;
- no optional integration is required by the wallpaper;
- runtime composition roots contain only wiring and rendering;
- WASM and fallback semantics are proven equivalent;
- Tauri and both backends meet their security invariants;
- Worker race and deletion guarantees remain covered;
- no unresolved moderate, high, or critical dependency advisory remains;
- formatting, lint, tests, builds, secret scans, and diff checks pass;
- SpecGuard has no unresolved valid finding;
- latest `develop` is included and the integrated branch SHA passes the full
  gate after fast-forward integration;
- phase reports describe changed files, docs, tests, risks, and next actions;
- the final audit maps every objective and hard rule to current evidence.

## Publication Boundary

Refactor completion does not authorize a Spotify-connected deployment,
Limited beta, or Workshop publication. Worker completion retains the staging
integration, secret-surface inspection, independent Security and SpecGuard
review, and 72-hour Wallpaper Engine soak required by
`docs/25-public-backend.md`.

Phase 33 establishes refactor integration readiness only. It may complete
without a network deployment or soak and therefore does not claim the public
Worker is release/implementation-complete under `docs/25`. That separate
status is reached only after staging integration and the 72-hour soak produce
recorded evidence.

A Spotify-connected Limited beta still requires a dated policy decision or a
policy-compatible build plus the documented operator/privacy/incident
contacts, legal consent flow, real preview infrastructure, smoke tests, alert
delivery tests, and independent approvals. General Workshop publication
still requires the completed Limited beta, soak, and evidence-owned
publication checklist. None of those gates is inferred from passing this
refactor.
