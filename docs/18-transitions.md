# Transitions

## Responsibilities

This domain owns track-change detection, previous/current state retention, animation presets, and reduce-motion behavior.

## Track change detection

A change in track id or episode id starts a transition.

The previous display state must be retained until the transition finishes. Do not replace everything immediately.

If a new track arrives during a transition, cancel or restart safely with the latest previous/current pair.

## Required MVP transitions

- fade
- crossfade
- slide-left
- zoom-in
- blur-fade

Planned transitions:

- slide-up
- zoom-out
- glitch
- vinyl-spin
- liquid
- particle-burst
- wipe
- random-safe

## Settings

Support:

- preset
- duration
- easing
- background participation
- album participation
- text participation
- visualizer participation
- reduce motion

## Display mode changes

Switching between `album-only` and `album-details` animates the display
components independently. The album frame uses its layout transition while the
track panel enters with the `text-enter` animation. The album frame and seekbar
position transitions also run in reverse when details are hidden; the track
panel is removed after details are hidden. The current and previous track state
must remain safe while a track-change transition is active.

## Reduce motion

When `transitions.reduceMotion` is enabled, aggressive effects should resolve to
fade/crossfade behavior and display-mode animations and transitions must stop.
The same stop behavior applies when the user agent reports
`prefers-reduced-motion: reduce`.
