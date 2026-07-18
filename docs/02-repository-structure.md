# Repository Structure

## Recommended monorepo layout

- `apps/wallpaper/`
  Wallpaper Engine Web Wallpaper. Svelte + TypeScript + Vite.

- `apps/configurator/`
  Optional Tauri configurator. Svelte frontend and Rust backend.

- `apps/backend/`
  Optional loopback-only Rust Spotify backend for local development.

- `apps/cloudflare-worker/`
  Optional public Spotify proxy. TypeScript Cloudflare Worker owning OAuth PKCE, encrypted D1 credentials, access-token refresh, playback/control proxying, reauthorization, and account deletion.

- `crates/visual-core/`
  Rust pure logic crate. WASM target. Handles theme, layout, visualizer normalization, animation helpers, and setting validation helpers when appropriate.

- `crates/config-schema/`
  Rust-side settings schema, defaults, migration helpers, and validation primitives.

- `packages/shared-types/`
  TypeScript shared types for normalized Spotify playback, settings, layout, theme, visualizer, Rainmeter output, and errors.

- `docs/`
  Split implementation specifications.

- `tests/`
  Shared mock data and integration fixtures.

## Ownership

The web wallpaper owns rendering, DOM, Canvas/WebGL, Wallpaper Engine properties, and browser mock mode.

The Rust/WASM core owns pure calculations only.

The configurator owns setup workflows, settings editing, export/import, OAuth assistance, and optional Rainmeter output.

Shared types define boundaries. Avoid passing raw Spotify API responses deep into UI components.

The public Worker owns network and persistence concerns only. It does not render the wallpaper, process audio, mutate the DOM, or replace Rust/WASM visual logic.

## Required boundaries

Raw Spotify response must be normalized before UI use.
Settings must be validated before UI use.
Wallpaper Engine API access must be isolated behind an adapter.
Browser mock mode must use the same display model as real Spotify mode.
