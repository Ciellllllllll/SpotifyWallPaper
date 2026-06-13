# Phase 10: Tauri Configurator

## Summary

Implemented the first optional configurator milestone: basic settings editing, mock layout preview, import/export of settings JSON, opt-in Refresh Token export, and a Tauri v2 shell scaffold.

## Changed files

- `README.md`
- `apps/configurator/package.json`
- `apps/configurator/src/App.svelte`
- `apps/configurator/src/settingsModel.ts`
- `apps/configurator/src/settingsModel.test.ts`
- `apps/configurator/src-tauri/Cargo.lock`
- `apps/configurator/src-tauri/Cargo.toml`
- `apps/configurator/src-tauri/build.rs`
- `apps/configurator/src-tauri/icons/icon.ico`
- `apps/configurator/src-tauri/src/main.rs`
- `apps/configurator/src-tauri/tauri.conf.json`
- `apps/configurator/vite.config.ts`
- `package-lock.json`
- `docs/phase-reports/phase-10-tauri-configurator.md`

## Docs read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/10-spotify-integration.md`
- `docs/13-settings-schema.md`
- `docs/20-tauri-configurator.md`
- `docs/22-performance.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`

## Implemented requirements

- Configurator remains optional and is isolated under `apps/configurator`.
- Wallpaper app and Wallpaper Engine runtime do not import or require Tauri.
- Added editable controls for Spotify Client ID, optional Refresh Token export, preset, performance, background, theme, player controls, visualizer, lyrics, transitions, clock, and debug.
- Generated settings JSON includes all required top-level settings categories.
- Refresh Token is excluded from generated JSON by default.
- Refresh Token is included only when the user explicitly enables token export.
- Import can load generated settings JSON back into the draft model.
- Malformed import JSON falls back safely without echoing token-like input in warnings.
- Added mock preview in the configurator for the selected layout profile.
- Added Tauri v2 scaffold with a minimal Rust command for JSON validation.
- README documents browser and Tauri configurator startup plus token export behavior.

## Deviations from spec

- Spotify OAuth PKCE and Refresh Token acquisition assistance are not implemented in this first configurator milestone.
- Layout editor is preset-based and not a drag editor.
- Debug log viewer is not implemented yet.
- Rainmeter output settings are not implemented until the Rainmeter phase.

## Tests run

- `npm run test -w @spotify-wallpaper/configurator` passed: 1 file, 7 tests.
- `npm run check -w @spotify-wallpaper/configurator` passed with 0 warnings.
- `npm test` passed: configurator 1 file / 7 tests, wallpaper 17 files / 61 tests.
- `npm run check` passed with 0 warnings.
- `npm run build` passed.
- `cargo check --workspace` passed.
- `cargo check --manifest-path apps/configurator/src-tauri/Cargo.toml` passed.
- `cargo test --workspace` passed.
- `npm audit --audit-level=moderate` passed with 0 vulnerabilities.
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/` returned HTTP 200 for the wallpaper browser mock.
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:1420/` returned HTTP 200 for the configurator browser preview.
- Browser plugin visual QA was attempted, but the Node REPL browser bridge failed before startup because the local kernel is treated as ESM and calls CommonJS `require`.

## Known gaps

- No live Tauri window manual QA yet.
- No native file save/open dialogs yet; JSON is copied and pasted.
- No OAuth callback or PKCE helper yet.

## Risks

- Tauri dependencies are new and may increase optional configurator build time, but they are not part of the wallpaper runtime.
- The preview is a lightweight mock and does not render the full wallpaper app.

## Next tasks

- Start Phase 11: optional Rainmeter JSON export that can fail without affecting the wallpaper.

## SpecGuard review

- Initial review blocked completion because imported Refresh Tokens could be re-exported without a fresh opt-in and imported enum-like settings were not runtime-validated before export.
- Fixed import behavior so Refresh Tokens are retained in the draft but `includeRefreshToken` is reset to false, and unsupported imported enum values fall back to defaults.
- Added regression tests for imported token opt-in and unsupported enum defaults.
- Follow-up review still blocked completion because imported string and boolean primitive types were not runtime-validated before export.
- Fixed imported `clientId`, `refreshToken`, and boolean settings to fall back safely when their JSON types are invalid.
- Added a regression test for unsupported imported primitive types.
- SpecGuard also noted this phase report is ignored by `.gitignore`; it must be force-added before commit, matching prior phase-report handling.
- Final follow-up review passed with no remaining hard-rule, token leakage, Tauri optionality, settings import safety, or browser mock preservation blockers.
