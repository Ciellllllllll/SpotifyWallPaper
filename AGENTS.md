# AGENTS.md

## Purpose
This repository implements a Spotify-linked Wallpaper Engine Web Wallpaper with high customization, Rust/WASM visual logic, and an optional Tauri configurator. This file is the mandatory entry point for Codex and all SubAgents.

## Required working directory
All implementation, verification commands, git operations, commits, and phase work must be performed in one checkout for this repository. The primary checkout is:

`D:\Git\SpotifyWallPaper`

Use `D:\Git\SpotifyWallPaper` by default. Use a Codex-managed worktree only
when Codex explicitly assigned it as the working location when the current
task started. Do not manually choose a worktree or use a stale or another
task's worktree. Do not split one task across multiple checkouts.

## Mandatory reading order
Before changing files, every agent must read:

1. `docs/README.md`
2. `docs/00-codex-entrypoint.md`
3. The domain document that matches the current task.

Use the work classes in `docs/04-quality-gates.md` to choose the remaining
reading. Small isolated changes need only the touched domain document and the
relevant quality checks. Normal changes also read these documents:

- `docs/01-project-goals-and-non-goals.md`
- `docs/04-quality-gates.md`
- `docs/05-repository-authority.md`

Strict-gated, documentation-authority, and repository-policy changes read all
entry documents.

Architecture or cross-cutting work must also read:

- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/30-subagent-matrix.md`

Public backend work must also read `docs/25-public-backend.md`.

## Hard rules
Do not embed Spotify Client Secret in the Web Wallpaper.
Do not log Access Token, Refresh Token, Pairing Token, authorization code, OAuth state, PKCE verifier, public-backend encryption/HMAC keys, or full OAuth callback URL.
Do not put Spotify tokens, Pairing Tokens, authorization codes, OAuth state, PKCE verifiers, or callback URLs in URL parameters outside Spotify's required authorization callback.
Do not store a public-backend Pairing Token in plaintext outside Wallpaper Engine's user property and the one-time no-store authorization success response.
Disable Caddy access logs and OAuth2 Proxy request/auth logs, and never record callback URLs or query strings in Node, systemd, PostgreSQL, or backup logs.
Do not record, store, transform, or redistribute Spotify audio.
Do not bundle lyrics data.
Do not make the Tauri configurator mandatory for the Wallpaper Engine wallpaper to run.
Do not call Spotify APIs every frame.
Do not run album color extraction every frame.
Do not let broken settings crash the wallpaper.
Do not remove mock/browser preview support.
Do not discard previous track state immediately on track change; transitions need previous and current states.
Please commit once each phase is complete. Please refer to previous commit messages when writing your commit message.

## Work size and review policy

Ponytail's minimal-solution guidance remains enabled for all coding work, but
marketplace refresh/freeze and the full audit are required only for strict
gates (or when the user explicitly requests them). Review cost is proportional
to risk:

- Small isolated changes meet all of these conditions: they change at most
  three tracked files; all changed files are inside one existing boundary
  (`apps/<name>/`, `packages/<name>/`, `crates/<name>/`, `scripts/`, or
  `tests/`), or they change one `docs/<file>` or one root file; and they change
  no credential, authentication, security-sensitive, external contract,
  settings schema, architecture, dependency, CI, repository policy, Phase, or
  release behavior.
  They use focused local verification only. Do not start a reviewer or
  SubAgent by default.
- Normal changes may cross existing implementation boundaries but do not touch
  the strict triggers below. Every change that is neither small nor strict is
  normal. They use focused self-review and tests. Add an
  independent reviewer or SubAgent only when material uncertainty remains or
  the user requests it.
- Security-sensitive, authentication, secrets, public backend, Tauri, settings
  schema or migration, external contract, dependency, architecture,
  cross-cutting, documentation-authority, CI or repository-policy changes,
  Phase/release work, and explicitly requested full QA use the strict review
  gates below. A task assigned to a Phase or release is strict even when its
  file count fits the small boundary.

When uncertain, classify the work as high risk. Security and repository hard
rules are never waived by the small-change path.

## Ponytail baseline and review policy

For strict-gated work only, resolve and freeze the official Ponytail
marketplace baseline, source, exact revision, version, hooks, mode, and audit
result in `.codex/reports`. Use the current repository quality-gate procedure
for the required marketplace checks, Sol review, SpecGuard review, Ponytail
audit, re-review, and clean-HEAD verification. Do not adopt a prerelease,
source mismatch, indeterminate version, or update with unknown compatibility.
`Lean already. Ship.` is the only PONYTAIL PASS.

## Architectural rule
The wallpaper display is a Web Wallpaper. Rendering belongs to the web frontend. Rust is used for pure logic through WASM and for the optional Tauri configurator backend.

The standard Spotify path uses the static GitHub Pages PKCE helper for initial authorization and reauthorization, then DirectPlaybackProvider connects to Spotify from Wallpaper Engine. The dedicated IndexedDB credential store is the limited exception permitting direct Refresh/Access Token persistence; preference JSON, exports, logs, URLs, and distribution artifacts remain credential-free. Browser storage is plaintext application storage, not an OS secret vault. Do not assume storage or locks are shared across Wallpaper Engine screens or processes without measurement.

The optional public Spotify proxy is a separate Node.js TypeScript service backed by PostgreSQL and exposed through Caddy plus OAuth2 Proxy. It may own Spotify HTTP calls, OAuth PKCE, encrypted token persistence, and proxy API routes. Production remains `SPOTIFY_MODE=policy_locked` until a separately reviewed policy decision permits real Spotify traffic. It must not become required for browser mock mode, standard direct mode, or the loopback Rust backend. This migration does not authorize deployment, VPS shutdown, or resource deletion.

The Rust/WASM core must not own Spotify HTTP calls, DOM mutation, Canvas/WebGL drawing, Wallpaper Engine API registration, settings, or layout. TypeScript owns settings and layout authority. Rust/WASM is limited to typed-array visual normalization and readability calculations.

## Required implementation order
`docs/03-implementation-phases.md` preserves the product-construction order.
Use it when adding product capability, and do not implement advanced effects
before the MVP foundations are in place.

The 2026-07-27 and 2026-08-04 system-wide refactor designs and plans are
historical evidence. They may explain prior work but do not override current
entry and domain specifications.

Minimum order:

1. Repository scaffold and mock preview
2. Spotify polling and normalized playback model
3. Wallpaper Engine property and audio bridge
4. Rust/WASM core
5. Layout and settings schema
6. Background/theme
7. Visualizer
8. Transitions
9. Player controls
10. Tauri configurator
11. Rainmeter
12. QA, docs, release polish

Lyrics/LRC support is deferred from the current v1 scope. Reintroduce it only after updating the current specs, settings schema, tests, and SpecGuard checklist in the same phase.

## Reporting format

Use the full report format for Phase, release, and strict-gated work. For a
small or normal task, report: work class, summary, changed files, verification,
known risks, intentionally omitted gates, and next recommended task. Do not
create a full Phase report for a small isolated change unless the task is part
of a Phase.

## Repository authority
`config/repository-authority.json` is the machine-readable ownership contract.
`docs/05-repository-authority.md` explains its classifications, generated-source
exception, ignore ownership, and migration safeguards. All Markdown beneath
`docs/` is tracked repository material. Historical plans and reports are
evidence, not current normative behavior.

## SpecGuard requirement
SpecGuard must review every phase before it is considered complete. For
non-Phase work, use SpecGuard for strict-gated or explicitly requested reviews.
It checks scope, secrets handling, performance, settings safety, and whether
the implementation still works without Spotify connection by using mock data.

## Rules for Using Commands
Read the `docs/how-to-use-h5i.md` section before using the h5i command.
When running resource-intensive commands, do not execute them directly; always run them via `h5i capture run`.

Example:
- h5i capture run -- cargo check
- h5i capture run -- cargo test
- h5i capture run -- cargo clippy

If an error occurs, first read the summary output by h5i to identify the cause.
Only check the full log using `h5i recall object <id>` if necessary.

## CodeGraph

When CodeGraph is available, use it before broad grep/read exploration.

Use CodeGraph to locate relevant files, symbols, callers, callees, and impact areas before reading source files directly.

After major edits, refresh the index with:

```bash
codegraph index
```
