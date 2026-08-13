# Implementation Phases

This document defines the current product-capability construction order.
Completed system-wide refactor plans are historical evidence and do not
override this sequence or the current entry and domain specifications.

## Phase 0: Scaffold and mock preview

Create the monorepo, wallpaper app, configurator app skeleton, Rust workspace, shared docs, and mock data. The wallpaper must render in a normal browser without Spotify.

Completion:

- Mock track visible.
- Mock album image visible or placeholder visible.
- Mock progress visible.
- Clock visible.
- Build succeeds.

## Phase 1: Spotify MVP

Implement Spotify token refresh, current playback polling, normalized playback model, and error classification.

Completion:

- Current playback can be displayed.
- Null item and stopped playback do not crash.
- Token values are never logged.
- Rate-limit handling exists.

## Phase 2: Wallpaper Engine bridge

Implement Wallpaper Engine property adapter, audio listener adapter, and browser fallback.

Completion:

- Wallpaper Engine properties can configure basic settings.
- Browser mock still works.
- Audio data mock and real listener path share one visualizer input model.

## Phase 3: Rust/WASM core

Implement pure calculation modules and tests.

Completion:

- Visualizer normalization tests pass.
- Readability tests pass.
- Typed-array boundary and WASM/fallback parity tests pass.

## Phase 4: Settings and layout customization

Implement versioned settings, layout items, coordinate-based positioning, anchors, and presets.

Completion:

- Main UI parts can be repositioned by coordinates.
- Invalid settings are repaired or defaulted.
- Presets can be selected.

## Phase 5: Background and theme

Implement album-based background modes, theme extraction, fallback theme, and readability correction.

Completion:

- Album change updates background and theme.
- Failed color extraction falls back safely.
- Text remains readable.

## Phase 6: Visualizer

Implement album ring, radial bars, waveform line, tuning parameters, idle animation, and performance modes.

Completion:

- Visualizer reacts to audio or mock data.
- Intensity and sensitivity settings affect output.
- Low-power mode reduces work.

## Deferred: Lyrics/LRC

Lyrics/LRC support is not part of the current v1 implementation order. Do not add lyrics settings, layout items, Wallpaper Engine properties, LRC parsers, or lyrics UI unless a future phase first updates `docs/17-lyrics.md`, settings schema, QA requirements, and tests.

## Phase 7: Transitions

Implement track-change detection, previous/current state retention, and required animations.

Completion:

- Track changes animate.
- Rapid track changes do not crash.
- Reduce-motion replaces aggressive effects.

## Phase 8: Player and clock

Implement player controls where permitted, seekbar, volume, repeat, shuffle, and optimized clock.

Completion:

- Passive display works without Premium.
- Unsupported controls fail gracefully.
- Clock update frequency is appropriate.

## Phase 9: Tauri configurator

Implement optional setup and settings editor.

Completion:

- Configurator can generate settings JSON.
- Token export is opt-in.
- Wallpaper still works without configurator.

## Phase 10: Rainmeter

Implement optional JSON export for Rainmeter.

Completion:

- Rainmeter file output can be enabled/disabled.
- Failure does not affect wallpaper.

## Phase 11: Final QA and docs

Complete docs, test coverage, manual QA, release notes, and sample settings.

Completion:

- README setup is usable.
- All quality gates pass.

## Post-v0.0.1: Optional public backend

Implement the formally approved Cloudflare Worker after the local backend and direct provider contracts are stable.

Order:

1. Public-backend specification and policy gate.
2. Worker/D1 test scaffold.
3. OAuth session, pairing, and encrypted storage.
4. Spotify refresh, normalized playback, controls, and backoff.
5. Trusted-origin wallpaper integration.
6. Operations, privacy, staging, soak, and release review.

Completion:

- Browser mock, direct legacy, and loopback Rust backend still work.
- D1 exports and logs contain no plaintext credentials.
- Refresh is single-flight under concurrency.
- Six-month reauthorization and deletion work.
- Security and SpecGuard reviews have no unresolved valid findings.
- General Workshop publication remains blocked until the Spotify policy gate is closed.
