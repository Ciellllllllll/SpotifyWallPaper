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
- `docs/superpowers/specs/2026-08-04-system-wide-refactoring-structure-first.md`

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

## Active refactor execution policy
The active structure-first refactor is governed by
`docs/superpowers/specs/2026-08-04-system-wide-refactoring-structure-first.md`
and `docs/superpowers/plans/2026-08-04-system-wide-refactor-ponytail.md`.
Luna/MAX is the only implementation, test, finding-fix, and commit owner. A
single `gpt-5.6-sol` / medium SubAgent is reused as a read-only reviewer; it
must not edit files or run Git operations. No other model, reasoning level,
fallback, implementation SubAgent, branch, worktree, push, PR, merge, or
deploy is allowed.

Ponytail 4.8.4 standard SessionStart, SubagentStart, and UserPromptSubmit
hooks must remain trusted/enabled and full mode must be active before each
Phase. After Sol's explicit PASS on the exact diff, run the final
`@ponytail-audit`; only `Lean already. Ship.` is PONYTAIL PASS. A finding or
diff change returns to Sol review. Commit only after consecutive Sol and
Ponytail PASS results, then verify HEAD and a clean worktree.

## Architectural rule
The wallpaper display is a Web Wallpaper. Rendering belongs to the web frontend. Rust is used for pure logic through WASM and for the optional Tauri configurator backend.

The optional public Spotify proxy is a separate TypeScript Cloudflare Worker. It may own Spotify HTTP calls, OAuth PKCE, encrypted token persistence, and proxy API routes. It must not become required for browser mock mode, direct legacy mode, or the loopback Rust backend.

The Rust/WASM core must not own Spotify HTTP calls, DOM mutation, Canvas/WebGL drawing, or Wallpaper Engine API registration. It may validate settings, compute layout, generate themes, normalize visualizer data, and compute animation helper values.

## Required implementation order
For the active system-wide refactor, follow
`docs/superpowers/specs/2026-08-04-system-wide-refactoring-structure-first.md`.
It owns the refactor phase sequence and review/commit boundaries.

The 2026-07-27 design and its Phase 0 plan are historical evidence. They are
read for context but do not override the active structure-first authority.

`docs/03-implementation-phases.md` preserves the product-construction order.
Use it when adding product capability, and do not implement advanced effects
before the MVP foundations are in place.

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
