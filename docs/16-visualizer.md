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
  circular and the visualizer geometry shares the album-art center.
- `bottom-up` anchors the visualizer to the lower edge of the viewport. Radial
  bars grow upward from the bottom edge, the waveform is stretched across the
  bottom, and `album-ring` becomes a horizontal peak band.

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
not rotate; layout translation and scale are the only shared visualizer
placement transforms. Position-specific geometry and anchoring are owned by the
web view.

## Performance

Low-power mode must reduce samples, particles, blur, and draw frequency. Standard mode should be stable. High-effect mode may use heavier visuals but must be configurable.
