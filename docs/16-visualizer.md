# Visualizer

## Responsibilities

This domain owns audio visualization modes, customization parameters, audio normalization, and performance scaling.

## Required modes

MVP:

- album ring
- radial bars
- waveform line

Planned:

- particles
- background pulse
- equalizer bars
- halo glow
- corner spectrum
- minimal pulse

## Customization

Support:

- enabled
- mode
- intensity
- sensitivity
- smoothing
- decay
- bass weight
- mid weight
- treble weight
- bar count
- line width
- radius
- gap
- particle count
- particle life
- glow strength
- color mode
- mirror mode
- clamp max
- noise gate
- idle animation

The Wallpaper Engine property UI exposes mode plus four live tuning controls:

- intensity scales the final rendered size without feeding the result back
  into smoothing or decay;
- sensitivity amplifies input before the noise gate and silence decision;
- smoothing ranges from immediate response at 0 to a deliberately capped 0.95;
- decay speed ranges from a long tail at 0 to the fastest falloff at 1.

The optional configurator may expose the remaining parameters. Legacy
`rotationSpeed` values are accepted during settings repair but have no
presentation effect; current visualizer modes do not rotate as a whole.

## Position

`visualizer.position` is independent from the visualizer mode:

- `around-album` places the visualizer around the album art. The album frame is
  circular and the visualizer geometry shares the album-art center. The album
  image and the visualizer use the same frame, so position, size, and display
  mode transitions stay aligned. In the normalized 100×100 SVG, the album
  edge is radius 50 for album ring, radial bars, and waveform line.
- In `around-album`, radial bars are four-corner rectangles rather than round
  strokes. Their inner edge touches radius 50. Each bar starts as a 2×2
  normalized square, then adds only the sample-derived extension outward.
  The 0.03 threshold is checked after normalization but before intensity;
  intensity still scales the added extension. Samples below the threshold
  keep their angular and DOM slot but are hidden. An intensity of 0 hides all
  bars. Bars are placed evenly from the sample count; `gap` is not used by
  this position.
- `visualizer.radius` does not move the album edge. It changes only the
  outward extension of radial bars and the waveform; the album ring remains
  on radius 50. If album art is hidden or its layout item is disabled, the
  `around-album` visualizer is hidden with it.
- `bottom-up` anchors the visualizer to the lower edge of the viewport. Radial
  bars grow upward from the bottom edge, the waveform is stretched across the
  bottom, and `album-ring` becomes a horizontal peak band. Its existing `gap`
  and radius behavior are unchanged.

The safe default is `around-album`. Unsupported values are repaired at the
settings boundary. Positioning and geometry remain web-view responsibilities;
Rust/WASM only supplies pure audio normalization and readability calculations.

## Data source

Use Wallpaper Engine audio data if available. Fold its left and right 64-bin
channels into one averaged 64-bin spectrum, preserving frequency order. Use
mock audio in browser preview. Use idle animation if no audio data is
available.

The shaping order is safe input, sensitivity and band weighting, one
Rust/WASM-or-fallback normalization pass, then rendered intensity. Do not
normalize each frame to its own peak because that would erase absolute
loudness. Audio callbacks are rendered as received; no additional polling or
timer throttling is introduced. Album ring, radial bars, and waveform line do
not rotate as a whole. In `around-album`, the visualizer cancels the album
frame's layout rotation while continuing to share its translation, scale,
size, transitions, and visibility. Position-specific geometry and anchoring
are owned by the web view.

## Performance

Low-power mode must reduce samples, particles, blur, and draw frequency. Standard mode should be stable. High-effect mode may use heavier visuals but must be configurable.
