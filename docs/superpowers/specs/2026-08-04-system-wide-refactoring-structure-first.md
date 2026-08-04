# System-Wide Refactoring: Structure-First Authority

## Status and precedence

This is the active cross-cutting design as of 2026-08-04. It supersedes the
2026-07-27 design for execution sequencing and review policy. The 2026-07-27
document remains historical evidence of the earlier design review and is not
current implementation authority. Product capability order in
`docs/03-implementation-phases.md` remains normative for new capability work.

Implementation occurs only in the primary checkout
`D:\Git\SpotifyWallPaper` on the existing branch
`Fix/system-wide-refactor`. No worktree, branch, push, PR, merge, or deploy is
permitted by this design.

## Objective

Fix the major structural problems as one system: make settings and credentials
have one authority, separate providers from runtime and presentation, make
Wallpaper and Configurator share a renderer, align provider contracts, and
prove mock/WASM/security invariants. This is not a blanket strictness project;
validation changes are introduced only where they make a boundary observable
or preserve an explicit contract.

## Model and review policy

- Luna/MAX is the sole implementation, test, finding-fix, and commit owner.
- One dedicated `gpt-5.6-sol` / `medium` SubAgent is started before work and
  reused for every Phase. It is read-only and may not edit, commit, or run Git
  operations.
- No other model, reasoning level, fallback, or implementation SubAgent is
  allowed for this refactor.
- At each Phase: Luna runs targeted tests/build; Sol reviews code,
  architecture, and SpecGuard (Security as required); Luna fixes findings and
  obtains an explicit Sol `PASS`; then Luna runs the final Ponytail audit on
  the same diff and records `Lean already. Ship.` as `PONYTAIL PASS`; only the
  consecutive Sol/Ponytail passes permit the Phase report and commit.
- A Ponytail finding returns the Phase to implementation, tests, Sol review,
  and a new final audit. Review and audit results are valid only for the exact
  diff they inspected.

## Ponytail Hook contract

Use Ponytail 4.8.4's standard trusted/enabled hooks only; do not add custom
hooks. `SessionStart` reinjects Ponytail full on startup, resume, clear, and
compact. `SubagentStart` injects full mode for Sol. `UserPromptSubmit` tracks
mode and detects unintended off transitions. Node must be available to the
non-interactive Hook path and Ponytail mode must be `full` before a Phase
starts. Phase 1, 4, 6, and 9 also run the specified periodic `@ponytail-audit`.
The audit checks structural complexity only and never replaces correctness,
security, performance, or SpecGuard review.

## Target boundaries

```text
WE properties / browser mock -> wallpaper composition root
WE audio / browser mock -> createWallpaperRuntime
composition root -> process-memory credential closure -> provider factory
mock/direct/backend provider -> runtime -> WallpaperViewModel -> wallpaper-view
shared-types -> provider, runtime, view, Configurator, Worker
visualCore adapter -> runtime
Configurator -> wallpaper-view (preview only)
Worker and loopback -> provider-v1 JSON fixtures
```

Dependency rules:

- `packages/shared-types` has no workspace, DOM, Svelte, network, or app
  dependency.
- Add only `packages/wallpaper-view`; it depends only on shared types.
- Runtime never imports the view and apps never use cross-app relative imports.
- Worker consumes shared TypeScript contracts; Rust consumes versioned JSON
  fixtures. Do not create settings/provider/runtime/WASM contract packages.

## Settings and provider contracts

Settings v2 is the sole preference shape. Defaults are `provider: 'mock'` and
`displayMode: 'album-only'`. It preserves existing display, performance,
Rainmeter, and debug preferences, but never carries Client ID, Refresh Token,
Pairing Token, or `hasRefreshToken`. V1/unversioned migration is preference-
only; explicit old direct/backend selection becomes a visible reauthorization
state, and future versions are rejected to safe defaults without downgrade or
autosave.

`album-only` renders background, album art, visualizer/seekbar, and debug or
transition state while hiding track text, player controls, volume, and clock.
`album-details` enables the full title/artist/progress/duration/clock/control
presentation. Both modes are characterized explicitly; mode selection never
rewrites saved layout values.

```ts
type PlaybackProviderKind = 'mock' | 'direct' | 'backend';
type DisplayMode = 'album-only' | 'album-details';

interface WallpaperPreferences {
  schemaVersion: 2;
  spotify: {
    provider: PlaybackProviderKind;
    backendOrigin?: string;
    pollIntervalPlayingMs: number;
    pollIntervalPausedMs: number;
  };
  player: ExistingPlayerPreferences & { displayMode: DisplayMode };
}

interface PlaybackProvider {
  readonly kind: PlaybackProviderKind;
  poll(signal: AbortSignal): Promise<ProviderResult<NormalizedPlayback>>;
  control(command: PlaybackCommand, signal: AbortSignal): Promise<ProviderResult<void>>;
  dispose(): void;
}
```

Mock, direct, and backend are the only providers. Configuration errors are
distinct from network errors. Direct owns refresh single-flight, rotation,
`invalid_grant`, and one 401 retry. Backend accepts only the exact provider-v1
envelope. Invalid explicit providers never silently fall back to another
network provider.

## Runtime and view contract

`createWallpaperRuntime()` owns provider lifecycle, polling/backoff, previous
and current playback, progress, clock, audio, visualizer, theme and transition
generations, and disposal. It rejects stale poll/theme results, handles rapid
A→B→C changes, and exposes only a secret-free readonly ViewModel. `App.svelte`
retains runtime wiring, ViewModel generation, and component composition; it
does not own fetch, timers, storage, settings repair, credentials, refresh, or
audio shaping.

`wallpaper-view` receives props and intent callbacks only. It owns no network,
timer, storage, Wallpaper Engine, Tauri, credential, or WASM initialization.
Wallpaper and Configurator use the same renderer; Configurator intents never
send Spotify controls.

During Phase 0B, recovered domain documents retain their exact historical raw
bytes. Their baseline responsibilities are characterization inputs, not a
permission to expand the target architecture. The relevant domain document,
authority policy, preservation fixture, and tests must change together in the
Phase that retires a baseline responsibility. Until then, the active target is
transitional and the old document text is evidence of the behavior being
frozen.

## Phase sequence and commit boundaries

Phase 0A is a no-commit history preparation: create the local archive tag
`archive/system-wide-refactor-pre-reset-ea158f0`, reset the branch to
`455dcf1`, then fast-forward `d13ff25` and `a3c5400`; never run `git clean`.
Phase 0B replaces active authority documents and does not change product code.

1. **Phase 0B — Active authority:** make this 2026-08-04 design and its plan
   active; classify 2026-07-27 design/plan as historical; align AGENTS, docs
   index, structure, quality, settings, Spotify, WASM, layout, visualizer,
   player, Tauri, QA, and public-backend documents. Do not extend the Phase 0
   authority verifier.
2. **Phase 1 — Characterization:** add only `@playwright/test@1.62.1`; freeze
   fixed-time playback/audio/art/reduced-motion golden fixtures at 1920×1080
   and 3440×1440 for both display modes; max diff ratio is 0.002. Run the
   baseline Ponytail audit.
3. **Phase 2 — Shared contract and Settings v2:** split shared-types
   internally, implement defaults/migration/repair/preset/serializer and
   secret-free provider-v1 fixtures; test future/malformed/round-trip cases.
4. **Phase 3 — Credential/settings cutover:** delete-only legacy browser
   cleanup, preference-only v1 migration, fail-closed mock on cleanup failure,
   process-memory credential closure, complete Wallpaper Engine snapshots, and
   v2 cutover. Security review is mandatory.
5. **Phase 4 — Provider/backend contract:** split mock/direct/backend/factory;
   make mock/ready/invalid explicit; fix only Worker/loopback fixture drift;
   do not redesign Worker OAuth/D1/deletion or loopback storage/reset. Run the
   integration Ponytail audit and Security review.
6. **Phase 5 — Runtime extraction:** move orchestration from App.svelte to
   runtime; preserve history, polling, progress, controls, clock, audio,
   visualizer, theme, transitions, stale-result and disposal invariants.
7. **Phase 6 — Shared renderer:** create `packages/wallpaper-view`, migrate
   Wallpaper and Configurator, remove duplicate defaults/presets/import/export/
   preview/CSS, and run the integration Ponytail audit.
8. **Phase 7 — Tauri secret boundary:** use one
   `authorize_spotify_and_copy_swpt1` command; keep verifier/state/callback/code/
   Refresh Token in Rust locals, confirm natively, copy `swpt1` once, return
   only status/fixed errors. Security review is mandatory.
9. **Phase 8 — WASM boundary:** remove Rust layout ABI, retain normalization and
   readability, use typed arrays on hot paths, generate bindings in ignored
   output, and prove actual-WASM/fallback parity (`1e-5` samples,
   `1e-4` readability).
10. **Phase 9 — Build/cleanup/final audit:** order root build as WASM → shared
    types → consumers; keep Cargo/Tauri/loopback CI jobs independent; remove
    obsolete settings/cache/preview/duplicate preset/old WASM/config-schema
    only after consumer-zero evidence; run clean-install gates and the full
    repository Ponytail audit. No push.

## Verification and reporting

Heavy commands use `h5i capture run --`. Minimum relevant commands are root
test/check/build, Playwright, Rust fmt/clippy/test, Worker/Tauri/backend tests,
`git diff --check`, and `codegraph index`. Every Phase report uses exactly:
Phase name; Summary; Changed files; Relevant docs read; Implemented
requirements; Known gaps; Tests run; Risks introduced; Review outcome; Fixes
from review; Verification commands; Next recommended task.

The report must record existing audit findings as pre-existing or deferred to
a later Phase and must resolve every finding newly introduced by the current
Phase. Do not stage `.codex/reports`. Completion requires all Phase commits on
`Fix/system-wide-refactor`, consecutive Sol/Ponytail passes for the same diff,
mock startup without Spotify/Tauri/WASM, one settings/preset implementation,
explicit provider separation, shared renderer, runtime composition root, and
no remote push.
