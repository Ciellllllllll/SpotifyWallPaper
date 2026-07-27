# Rust WASM Core

## Responsibilities

Rust/WASM handles pure logic only.

Allowed responsibilities:

- settings validation helper logic
- settings migration helper logic
- layout coordinate calculation
- color extraction support or theme generation support
- contrast/readability calculation
- visualizer data normalization
- animation interpolation helpers

Forbidden responsibilities:

- Spotify HTTP calls
- token refresh
- DOM mutation
- Canvas/WebGL drawing
- Wallpaper Engine API registration
- local file writes from wallpaper runtime

## Design rule

Prefer deterministic pure functions. Inputs should be settings, dimensions, playback progress, image/color data, or visualizer arrays. Outputs should be plain serializable values.

## Tests

Required tests:

- valid settings remain valid
- invalid settings are corrected or rejected safely
- old schema migrates
- layout calculation for all anchors
- visualizer smoothing/decay/clamping
- contrast result for bright and dark backgrounds
- animation interpolation boundaries

## WASM boundary

TypeScript must receive safe values. Any parse failure must return a structured error or fallback, not panic into the UI.
