# Project Goals and Non-Goals

## Product goal

Create a highly customizable Wallpaper Engine Web Wallpaper that reacts to Spotify playback. When Spotify plays music, the wallpaper should automatically use the current album artwork as the visual basis for background, theme colors, album display, player metadata, seekbar, clock, and audio visualizer.

## Core requirements

- Spotify current playback integration.
- Optional public Spotify proxy for Workshop-compatible deployment.
- Album-art-based background.
- Theme generation from album artwork.
- Coordinate-based UI customization.
- Customizable visualizer around album art and/or background.
- Multiple track-change transitions.
- Built-in clock.
- Optional Rainmeter export.
- Optional Tauri configurator.
- Rust usage through WASM and Tauri backend.
- Browser mock mode for development.
- Wallpaper Engine Web Wallpaper output.

## Primary technical direction

Use Svelte + TypeScript + Vite for the Web Wallpaper frontend.
Use TypeScript as the settings and layout authority.
Use Rust/WASM only for typed-array visual normalization and readability logic.
Use Tauri for the optional configurator app.
Use a monorepo structure.

## Non-goals

Do not create a native desktop wallpaper renderer.
Do not make Tauri required for the wallpaper to run.
Do not store or process Spotify audio.
Do not bundle lyrics data.
Do not include Lyrics/LRC settings, layout items, Wallpaper Engine properties, or runtime parsing in the current v1 scope. Treat Lyrics/LRC as a future feature that requires a dedicated spec update before reintroduction.
Do not bypass Spotify API restrictions.
Do not require Spotify Premium for passive display features.
Do not require Spotify Premium except for playback control operations that Spotify itself restricts.
Do not make the approved Cloudflare backend mandatory for wallpaper startup. Browser mock, legacy direct, and local Rust backend paths remain supported.
Do not ship a shared Spotify Client ID or Client Secret before Spotify Extended Quota approval and a dedicated managed-app security review.

## Product priority

Priority order:

1. Stability as a constantly running wallpaper.
2. Safe handling of Spotify credentials.
3. Spotify API rate-limit avoidance.
4. Customization without settings corruption.
5. Good default appearance.
6. Visual richness.

Visual effects must not compromise stability or credential safety.

## Public distribution constraint

The initial public-backend implementation uses each user's own Spotify Client ID with Authorization Code + PKCE and no Client Secret. Spotify Development Mode currently requires the app owner to have Premium and limits the app to five authorized users. General Workshop publication is blocked until Spotify confirms that the BYO model and the wallpaper's artwork/visualizer behavior comply with current policy, or the product is changed to comply.
