# Test and QA

## Unit tests

Rust/WASM core:

- settings validation
- settings migration
- layout anchors
- visualizer normalization
- readability calculation
- animation helpers

TypeScript:

- Spotify response normalization
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
- `invalid_grant` stops refresh retries and permits reauthorization.
- Arbitrary HTTPS origins and redirects receive no Bearer token.
- Wallpaper Engine survives a 72-hour public-backend soak.

## Regression policy

Any change touching settings, Spotify, or Wallpaper Engine adapter must verify mock mode and broken-settings fallback.
