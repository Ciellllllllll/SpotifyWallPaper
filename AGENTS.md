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
5. The domain document that matches the current task.

Architecture or cross-cutting work must also read:

- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/30-subagent-matrix.md`

## Hard rules
Do not embed Spotify Client Secret in the Web Wallpaper.
Do not log Access Token, Refresh Token, authorization code, or full OAuth callback URL.
Do not record, store, transform, or redistribute Spotify audio.
Do not bundle lyrics data.
Do not make the Tauri configurator mandatory for the Wallpaper Engine wallpaper to run.
Do not call Spotify APIs every frame.
Do not run album color extraction every frame.
Do not let broken settings crash the wallpaper.
Do not remove mock/browser preview support.
Do not discard previous track state immediately on track change; transitions need previous and current states.
Please commit once each phase is complete. Please refer to previous commit messages when writing your commit message.

## Architectural rule
The wallpaper display is a Web Wallpaper. Rendering belongs to the web frontend. Rust is used for pure logic through WASM and for the optional Tauri configurator backend.

The Rust/WASM core must not own Spotify HTTP calls, DOM mutation, Canvas/WebGL drawing, or Wallpaper Engine API registration. It may validate settings, compute layout, parse LRC, generate themes, normalize visualizer data, and compute animation helper values.

## Required implementation order
Follow `docs/03-implementation-phases.md`. Do not implement advanced effects before the MVP foundations are in place.

Minimum order:

1. Repository scaffold and mock preview
2. Spotify polling and normalized playback model
3. Wallpaper Engine property and audio bridge
4. Rust/WASM core
5. Layout and settings schema
6. Background/theme
7. Visualizer
8. Lyrics
9. Transitions
10. Player controls
11. Tauri configurator
12. Rainmeter
13. QA, docs, release polish

## SubAgent reporting format
At the end of each task or phase, report:

- Summary
- Changed files
- Relevant docs read
- Implemented requirements
- Known gaps
- Tests run
- Risks introduced
- Next recommended task

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
