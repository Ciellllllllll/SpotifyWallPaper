# UI Layout

## Responsibilities

This domain owns coordinate-based placement, layout items, layers, responsiveness, presets, and visible UI composition.

## LayoutItem requirements

Each movable part should be represented as a layout item with:

- enabled
- x
- y
- unit
- anchor
- width
- height
- scale
- rotation
- opacity
- zIndex
- responsive behavior
- safe area margin
- locked flag
- participates in transition flag

## Units

Support percent-based positioning as the recommended mode. Pixel and viewport-relative modes may be supported if useful.

## Anchors

Support:

- top-left
- top-center
- top-right
- center-left
- center
- center-right
- bottom-left
- bottom-center
- bottom-right

## Layers

Recommended layers:

- background
- album art
- visualizer
- track text
- seekbar
- controls
- clock
- overlays/debug

## Required presets

- Minimal
- Center Album
- Visualizer Heavy
- Rainmeter Hybrid
- Left Dock
- Bottom Player
- Clock Focus
- Album Ring
- Ambient Background

## Responsiveness

Extreme aspect ratios and resolution changes must not break layout. Items may clamp into safe area when configured.
