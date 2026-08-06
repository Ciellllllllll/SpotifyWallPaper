# Phase 1: Spotify MVP

## Summary

Implemented the Spotify MVP foundation for the wallpaper app: PKCE-compatible token refresh, current playback fetch, normalized display model, error classification, polling interval decisions, settings load fallback, and live/mock UI switching.

## Changed files

- `.gitignore`
- `README.md`
- `package.json`
- `package-lock.json`
- `packages/shared-types/src/index.ts`
- `apps/wallpaper/package.json`
- `apps/wallpaper/src/App.svelte`
- `apps/wallpaper/src/mock/mockPlayback.ts`
- `apps/wallpaper/src/settings/defaultSettings.ts`
- `apps/wallpaper/src/settings/loadSettings.ts`
- `apps/wallpaper/src/settings/loadSettings.test.ts`
- `apps/wallpaper/src/spotify/**`
- `apps/configurator/src/App.svelte`
- `tests/fixtures/playback/**`
- `tests/fixtures/spotify/**`
- `docs/phase-reports/phase-1-spotify-mvp.md`

## Docs read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/10-spotify-integration.md`
- `docs/11-wallpaper-engine.md`
- `docs/13-settings-schema.md`
- `docs/19-player-clock.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`

## Implemented requirements

- Token refresh uses public `client_id` and `refresh_token` only; no Client Secret is used.
- Access tokens are kept in memory only.
- Token values, refresh token values, authorization codes, and callback URLs are not logged.
- Current playback fetch uses Spotify `/v1/me/player`.
- Raw Spotify playback responses are normalized before UI use.
- Normalized playback covers track, episode, none, item URI, image URLs, duration, progress, play state, device state, shuffle, repeat, volume, external URL, and fetch timestamp.
- Null item normalizes to a safe `Nothing Playing` display model with an `item_null` warning.
- Missing artwork falls back to the local mock album placeholder.
- Error classification covers unauthorized, forbidden, rate limited, network error, unavailable/no active device, unknown response shape, and item null.
- Polling decisions use about 1 second for playing, about 3 seconds for paused/stopped, exponential backoff for errors, and `Retry-After` for rate limits.
- Browser mock mode remains the default when Spotify credentials are absent.
- Settings JSON fallback handles malformed data without crashing.
- Previous playback state is retained when the displayed item changes.

## Deviations from spec

- Phase 1 does not implement playback controls; controls are listed in the Spotify domain doc but are scheduled later by `docs/03-implementation-phases.md`.
- Wallpaper Engine property ingestion is not implemented yet; Phase 1 can load settings from `window.__SPOTIFY_WALLPAPER_SETTINGS__` or explicit local browser `localStorage` JSON for MVP testing. Wallpaper Engine property adapter starts in Phase 2.
- Full settings schema migration and validation is not implemented yet; Phase 1 only clamps polling decisions and falls back from malformed settings JSON.

## Tests run

- `npm test` passed: 5 files, 15 tests.
- `npm run check` passed.
- `npm run build` passed.
- `cargo check --workspace` passed.
- `cargo test --workspace` passed.
- `npm audit` passed with 0 vulnerabilities.
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/` returned HTTP 200 from the wallpaper dev server.
- Chrome headless screenshot verification confirmed browser mock still renders album placeholder, album art, track title, artists, progress display, clock, and debug toggle.

## Known gaps

- No Wallpaper Engine property adapter yet.
- No OAuth PKCE acquisition UI yet; configurator support starts later.
- No playback controls yet.
- No full settings schema migration/validation yet.
- No real Spotify credential was used in this phase verification, so live Spotify display is covered by unit-tested fetch/normalization paths rather than an end-to-end account test.

## Risks

- Local browser `localStorage` testing can persist a refresh token if the developer explicitly stores one. README documents how to clear it and warns not to put tokens in URLs, logs, screenshots, or committed files.
- First live Spotify failures keep the current safe display while reporting a classified error in debug/status text; a dedicated stopped/error visual state can be improved later.

## Next tasks

- Start Phase 2: Wallpaper Engine property adapter, audio listener adapter, and browser fallback wiring.

## SpecGuard review

- SpecGuard reviewed Phase 1 for phase order, secrets handling, polling cadence, rate-limit behavior, stability paths, mock/browser preview, Tauri optionality, and report completeness.
- Required fix: update stale README text that still described live polling as a later phase.
- Status: fixed in this phase.
