# QA Checklist

Use this checklist before release or when changing settings, Spotify, Wallpaper Engine adapters, visual display, or optional integrations.

## Automated Gates

- `npm test`
- `npm run test:wallpaper-link`
- `npm run check`
- `npm run build`
- `npm run test:wasm-parity`
- `cargo check --manifest-path crates/visual-core/Cargo.toml`
- `cargo test --manifest-path crates/visual-core/Cargo.toml`
- `npm audit --audit-level=moderate`
- `git diff --check`
- `npx playwright test tests/playwright/wallpaper-characterization.spec.ts --grep "visualizer positioning|glowing object canvas|display mode animations"`

Resource-intensive commands should run through `h5i capture run`.

Retained optional components are checked separately with `npm run
check:optional`, `npm run test:optional`, `npm run build:optional`, and Cargo
check/test for `apps/backend/Cargo.toml` and
`apps/configurator/src-tauri/Cargo.toml`. Their checks are not removed or
represented as completed by passing the standard product build.

## Static Pages And Direct Credential Migration

- Build auth without Client ID or token configuration; verify editable Client ID.
- Serve the prepared Pages artifact under `/SpotifyWallPaper/` and verify
  `/spotify-auth/callback/` returns 200 with correct assets and query handling.
- Run mocked browser E2E for PKCE and immediate callback query removal.
- Verify invalid/missing/expired/future state, replay, denial, timeout, and
  starting a new session while an older request is pending.
- Verify same initial host input preserves rotated tokens after recreation,
  reload, and restart; malformed input leaves the current authorization intact.
- Verify storage read/write/corruption failures, missing replacement token,
  account switch, disconnect, and stale-input retirement after invalid_grant.
- Verify concurrent contexts, lease expiry, stale revisions, disposal during
  refresh, late 401/invalid_grant, and no automatic replay of next/previous
  after network failure or 5xx.
- Verify 403, 429, QUOTA_EXCEEDED, offline, timeout, and authorization failure
  remain distinct; scan settings exports, logs, and both distribution artifacts.
- Record fake-clock 1/24/72-hour results separately from real 72-hour operation.
- Real Wallpaper Engine CORS/Origin, storage persistence/sharing across screens
  and processes, restart, sleep/resume, and actual-account behavior remain
  unverified until measured on this version. Browser results do not substitute.
- Verify PR cannot deploy; develop deployment requires explicit
  `PAGES_DEPLOY_ENABLED=true`. Publication itself is a user action outside this task.

## Browser Mock

- Open `http://127.0.0.1:5173/`.
- Confirm mock album art or placeholder is visible.
- Confirm title, artists, progress, seekbar, and clock are visible.
- Confirm visualizer renders from mock or idle audio data.
- Confirm the full-screen glowing-object Canvas starts near the center, moves
  outward, and remains visible when the SVG visualizer is disabled.
- Confirm album-only and album-details both scale album content above the audio
  threshold while the straight seekbar stays fixed.
- Confirm malformed settings JSON falls back safely.
- Confirm no Wallpaper Engine object is required.

## Wallpaper Engine

- Build and link with `npm run wallpaper:dev-build`.
- Confirm the first run creates `projects/myprojects/spotify-wallpaper-dev` as
  a junction to `apps/wallpaper/dist`.
- Confirm a second run succeeds without replacing the junction.
- Rebuild and reload the existing Wallpaper Engine project without importing
  another copy.
- Confirm an existing file, directory, symlink, or different junction is not
  deleted or replaced.
- Confirm `project.json` is present in `apps/wallpaper/dist`.
- Confirm normal builds contain no `workshopid`.
- Confirm Workshop metadata `null` omits `workshopid`, a positive decimal
  string is injected only by the Workshop build, and invalid values fail.
- Confirm Workshop preparation never copies credential or unknown metadata
  fields into `dist/project.json`.
- Confirm `project.json` uses only Wallpaper Engine supported user property types: `color`, `slider`, `bool`, `combo`, `textinput`, `file`, or `directory`.
- Confirm user properties apply:
  - `spotify_client_id`
  - `spotify_refresh_token` (`swpt2.` and compatible `swpt1.` direct data)
  - `settings_json`
  - `selected_preset`
  - `visualizer_enabled`
  - `glowing_objects_enabled`
  - `visualizer_position`
  - `performance_mode`
  - `debug_enabled`
- Confirm `settings_json` is editable as single-line JSON with valid JSON, an empty value, and malformed JSON; malformed JSON must not crash the wallpaper.
- Confirm credential input is never logged or exported into settings; only the dedicated direct IndexedDB store may persist current direct tokens outside the host property.
- In direct mode, confirm `spotify_refresh_token` accepts dummy `swpt2.` and compatible `swpt1.` data without requiring `spotify_client_id`; raw Refresh Tokens are never entered into `settings_json`.
- Confirm `spotify_playback_provider=backend` uses only the release-configured public origin in a Workshop build.
- Confirm an explicit invalid or untrusted `spotify_backend_url` does not fall back to direct mode and never receives a Pairing Token.
- Confirm `spotify_pairing_token` accepts a dummy `swpb1.` value without exposing it in debug, warnings, or errors.
- Treat `play-in-window` or CLI `applyProperties` checks as diagnostics only; RC-2 pass/fail requires Wallpaper Engine UI editing and applying the wallpaper to an actual display.
- Confirm browser fallback still works after Wallpaper Engine changes.
- Current update-flow status: automated junction tests use isolated temporary
  folders. Record the real registry detection, first link, idempotent second
  link, and rebuild/reload results below before acceptance.
- 2026-08-25 local result: registry detection, first Junction creation,
  second-run idempotency, target path, `index.html`, and `project.json` passed.
  UI reload confirmation stopped because an older manual import exposed an
  existing credential-bearing property; revoke and reissue that credential,
  then repeat the reload check without capturing property text.
- Required real-machine result fields:
  - property application result for every property above
  - `settings_json` malformed JSON fallback result
  - audio listener source result: `wallpaper-engine`, `mock`, or `idle`
  - fallback result when audio listener is unavailable

## Spotify

- Confirm current playback displays when credentials are valid.
- Confirm real Wallpaper Engine audio reacts only after the current provider
  has successfully returned a playing track or episode.
- Confirm a transient poll failure retains the last valid playing eligibility,
  a successful paused/stopped/item-null result disables it, and a provider
  change waits for the new provider's first success.
- Confirm no-active-device, unauthorized, and forbidden results also disable
  real audio while network/rate-limit failures retain the last state.
- Confirm an optimistic Play command does not enable real audio before the next
  successful playing poll.
- Confirm volume 1, 25, 50, and 100 produce matching visuals for equivalently
  attenuated input; zero and unavailable volume remain unboosted.
- Confirm virtual gain changes neither Spotify volume nor PC volume and sends
  no volume command. Note that other applications in Wallpaper Engine's
  PC-wide audio mix receive the same visual gain while Spotify is eligible.
- Confirm paused playback slows polling and does not crash.
- Confirm stopped or item-null playback does not crash.
- Confirm 401, 403, 429, network failure, and unknown responses show safe status.
- Confirm Refresh Token, Access Token, authorization code, and full callback URL do not appear in logs or screenshots.
- Post-v0.0.1 Codex status: not executed in this environment because no real account credentials or Spotify Premium/restricted-device matrix are available. Must be completed locally with token values redacted from notes.
- Premium checks when available: play, pause, next, previous, seek, volume, shuffle, and repeat.
- Non-Premium or restricted-device checks: controls remain disabled or show non-fatal status text without breaking passive display.

## Public Backend Beta

- Confirm the only production origin is
  `https://ciel-spotify-wallpaper.duckdns.org` and no fallback hostname is
  selected.
- Confirm production starts only as `SPOTIFY_MODE=policy_locked`, an unknown
  mode fails startup, and `synthetic_test` has no external listener.
- For every exact allowed Spotify route/method, confirm policy lock returns the
  fixed no-store 503 before Node reads body, Cookie, Authorization, database,
  rate limiter, randomness, clock-dependent state, or outbound access.
- Confirm the public AF_UNIX socket accepts only `GET /health`,
  `GET /privacy`, `GET /terms`, `GET /auth/callback`,
  `GET /api/playback`, `POST /api/control`, `DELETE /api/account`, and
  `OPTIONS /api/playback|/api/control`.
- Confirm the admin AF_UNIX socket accepts only `GET /setup`,
  `POST /auth/start`, `GET|POST /auth/confirm`, and
  `POST /auth/reauthorize`.
- Confirm wrong socket/path/method and every trailing-slash variant are
  rejected.
- Confirm `/health` performs no database/outbound check. Verify PostgreSQL,
  migrations, backup freshness, disk, and reconciliation only through local
  maintenance commands and systemd timer state.
- Confirm production Caddy forwards only the exact public route table, the
  exact admin table through OAuth2 Proxy, and the five reviewed `GET /oauth2/`
  endpoint families; every other method/path is 404.
- Confirm the admin allowlist passes through OAuth2 Proxy to the admin socket,
  the configured GitHub allowlist is exact, and no authentication bypass route
  exists. Exercise the setup body only in an externally unreachable synthetic
  test because production Node remains policy locked.
- Confirm playback/control preflight permits only `Origin: null` and
  `http://127.0.0.1:5173`, the route method, `authorization` plus optional
  `content-type`, and no cookie credentials. Reject duplicate/unknown headers,
  missing authorization, unknown origins, and invalid methods without DB,
  auth, or limiter changes.
- Confirm account deletion rejects missing Origin and `Origin: null` and
  requires the exact public HTTPS origin plus a valid Pairing Token.
- Confirm Caddy/OAuth2 Proxy request/auth/access logging is disabled and Node
  emits fixed event names/counts without URL, query, callback, header,
  Client ID, IP, exception text, or secret.
- Confirm Caddy overwrites `X-SWP-Client-IP`, OAuth2 Proxy does not append,
  Node rejects missing/duplicate/malformed/spoofed values, IPv4-mapped IPv6
  normalizes to IPv4, and only an HMAC digest reaches limiter/database state.
- Confirm Node production opens no TCP listener and each socket has the
  expected owner, group, and mode.
- Confirm `spotify_wallpaper` and
  `spotify_wallpaper_deletion_ledger` are independently migrated, dumped,
  validated by isolated restore, retained, and restorable.
- Confirm each dump keeps a unique temporary name through checksum, listing,
  isolated restore, and schema/count checks; only full success atomically
  promotes it, and any failure deletes the exact temporary file without a
  retained-backup name.
- Confirm primary restore keeps traffic closed until all retained ledger
  tombstones are replayed and pending count is zero.
- Confirm ledger-only, combined-database, cluster, and backup-only loss restore
  no OAuth, credential, setup, confirmation, or backoff state and require all
  users to authorize again.
- In externally unreachable `synthetic_test` only, confirm `/setup` links
  `/privacy` and `/terms`, explicit consent is required, and only
  `__Host-swp-setup`, `__Host-swp-oauth-v2`, and
  `__Host-swp-confirm` cookies can be issued with the specified attributes.
- Confirm `swps2`, `swpo2`, and `swpc1` exact grammar, expiry, purpose, and
  constant-time signature verification; duplicate cookies and legacy formats
  fail closed.
- Confirm initial callback with its OAuth cookie consumes once, initial
  cookie-loss creates only encrypted pending confirmation, confirmation GET is
  non-mutating/query-free, POST binds proof and cookie to one row, cross-row
  swaps do not consume, and reauthorization never uses the fallback.
- Confirm all eight control JSON shapes, exact field sets, numeric ranges, and
  repeat enum; unknown/extra/non-integer/out-of-range input makes no Spotify
  request.
- Confirm the allowlisted source artifact excludes sources/maps/node_modules,
  `npm ci --omit=dev --ignore-scripts` runs only in an empty staging release,
  and the final read-only runtime tree including dependencies matches its
  post-install SHA-256 manifest before `current` is switched.
- In synthetic tests, confirm Pairing Token one-time display, HMAC-only
  storage, single-flight refresh, fixed Spotify error mapping,
  reauthorization, and ledger-first account deletion.
- Confirm live Access/Refresh ciphertext rejects record/Client-ID/field swaps;
  rotated Refresh Token updates atomically and an omitted token preserves the
  existing ciphertext.
- Confirm all OAuth HTML success/error pages use no-store, no-referrer,
  nosniff, frame denial, exact restrictive CSP, and nonce-only inline sources.
- Confirm the Pairing Token appears in no URL, Cookie, Web Storage, IndexedDB,
  log, metric, screenshot, dump plaintext, or persisted secret column.
- Confirm mock, legacy direct, loopback Rust, and policy-locked backend modes
  remain usable independently.

## Visual And Settings Regression

- Confirm all layout presets render without overlap at desktop and narrow widths.
- Confirm long title and many-artist fixtures do not break text layout.
- Confirm very bright and very dark theme cases keep text readable.
- Confirm low-power mode reduces visualizer work and blur.
- Confirm paused, stopped, missing-item, source-mismatched, and initial-fetch
  states show a zero visualizer frame without album or glowing-object input;
  motion returns to neutral in about 450ms.
- Confirm browser mock audio remains reactive with no volume boost.
- Confirm automatic glowing-object density is 24/48/96 for low-power/standard/high-effect,
  and that high-effect glow is stronger than standard while low-power disables
  particle shadow blur.
- Confirm the Canvas uses the lower logical backing resolution in low-power on
  a HiDPI display, and that disabling the property after particles appear
  clears particles and stops the animation loop.
- Confirm `around-album` centers circular visualizer geometry on the album art.
- Confirm `bottom-up` is anchored to the lower edge and radial bars grow upward.
- Confirm `album-only`/`album-details` changes enable track-panel `text-enter`
  and album-frame transitions.
- Confirm reduced motion stops those display-mode animations and transitions.
- Confirm track transitions retain previous/current display state during animation.
- Confirm reduce-motion resolves aggressive transition presets to safe motion.

## Optional Configurator

- Open `http://127.0.0.1:1420/`.
- Confirm generated settings JSON is `schemaVersion: 3` and excludes all credential fields and values.
- Confirm v1, v2, and unversioned settings migrate intensity once from the old 0–2 range to 0–6, while v3 settings are not multiplied again.
- Confirm legacy `seekbar.style: "album-ring"` is repaired to the straight `line` seekbar and no progress-ring element is rendered.
- Confirm the single native auth command starts PKCE without a Client Secret and returns only status/fixed error codes to the WebView.
- Confirm verifier, state, callback URL, authorization code, and Refresh Token never enter the WebView draft, logs, settings JSON, or export.
- Confirm native confirmation copies an approved `swpt1.` bundle to the clipboard once and does not expose it in app state.
- Confirm imported malformed JSON leaves defaults active.
- Confirm the Tauri shell can validate settings JSON.
- Confirm the wallpaper still runs without the configurator.

## Rainmeter

- Confirm Rainmeter output can be enabled/disabled in the configurator.
- Confirm Tauri write succeeds for display-safe JSON and a writable path.
- Confirm Tauri scheduler writes about once per second while playback is marked playing.
- Confirm Tauri scheduler uses `stoppedUpdateIntervalMs` while playback is marked stopped.
- Confirm Tauri write rejects token, client secret, authorization code, and callback URL field names.
- Confirm Rainmeter write failure does not affect the wallpaper.
- Confirm the sample skin or documented measure can read the generated JSON.

## Release Notes

- Update release notes with implemented features, known gaps, and verification commands.
- Update the phase report with docs read, tests run, risks, and next task.

## Spotify Distribution Gates

An initial owner-only Private Workshop item may be used only for
credential-free mock verification. Real Spotify authorization, third-party
access, Limited beta, and general publication remain prohibited until the
applicable gates below are complete and the action is separately approved.

Confirm the legacy auth workflow has no Pages write/deploy capability and any
historical Pages deployment is disabled.

Do not begin a Spotify-connected Limited beta until policy or a
policy-compatible build, operator-reviewed Privacy/EULA, infrastructure,
smoke, alert-delivery, Security, and SpecGuard evidence are recorded.

Do not publish generally until the phase report also contains evidence for
every item:

- Spotify approval or a documented policy-compatible redesign covering BYO
  authorization, sound-recording/visual synchronization, product naming, and
  Spotify Mark usage.
- Original, unmodified Spotify artwork with no crop, blur, animation,
  distortion, or overlay, plus required Spotify logo attribution and link.
- Published privacy notice with real operator and private incident contacts.
- Published operator-reviewed EULA and pre-authorization consent.
- Fixed production origin and verified policy-lock behavior.
- Separately reviewed systemd/network and application-mode change before any
  future Spotify callback registration or unlock.
- Verified non-budget operational alert configuration and delivery.
- Completed Spotify-connected limited beta.
- Completed 72-hour Wallpaper Engine soak.
- Verified cost, abuse, deletion-reconciliation, and incident alerts.
