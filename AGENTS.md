# AGENTS.md

## Purpose
This repository implements a Spotify-linked Wallpaper Engine Web Wallpaper with high customization, Rust/WASM visual logic, and an optional Tauri configurator. This file is the mandatory entry point for Codex and all SubAgents.

## Required working directory
All implementation, verification commands, git operations, commits, and phase work must be performed in:

`D:\Git\SpotifyWallPaper`

Do not use Codex temporary worktrees such as `C:\Users\cielg\.codex\worktrees\...\SpotifyWallPaper` for repository work. If such a worktree exists from a prior run, migrate any needed commits back to `D:\Git\SpotifyWallPaper` and remove the temporary worktree.

## Mandatory reading order
Before changing files, every agent must read:

1. `docs/README.md`
2. `docs/00-codex-entrypoint.md`
3. `docs/01-project-goals-and-non-goals.md`
4. `docs/04-quality-gates.md`
5. `docs/05-repository-authority.md`
6. The domain document that matches the current task.

Architecture or cross-cutting work must also read:

- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/30-subagent-matrix.md`

Public backend work must also read `docs/25-public-backend.md`.

## Hard rules
Do not embed Spotify Client Secret in the Web Wallpaper.
Do not log Access Token, Refresh Token, Pairing Token, authorization code, OAuth state, PKCE verifier, Worker encryption/HMAC keys, or full OAuth callback URL.
Do not put Spotify tokens, Pairing Tokens, authorization codes, OAuth state, PKCE verifiers, or callback URLs in URL parameters outside Spotify's required authorization callback.
Do not store a public-backend Pairing Token in plaintext outside Wallpaper Engine's user property and the one-time no-store authorization success response.
Disable Cloudflare invocation logs for any Worker that handles Spotify OAuth callbacks.
Do not record, store, transform, or redistribute Spotify audio.
Do not bundle lyrics data.
Do not make the Tauri configurator mandatory for the Wallpaper Engine wallpaper to run.
Do not call Spotify APIs every frame.
Do not run album color extraction every frame.
Do not let broken settings crash the wallpaper.
Do not remove mock/browser preview support.
Do not discard previous track state immediately on track change; transitions need previous and current states.
Please commit once each phase is complete. Please refer to previous commit messages when writing your commit message.

## Ponytail baseline and review policy
For every implementation or QA plan, resolve the official Ponytail
marketplace's latest stable release when the plan is finalized and again at
execution start if that occurs on another day. Confirm the marketplace Git source with
`codex plugin marketplace list --json`, refresh its snapshot with
`codex plugin marketplace upgrade ponytail --json`, and cross-check the
source and exact revision in `.codex-marketplace-install.json`, the snapshot
and installed `.codex-plugin/plugin.json` plus `package.json`, and
`codex plugin list --available --json --marketplace ponytail`. If the
advertised stable differs from the installed version, update with
`codex plugin add ponytail@ponytail --json`.

Do not adopt a prerelease, source mismatch, indeterminate version, update that
needs additional authority, or version with unknown compatibility. Stop on
failure; do not automatically remove Ponytail or fall back to an older
version. After an update, restart Codex Desktop and use a new task to verify
identity/version, standard trusted/enabled `SessionStart`, `SubagentStart`, and
`UserPromptSubmit` hooks, permissions, full mode, the `ponytail` and
`ponytail-audit` skills, the whole-repository read-only audit contract, and the
`Lean already. Ship.`
sentinel. An update also invalidates any earlier reviewer: create a new
read-only reviewer with the same model, reasoning level, permissions, and
scope, then review the complete plan again.

Freeze the resolved source, snapshot revision, exact version, verification
time, hooks, mode, and audit result for that plan in `.codex/reports` and in
the report's `Review outcome`; a tracked plan or report must carry the same
baseline. Preserve exact versions in historical evidence. For each frozen
diff, obtain an explicit read-only Sol review PASS before the Ponytail full
audit. Only `Lean already. Ship.` is PONYTAIL PASS. A finding or diff change
returns to Sol review. Commit only after consecutive Sol and Ponytail PASS
results, then verify HEAD and a clean worktree.

## Architectural rule
The wallpaper display is a Web Wallpaper. Rendering belongs to the web frontend. Rust is used for pure logic through WASM and for the optional Tauri configurator backend.

The optional public Spotify proxy is a separate TypeScript Cloudflare Worker. It may own Spotify HTTP calls, OAuth PKCE, encrypted token persistence, and proxy API routes. It must not become required for browser mock mode, direct legacy mode, or the loopback Rust backend.

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
At the end of each task or phase, report exactly:

- Phase name
- Summary
- Changed files
- Relevant docs read
- Implemented requirements
- Known gaps
- Tests run
- Risks introduced
- Review outcome
- Fixes from review
- Verification commands
- Next recommended task

## Repository authority
`config/repository-authority.json` is the machine-readable ownership contract.
`docs/05-repository-authority.md` explains its classifications, generated-source
exception, ignore ownership, and migration safeguards. All Markdown beneath
`docs/` is tracked repository material. Historical plans and reports are
evidence, not current normative behavior.

## SpecGuard requirement
SpecGuard must review every phase before it is considered complete. SpecGuard checks scope, secrets handling, performance, settings safety, and whether the implementation still works without Spotify connection by using mock data.

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
