# Background and Theme

## Responsibilities

This domain owns album artwork background, color extraction, theme generation, readability correction, and fallback visuals.

## Background modes

Required MVP modes:

- album blur
- gradient from album
- solid color

Planned modes:

- cover fit
- cover fill
- radial glow
- custom image
- idle background
- dynamic mesh gradient

## Theme values

Generate or store:

- primary color
- secondary color
- accent color
- muted color
- dark color
- light color
- readable text color
- overlay opacity recommendation
- shadow strength recommendation

## Update timing

Theme and color extraction run on album/image change, not every frame.

## Failure handling

If image loading or extraction fails, generate a deterministic fallback theme from item id or album id. Never block rendering.

## Readability

Support automatic readability correction:

- dark overlay
- blur strength
- text shadow
- text stroke or outline
- glass panel
- contrast-based text color

User can disable or adjust automatic correction.
