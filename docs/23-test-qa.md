# Test and QA

## Regression gates

Every code-changing phase starts from characterization or a red contract test
and ends with targeted verification, Sol/medium review, SpecGuard (and
Security where applicable), then same-diff Ponytail audit. Browser mock startup must
remain credential-free without Spotify, Tauri, public backend, or WASM. Fixed-time
visual fixtures cover 1920×1080 and 3440×1440 for both display modes;
the accepted maximum visual diff ratio is 0.002.

Playwright visualizer contract coverage exercises the Cartesian product of the
three performance profiles, three MVP modes, and two positions. It verifies that
`around-album` keeps the album-art and visualizer centers aligned with circular
geometry, while `bottom-up` is anchored to the viewport bottom and grows radial
bars upward. Display-mode coverage checks the track-panel `text-enter` animation
and album-frame transition, and reduced motion verifies that both are stopped.
Glowing-object coverage verifies the shared motion state with the SVG visualizer
disabled, continuous album scale and capped offset, synchronized speed and
brightness, the straight seekbar, automatic particle density for all three
performance profiles, and immediate Canvas loop shutdown. Circular waveform
coverage verifies closed album and bottom paths and the visualizer-only color
transition contract. Fixed-time visual fixtures still cover 1920×1080 and
3440×1440 for both display modes; the fixed-time default screenshots disable
the continuously animated particle layer and are updated when an intentional
visual change such as the video-style visualizer changes the rendered
appearance.

## Unit tests

Direct connection migration adds regression requirements without changing the
visual/audio algorithms or removing the existing checks below:

- PKCE transaction binding, missing/mismatched/expired/future state, replay,
  denial, timeout, and replacement-session safety.
- Credential-free auth build, exact trailing-slash callback, subpath assets,
  actual callback HTTP 200, and mocked browser authorization/token E2E.
- `swpt1.` compatibility and `swpt2.` parsing; repeated host input preserves
  rotated tokens across provider recreation and reload.
- Atomic import, read/write/corruption/quota failures, disconnect and
  invalid_grant retirement, account changes, and late-response protection.
- Same-store concurrent contexts, lease expiry and revision fencing, refresh
  during disposal, stale 401/invalid_grant, and no duplicate control replay.
- Distinct 403, 429/QUOTA_EXCEEDED, network, timeout, 5xx, invalid payload, and
  no-playback handling; credential-free settings export and artifact scans.
- Fake-clock one-hour, over-24-hour, and 72-hour refresh/rotation, omitted
  replacement Refresh Token, and long-term authorization failure.

Fake-clock and ordinary-browser tests are not Wallpaper Engine acceptance.
Real-device CORS/Origin, storage persistence and inter-screen sharing,
restart, sleep/resume, offline recovery, and 72-hour soak remain unverified
until separately measured and recorded for the new build. Separate storage
contexts require independent authorization and have no shared-lock guarantee.

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
- Direct-provider warning wrapper and local Rust provider-v1 fixture parity
- error classification
- settings load fallback
- mock mode initialization
- Visualizer motion continuity, maximum album scale, maximum particle speed and
  brightness, capped album offset, silence release, and non-finite input handling
- Fixed virtual volume gain at 1/25/50/100 percent, gain 1 for zero/missing/
  invalid volume, and equivalence to volume-100 shaping and motion
- Real-audio eligibility after the first successful current-provider poll,
  stopped/missing-item/source-mismatch rejection, transient-error retention,
  and provider-change reset
- Settings v3 migration, one-time legacy intensity conversion, and legacy
  seekbar migration to the straight line style
- Glowing-particle outward movement, speed multiplier, lifetime, viewport cull,
  and finite-state safety
- Direct credential persistence, refresh concurrency, stale input and retirement
- Loopback provider-v1 transport, redirect rejection and safe errors
- Retired public HTTPS origins never receive credentials

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
- Glowing objects start near the viewport center, travel outward, and remain
  visible independently of album art and the SVG visualizer.
- Continuous impact expands the album content and accelerates/brightens
  particles; low-frequency impact moves the content by at most 8px and silence
  returns all values to neutral.
- The straight seekbar remains independent while the inner album content scales
  and moves; no progress-ring element is rendered.
- Volume 1, 25, 50, and 100 produce the same visual response for equivalently
  attenuated input; zero and unavailable volume use gain 1.
- Before the first successful Spotify result, and for paused, stopped,
  missing-item, or source-mismatched playback, PC audio does not drive album or
  glowing-object motion. The SVG visualizer receives an immediate zero frame,
  and motion returns to neutral in about 450ms.
- A transient Spotify communication failure retains the last valid playing
  eligibility. Changing provider waits for the new provider's first success.
- Item-null, no-active-device, unauthorized, and forbidden results disable
  real-audio eligibility even though the last display data remains available.
- A successful Play control remains idle until the next successful playing poll.
- Browser mock audio is not volume-boosted. Wallpaper Engine's PC-wide mixed
  audio means other applications in the mix are boosted while Spotify is
  eligible.
- Zero particle count/life use the automatic performance-mode values, and the
  disabled toggle stops and clears the Canvas loop.
- `around-album` centers circular visualizer geometry on the album art.
- `album-ring` is a closed circular waveform around the album and in the
  smaller bottom region; `bottom-up` stays at the lower edge and grows radial
  bars upward.
- Switching between `album-only` and `album-details` enables the track-panel
  text entry and album-frame transition.
- Reduced motion stops those display-mode animations and transitions.
- Low-power mode reduces work.
- Rainmeter output contains no secrets.
- Token never appears in logs.
- Pairing Token never appears in logs, URLs, debug output, or stored backend pages.
- Direct, loopback Rust, and browser mock paths
  all work independently.
- Shared TypeScript normalization remains the authority for direct and loopback
  paths; Rust parity is checked at the provider-v1 fixture boundary.
- `invalid_grant` stops refresh retries and permits reauthorization.
- Arbitrary HTTPS origins and redirects receive no Bearer token.
- Wallpaper Engine survives a 72-hour direct-connection soak.

## Regression policy

Any change touching settings, Spotify, or Wallpaper Engine adapter must verify mock mode and broken-settings fallback.
