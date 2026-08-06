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

## Reduce motion

When reduce motion is enabled, aggressive effects should resolve to fade/crossfade behavior.
