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
- fewer particles
- reduced blur
- slower idle animation
- reduced draw frequency where acceptable

Standard:

- balanced visual quality
- target smooth display

High-effect:

- richer effects allowed
- must still be user-configurable

## Required optimizations

- Color extraction only on album/image change.
- Clock update based on display granularity.
- API polling based on playback/error state.
- Public-backend polling defaults to about 2 seconds playing and 5 seconds paused.
- Access-token refresh is single-flight per credential.
- Spotify `Retry-After` is enforced by the backend before another Spotify request.
- Visualizer normalization before drawing.
- Avoid unnecessary state updates.

## Debug metrics

Debug overlay should eventually show FPS estimate, active performance mode, polling interval, visualizer source, and last API status.
