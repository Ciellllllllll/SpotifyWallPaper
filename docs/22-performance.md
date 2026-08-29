# Performance

## Goal

The wallpaper is always running, so stable low overhead is more important than maximum visual complexity.

## Rules

Do not call Spotify APIs every frame.
Do not process album images every frame.
Do not recreate large canvas resources unnecessarily.
Do not update DOM text every frame unless the value changes.
Do not run high-particle effects in low-power mode.

## Performance modes

Low-power:

- lower visualizer sample count
- 24 automatic particles
- reduced blur
- 1× logical Canvas pixel ratio and no particle shadow blur
- slower idle animation
- reduced draw frequency where acceptable

Standard:

- balanced visual quality
- 48 automatic particles with restrained glow
- target smooth display

High-effect:

- richer effects allowed
- 96 automatic particles with stronger glow
- must still be user-configurable

## Required optimizations

- Color extraction only on album/image change.
- Clock update based on display granularity.
- API polling based on playback/error state.
- Public-backend polling defaults to about 2 seconds playing and 5 seconds paused.
- Access-token refresh is single-flight per credential.
- Spotify `Retry-After` is enforced by the backend before another Spotify request.
- Visualizer normalization before drawing.
- Glowing objects use one full-screen Canvas and one animation frame loop only
  while enabled; individual particles are not DOM elements.
- Particle count is independent of audio volume. Audio only changes the
  particle speed multiplier, which is capped at 2.0 and eases back over about
  450ms.
- Standard uses particle glow strength 1.0 and high-effect uses 1.35; low-power
  uses 0 and disables particle shadow blur.
- Particle lifetime defaults to 3.5 seconds. A dedicated pseudo-random sequence
  supplies spawn jitter and is isolated from audio and API timing.
- Avoid unnecessary state updates.

## Debug metrics

Debug overlay should eventually show FPS estimate, active performance mode, polling interval, visualizer source, and last API status.
