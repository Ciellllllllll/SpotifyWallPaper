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
  bottom, and `album-ring` becomes a horizontal peak band. Radial bars are
  four-corner rectangles with no rounded corners. The same 0.03 threshold is
  applied before intensity, so quieter bars keep their slots but are hidden.
  `gap` still controls their bottom-up spacing; `visualizer.radius` changes
  only the upward extension of bars and the waveform and does not scale or
  move the bottom anchor.

The safe default is `around-album`. Unsupported values are repaired at the
settings boundary. Positioning and geometry remain web-view responsibilities;
Rust/WASM only supplies pure audio normalization and readability calculations.

## Data source

Use Wallpaper Engine audio data if available. Fold its left and right 64-bin
channels into one averaged 64-bin spectrum, preserving frequency order. The
audio bridge reports whether the active source is `wallpaper-engine` or
`mock`. Browser preview keeps its mock frames and may use idle animation while
no audio source is connected. Once the Wallpaper Engine source is established,
noise-gated input is treated as silence: it never falls back to idle animation,
it may decay for at most 200ms, and then its normalized state is reset to zero.
If the Wallpaper Engine callback stops, the performance-mode timeout injects a
zero frame instead of restarting idle animation.

The shaping order is safe input, sensitivity and band weighting, one
Rust/WASM-or-fallback normalization pass, then rendered intensity. Do not
normalize each frame to its own peak because that would erase absolute
loudness. Audio callbacks are rendered as received; no additional polling or
timer throttling is introduced. Album ring, radial bars, and waveform line do
not rotate as a whole. In `around-album`, the visualizer cancels the album
frame's layout rotation while continuing to share its translation, scale,
size, transitions, and visibility. Position-specific geometry and anchoring
are owned by the web view.

## Response and effects

The view applies a presentation-only response curve after runtime noise gating
and normalization:

```text
response = min(1.35, pow(clamp(sample, 0, 1), 0.72) * responseGain)
```

`responseGain` is `0.90` in `low-power`, `1.15` in `standard`, and `1.35` in
`high-effect`. The final `intensity` setting still scales the rendered output
only. Standard and high-effect modes add thin glow layers: the album ring
pulses in thickness and opacity, while radial bars and both waveform views
receive a back-glow. Low-power keeps the main geometry but omits these extra
layers.

## Performance

Low-power mode must reduce samples, particles, blur, and draw frequency.
Standard mode uses the stronger response curve with restrained glow. High-effect
mode uses the strongest response and the same SVG-only glow layers with the
larger sample budget. No continuous decoration timer is used; effects change
only when a visualizer frame changes.
