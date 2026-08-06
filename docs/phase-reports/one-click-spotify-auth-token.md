# One-click Spotify Auth Token

## Summary

Implemented a one-paste Spotify authorization flow. The static auth page now emits a `swpt1.` Wallpaper Engine Token that bundles the public Spotify Client ID and Refresh Token after PKCE authorization. The Wallpaper Engine adapter accepts that value in the existing `spotify_refresh_token` property and applies both Spotify credentials automatically.

## Changed files

- `apps/spotify-auth/src/auth.ts`
- `apps/spotify-auth/src/auth.test.ts`
- `apps/spotify-auth/src/main.ts`
- `apps/spotify-auth/src/style.css`
- `apps/wallpaper/src/spotify/wallpaperEngineToken.ts`
- `apps/wallpaper/src/spotify/wallpaperEngineToken.test.ts`
- `apps/wallpaper/src/wallpaperEngine/properties.ts`
- `apps/wallpaper/src/wallpaperEngine/properties.test.ts`
- `apps/wallpaper/public/project.json`
- `README.md`
- `docs/user-guide.md`
- `docs/qa-checklist.md`
- `docs/release-notes-v0.0.1.md`
- `docs/phase-reports/one-click-spotify-auth-token.md`

## Docs read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/10-spotify-integration.md`
- `docs/11-wallpaper-engine.md`
- `docs/13-settings-schema.md`
- `docs/20-tauri-configurator.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`
- `docs/how-to-use-h5i.md`

## Implemented requirements

- Auth page supports no-typing authorization when `VITE_SPOTIFY_CLIENT_ID` / repository variable `SPOTIFY_CLIENT_ID` is configured.
- Auth page generates one copyable Wallpaper Engine Token instead of requiring users to separately paste Client ID and Refresh Token.
- Wallpaper Engine property adapter decodes `swpt1.` tokens from the existing token field.
- Raw Refresh Token input remains supported for manual and local testing.
- Malformed `swpt1.` values are rejected safely and are not treated as raw Refresh Tokens.
- Wallpaper Engine property label now communicates that the field accepts Spotify Token / Refresh Token.
- Docs explain the new one-paste setup and the public Client ID configuration requirement.

## Deviations from spec

- No Client Secret was added. The token bundle is not encrypted; it is a convenience encoding around credential material and must be handled with the same secrecy as a Refresh Token.
- Real Spotify login cannot be completed in automated QA without a user account session and a Spotify app whose redirect URI is registered.

## Tests run

- Pending at report creation; see final task response for executed commands.

## Known gaps

- Public GitHub Pages one-click behavior depends on the repository variable `SPOTIFY_CLIENT_ID` being configured and the matching redirect URI being registered in the Spotify Developer Dashboard.
- The current Wallpaper Engine property key remains `spotify_refresh_token` for backward compatibility, though its label now says Spotify Token / Refresh Token.

## Risks

- Users can still expose the generated `swpt1.` token in screenshots because Wallpaper Engine text inputs are visible. Docs and QA notes continue to warn against credential screenshots.
- If the auth page is built without `VITE_SPOTIFY_CLIENT_ID`, users still need to enter a public Client ID or pass one through the URL for development use.

## SpecGuard review

- Scope: limited to Spotify PKCE auth assistance, Wallpaper Engine property parsing, tests, and docs.
- Secrets: no Client Secret added; token bundle values are not logged; malformed token handling does not include credential values in warnings.
- Performance: no polling, per-frame work, color extraction, or render-loop behavior changed.
- Settings safety: malformed token bundle is rejected without crashing; existing raw Refresh Token path remains backward compatible.
- Mock support: browser mock mode and default settings remain unchanged.

## Next tasks

- Configure `SPOTIFY_CLIENT_ID` in the GitHub repository settings before deploying the public auth page.
- Run real-account QA locally without recording token values, authorization codes, or callback URLs.
