# SubAgent Matrix

## Dispatch policy

This matrix makes role dispatch optional for small and normal tasks; it does
not require a SubAgent for every task. The mandatory roles below apply when a
strict, Phase, security, or architecture trigger is present.

- Small isolated changes do not start a SubAgent by default.
- Normal changes start one only when independent reasoning materially reduces
  risk or the user requests it.
- Strict-gated, security-sensitive, architecture, Phase, and release work must
  assign the required roles below. Assign only the roles triggered by the
  change; do not launch unrelated roles automatically.

## Sol quality reviewer

The Sol reviewer is the read-only quality reviewer for strict-gated work. It
reviews the exact current diff against the task and relevant specifications.
`PASS` means zero unresolved valid findings; any valid finding requires a fix
and a new review of the changed diff.

## Review roles

Review roles are read-only: they inspect the requested scope but do not edit
files or run Git operations. The current task or reviewed plan assigns
implementation ownership and any required model or reasoning level. Completed
plans do not reserve an agent. Security remains an independent perspective for
credential, provider, Worker, and Tauri work.

## SpecGuard Agent

Required for every Phase and strict-gated change. Reads all entry docs and
every touched domain doc, reviews the phase or strict-gated output, and blocks
completion if hard rules are violated.

## Architecture Agent

Owns repository structure, app/crate/package boundaries, build flow, and dependency direction.

Required for architecture or cross-cutting changes.

Reads:

- `02-repository-structure.md`
- `03-implementation-phases.md`
- only the domain documents touched by the task during initial planning

## Spotify Agent

Owns OAuth, token refresh, playback polling, normalized playback state, controls, and Spotify errors.

Reads:

- `10-spotify-integration.md`
- `04-quality-gates.md`
- `19-player-clock.md` when controls are touched

## Public Worker Agent

Owns Cloudflare Worker routing, D1 schema, OAuth PKCE, encryption, Pairing Tokens, refresh coordination, Spotify proxying, reauthorization, deletion, and deployment tests.

Reads:

- `25-public-backend.md`
- `10-spotify-integration.md`
- `04-quality-gates.md`
- `22-performance.md`
- `23-test-qa.md`

## Security Reviewer

Independently reviews secret surfaces, OAuth state/callback handling, cryptography, D1 persistence, Pairing Token verification, CORS, CSRF, redirects, rate limits, logging, reauthorization, deletion, and restore behavior. It does not implement the reviewed task.

Required for strict-gated changes involving credentials, authentication,
public backend, OAuth, cryptography, logging, redirects, or Tauri. A
self-review cannot replace this independent perspective.

## Wallpaper Engine Agent

Owns Wallpaper Engine property adapter, audio listener, browser mock mode, and build output expectations.

Reads:

- `11-wallpaper-engine.md`
- `16-visualizer.md` when audio data is touched

## Rust WASM Agent

Owns Rust pure logic crates and tests.

Reads:

- `12-rust-wasm-core.md`
- related domain docs for implemented algorithms

## Settings Schema Agent

Owns settings schema, defaults, validation, and migration.

Reads:

- `13-settings-schema.md`
- all domain docs that define setting fields

## UI Layout Agent

Owns layers, layout items, coordinate positioning, and presets.

Reads:

- `14-ui-layout.md`
- `13-settings-schema.md`

## Background Theme Agent

Owns album background, theme generation, fallback colors, and readability.

Reads:

- `15-background-theme.md`
- `22-performance.md`

## Visualizer Agent

Owns visualizer modes, tuning, audio normalization use, and rendering performance.

Reads:

- `16-visualizer.md`
- `11-wallpaper-engine.md`
- `22-performance.md`

## Lyrics Agent

Deferred in current v1 scope. Owns any future reintroduction of LRC parsing, lyrics state, lyrics display, and provider boundaries after specs and tests are updated.

Reads:

- `17-lyrics.md`
- `12-rust-wasm-core.md` when parser logic is touched

## Transition Agent

Owns previous/current state, animation presets, and reduce motion.

Reads:

- `18-transitions.md`
- `22-performance.md`

## Player Clock Agent

Owns player display, controls, seekbar, and clock.

Reads:

- `19-player-clock.md`
- `10-spotify-integration.md`

## Tauri Configurator Agent

Owns optional configurator app, settings editor, OAuth assistance, export/import, and preview.

Reads:

- `20-tauri-configurator.md`
- `13-settings-schema.md`
- `10-spotify-integration.md`

## Rainmeter Agent

Owns optional Rainmeter output.

Reads:

- `21-rainmeter.md`
- `10-spotify-integration.md`
- `15-background-theme.md`

## Performance Agent

Owns runtime cost checks and performance-mode behavior.

Reads:

- `22-performance.md`
- every touched visual or polling domain doc

## QA Agent

Owns tests, mock fixtures, manual QA checklists, and regression verification.

Reads:

- `23-test-qa.md`
- `04-quality-gates.md`

## Docs Agent

Owns user and developer docs.

Reads:

- `24-docs-and-reporting.md`
- every doc affected by behavior changes
