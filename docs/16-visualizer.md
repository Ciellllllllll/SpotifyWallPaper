# Visualizer

## Responsibilities

This domain owns audio visualization modes, customization parameters, audio normalization, and performance scaling.

## Required modes

MVP:

- album ring
- radial bars
- waveform line

Implemented alongside the MVP modes:

- full-screen glowing objects

Planned:

- background pulse
- equalizer bars
- halo glow
- corner spectrum
- minimal pulse

## Customization

Support:

- enabled
- glowing objects enabled
- mode
- intensity (`0–6`, default `2.16`)
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
  edge is radius 50 for album ring, radial bars, and waveform line. The
  `album-ring` mode is a closed, sample-driven circular waveform with a small
  low-frequency lift; `radial-bars` and `waveform-line` retain their existing
  shapes for saved settings and explicit selection.
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
  bottom, and `album-ring` becomes a smaller closed circular waveform in that
  existing bottom region. Radial bars are
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
it may decay for about 450ms, and then its normalized state is reset to zero.
If the Wallpaper Engine callback stops, the performance-mode timeout injects a
zero frame instead of restarting idle animation.

The shaping order is safe input, fixed eligible volume gain, sensitivity and
band weighting, one Rust/WASM-or-fallback normalization pass, then rendered
intensity. Do not normalize each frame to its own peak because that would erase
absolute loudness. For Wallpaper Engine audio, normalized Spotify volume from
1 through 100 uses `100 / volume`, so attenuated input is referenced to volume
100. Zero, missing, non-finite, negative, and above-100 values use gain 1. The
fixed gain has no maximum. It changes visual input only and does not call
Spotify or PC volume controls. Mock and idle frames always use gain 1. A volume
change takes effect on the next audio callback; no unprocessed frame is stored
for immediate replay. Configured intensity remains the final display
multiplier.

Real audio is eligible only when the current direct/backend connection has
completed at least one successful poll, the playback source is `spotify`, the
item is a track or episode, and it is playing. A provider change clears the
successful-poll flag; a transient network, rate-limit, or unsupported-response
failure keeps its previous value and the last valid playback. Item-null,
no-active-device, unauthorized, forbidden, or a later successful paused,
stopped, or missing-item result disables real audio. Ineligible real audio is replaced by the idle visualizer
frame, but that idle frame never drives album pulse, offset, or glowing-object
speed/brightness. Those motion values release to neutral over about 450ms.
After an optimistic Play control update, real audio stays ineligible until a
later successful playing poll confirms it.
Wallpaper Engine supplies the PC-wide mixed output, so other audible
applications in the mix receive the same virtual gain while Spotify is
eligible.
Audio callbacks are rendered as received; no additional polling or timer
throttling is introduced. Album ring, radial bars, and waveform line do not
rotate as a whole. In `around-album`, the visualizer cancels the album frame's
layout rotation while continuing to share its translation, scale, size,
transitions, and visibility. Position-specific geometry and anchoring are owned
by the web view. The runtime also publishes a separate `VisualizerMotionState`
for the album and glowing-object layers, even when the SVG visualizer is
disabled.

## Response and effects

The view applies a presentation-only response curve after runtime noise gating
and normalization:

```text
response = min(1.35, pow(clamp(sample, 0, 1), 0.72) * responseGain)
```

`responseGain` is `0.90` in `low-power`, `1.15` in `standard`, and `1.35` in
`high-effect`. The final `intensity` setting still scales the rendered output
only. The sample-derived outward extension, bottom bar height, and waveform
amplitude are three times their previous values in all three modes and both
positions. Standard and high-effect modes add thin glow layers: the album ring
pulses in thickness and opacity, while radial bars and both waveform views
receive a back-glow. Low-power keeps the main geometry but omits these extra
layers. The separate motion state uses the weighted shaped impact
continuously; it is not gated at a visible threshold. `stretchLevel` maps to
album scale `1.0..1.54`, particle speed `1.0..2.0`, and particle brightness
`1.0..1.6`. Low-frequency impact also moves the album content along a stable
outward vector, capped at 8px. Around-album SVG geometry stays circular while
extending outside the album frame and is clipped only by the wallpaper
viewport; bottom-up geometry remains clipped to its panel. Silence releases
all values toward neutral over about 450ms.

## Glowing objects

The glowing-object layer is one full-screen Canvas with no per-particle DOM
nodes. Particles spawn inside a small disk near the viewport center, travel in
a random outward direction, and are removed when they leave the viewport or
reach their lifetime. Each object draws as a small theme-colored light with a
short trail. Spawn timing has jitter, while audio changes speed and brightness
only and does not change the spawn rate. The layer uses a dedicated seeded
pseudo-random sequence so the particle model can be tested reproducibly.

In `theme` color mode, the runtime extracts a quantized dominant color from the
album image when that image changes. It is used only by the SVG visualizer
geometries and glowing objects, with white as the missing-image or
extraction-failure fallback. Both SVG color and Canvas particle color
transition over about 450ms; text, background, and the persisted theme object
are not replaced by this visualizer-only color.

`glowingObjectsEnabled` stops the Canvas animation loop and clears all active
particles immediately. It is independent of album-art visibility and SVG
visualizer visibility. The album image and around-album SVG visualizer share an
inner reactive layer for audio scale and capped outward movement. Playback
progress is rendered only as the straight seekbar; the visualizer's
`album-ring` mode remains available independently.

## Performance

Low-power mode reduces samples, particle density, Canvas resolution, blur, and
particle glow. Its automatic particle count is 24. Standard uses 48 particles
and restrained glow; high-effect uses 96 particles and the strongest glow.
Particle life defaults to 3.5 seconds. The Canvas uses `requestAnimationFrame`
only while enabled for particle movement; Spotify APIs, audio acquisition, and
album color extraction are never called per frame. No continuous SVG decoration
timer is used; SVG effects change only when a visualizer frame changes.
