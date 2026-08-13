# Test and QA

## Regression gates

Every code-changing phase starts from characterization or a red contract test
and ends with targeted verification, Sol/medium review, SpecGuard (and
Security where applicable), then same-diff Ponytail audit. Browser mock startup must
remain credential-free without Spotify, Tauri, Worker, or WASM. Fixed-time
visual fixtures cover 1920×1080 and 3440×1440 for both display modes;
the accepted maximum visual diff ratio is 0.002.

## Unit tests

Rust/WASM core (current boundary):

- visualizer normalization and typed-array safety
- readability calculation
- NaN, empty input, and actual-WASM/fallback parity

Historical settings/layout/animation characterization remains evidence in the
Phase 1 fixtures. The retired Rust layout ABI and disconnected whole-settings
crate are no longer runtime authorities; settings validation, migration, and
repair are owned by the shared TypeScript contract plus narrow native DTOs.

TypeScript:

- Shared Spotify response normalization (track, episode, none, invalid shape,
  numeric bounds, and collection caps)
- Direct-provider warning wrapper and Worker provider-v1 fixture parity
- error classification
- settings load fallback
- mock mode initialization
- Worker OAuth state expiry and replay
- Pairing Token parsing and HMAC verification
- D1 application-layer encryption
- concurrent single-flight token refresh
- public-backend CORS, rate limits, reauthorization, and deletion

## Mock data

Provide fixtures for:

- normal playing track
- paused track
- item null
- episode
- missing album image
- null progress
- 401
- 403
- 429
- network error
- very long track title
- many artists
- very bright album art
- very dark album art

## Manual QA

Confirm:

- Browser mock opens.
- Wallpaper Engine settings apply.
- Spotify playback displays.
- Stopped state works.
- Track change transition runs.
- Layout coordinates move parts.
- Visualizer intensity changes output.
- Low-power mode reduces work.
- Rainmeter output contains no secrets.
- Token never appears in logs.
- Pairing Token never appears in logs, URLs, debug output, or stored Worker pages.
- D1 export does not contain plaintext Spotify or Pairing tokens.
- Direct, loopback Rust, public Worker, and browser mock paths all work.
- Shared TypeScript normalization remains the authority for direct and Worker
  paths; Rust parity is checked at the provider-v1 fixture boundary.
- `invalid_grant` stops refresh retries and permits reauthorization.
- Arbitrary HTTPS origins and redirects receive no Bearer token.
- Wallpaper Engine survives a 72-hour public-backend soak.

## Regression policy

Any change touching settings, Spotify, or Wallpaper Engine adapter must verify mock mode and broken-settings fallback.
