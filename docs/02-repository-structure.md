# Repository Structure

## Current boundaries

`packages/wallpaper-view` is the shared presentation workspace.
`packages/shared-types` remains dependency-free and owns shared DTOs, while
runtime owns lifecycle and the view owns presentation. The runtime must never
import the view; apps must not use relative imports across app boundaries.

## Recommended monorepo layout

- `apps/wallpaper/`
  Wallpaper Engine Web Wallpaper. Svelte + TypeScript + Vite.

- `apps/configurator/`
  Optional Tauri configurator. Svelte frontend and Rust backend.

- `apps/spotify-auth/`
  Static Spotify authorization helper for direct/Wallpaper Engine setup.

- `apps/backend/`
  Optional loopback-only Rust Spotify backend for local development.

- `apps/cloudflare-worker/`
  Optional public Spotify proxy. TypeScript Cloudflare Worker owning OAuth PKCE, encrypted D1 credentials, access-token refresh, playback/control proxying, reauthorization, and account deletion.

- `crates/visual-core/`
  Rust pure logic crate. The current boundary exposes only measured visual
  normalization/readability algorithms through typed arrays. Settings,
  layout, and safe-area semantics remain TypeScript-owned.

- `packages/shared-types/`
  Dependency-free TypeScript shared types and the single Spotify playback
  normalizer for normalized playback, settings, layout, theme, visualizer,
  Rainmeter output, and errors.

- `packages/wallpaper-view/`
  Shared presentational wallpaper/Configurator renderer. It accepts props and
  intent callbacks only; it has no network, storage, timer, host API,
  credential, or WASM lifecycle.

- `config/`
  Tracked machine-readable repository contracts, including repository
  authority.

- `scripts/`
  Tracked repository verification, preservation, and release-support tools.

- `.github/workflows/`
  CI entry points and reproducible verification orchestration.

- `examples/`
  Tracked safe examples and integration samples. Never place live credentials
  here.

- `docs/`
  Tracked entry, domain, operations, design, plan, and historical evidence
  documents.

- `tests/`
  Cross-workspace integration fixtures and tests. Workspace-local unit tests
  remain beside their owning source.

## Ownership

The web wallpaper owns rendering, DOM, Canvas/WebGL, Wallpaper Engine properties, and browser mock mode.

The Rust/WASM core owns pure calculations only.

The configurator owns setup workflows, settings editing, export/import, OAuth assistance, and optional Rainmeter output.

Shared types define boundaries. Avoid passing raw Spotify API responses deep into UI components.

`packages/shared-types/src/spotifyPlayback.ts` is the TypeScript normalization
authority used by the direct provider and Cloudflare Worker. Provider modules
keep transport, fallback, and warning policy; the Rust normalizer remains a
separate language-boundary implementation checked against provider-v1 fixtures.

The public Worker owns network and persistence concerns only. It does not render the wallpaper, process audio, mutate the DOM, or replace Rust/WASM visual logic.

Repository authority is owned by `config/repository-authority.json` and the
dependency-free scripts under `scripts/`. Git-tracked files are clean-clone
truth. Generated output, dependency caches, local evidence, local secrets, and
agent state remain ignored only through explicit owned rules. The Worker type
declaration is the sole tracked generated-source exception.

## Required boundaries

Raw Spotify response must be normalized before UI use.
Settings must be validated before UI use.
Wallpaper Engine API access must be isolated behind an adapter.
Browser mock mode must use the same display model as real Spotify mode.

Old Rust settings/layout characterization is historical evidence, not runtime
authority.

New Markdown under `docs/` must be tracked and classified in the authority
policy. New ignored output must declare an owner, producer, representative
probe, and tracked source inputs where applicable.
