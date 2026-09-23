# Rust WASM Helpers

## Responsibilities

Rust/WASM provides optional performance-path helpers. The wallpaper runs
with TypeScript fallback logic when WASM binaries are absent.

Current functions:
- `normalize_visualizer`: visualizer sample smoothing, decay, clamping,
  and noise gating (returns typed Float32Array for zero-copy hot path)
- `readability`: WCAG-based text color, overlay opacity, and shadow
  strength for a given background RGB

All visualizer rendering (SVG generation, bar/path layout, animation,
Canvas effects) and all theme extraction (album pixel sampling, color
selection) remain TypeScript-owned.

Forbidden responsibilities:

- Spotify HTTP calls
- token refresh
- DOM mutation
- Canvas/WebGL drawing
- Wallpaper Engine API registration
- local file writes from wallpaper runtime

Settings migration, repair, presets, layout semantics, and serialization are
TypeScript-owned by `@spotify-wallpaper/shared-types` and the wallpaper view.
The Rust crate has no settings schema authority and no layout ABI.

## Design rule

Prefer deterministic pure functions. Inputs should be settings, dimensions, playback progress, image/color data, or visualizer arrays. Outputs should be plain serializable values.

## Tests

Required tests:

- visualizer smoothing/decay/clamping
- contrast result for bright and dark backgrounds
- NaN, empty input, and typed-array boundary handling

## WASM boundary

The WASM adapter exposes only typed-array visual normalization and readability
functions. TypeScript must receive safe values. Any parse failure must return a
structured error or fallback, not panic into the UI. Generated bindings are
ignored build output and the production TypeScript fallback must pass parity
fixtures with the actual WASM implementation.
