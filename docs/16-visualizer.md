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
- rotation speed
- particle count
- particle life
- glow strength
- color mode
- mirror mode
- clamp max
- noise gate
- idle animation

Simple settings UI should expose only mode, intensity, and sensitivity first. Advanced UI may expose all parameters.

## Data source

Use Wallpaper Engine audio data if available. Use mock audio in browser preview. Use idle animation if no audio data is available.

## Performance

Low-power mode must reduce samples, particles, blur, and draw frequency. Standard mode should be stable. High-effect mode may use heavier visuals but must be configurable.
