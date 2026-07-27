# docs README

This directory splits the project specification into small files so Codex and SubAgents do not miss middle sections of a large prompt.

## Entry documents

- `00-codex-entrypoint.md`: how Codex should start.
- `01-project-goals-and-non-goals.md`: product scope and forbidden scope.
- `02-repository-structure.md`: expected monorepo layout and ownership.
- `03-implementation-phases.md`: required implementation order.
- `04-quality-gates.md`: completion criteria and review gates.
- `05-repository-authority.md`: tracked specification authority, ignored
  artifact ownership, generated-source exceptions, and migration safeguards.

## Domain documents

- `10-spotify-integration.md`: OAuth, token refresh, polling, playback operations.
- `11-wallpaper-engine.md`: Wallpaper Engine properties, audio listener, browser mock mode.
- `12-rust-wasm-core.md`: Rust/WASM responsibilities and tests.
- `13-settings-schema.md`: versioned settings, defaults, migrations.
- `14-ui-layout.md`: coordinate-based layout, layers, presets.
- `15-background-theme.md`: album background, theme generation, readability.
- `16-visualizer.md`: audio visualizer modes and customization.
- `17-lyrics.md`: deferred Lyrics/LRC scope and reintroduction requirements.
- `18-transitions.md`: track-change transition model.
- `19-player-clock.md`: player UI, controls, seekbar, clock.
- `20-tauri-configurator.md`: optional desktop configurator.
- `21-rainmeter.md`: optional Rainmeter export.
- `22-performance.md`: performance rules.
- `23-test-qa.md`: tests, mocks, manual QA.
- `24-docs-and-reporting.md`: documentation and phase reports.
- `25-public-backend.md`: optional Cloudflare Worker backend, OAuth, pairing, storage, API, and operations.
- `30-subagent-matrix.md`: SubAgent ownership and handoff rules.

## Release and QA documents

- `user-guide.md`: setup, Spotify, Wallpaper Engine, configurator, settings, Rainmeter, and troubleshooting.
- `qa-checklist.md`: automated and manual QA checklist for release/regression verification.
- `privacy.md`: public backend beta data handling, cookie, retention, and
  contact requirements.
- `eula.md`: repository copy of the public backend beta EULA served at
  `/terms`.
- `release-notes-public-backend-beta.md`: public backend beta status and
  release blockers.
- `release-notes-v0.0.1.md`: current milestone release notes, known gaps, and verification commands.

`post-v0.0.1-stabilization.md` is the current stabilization specification. The
same-named file under `phase-reports/` is historical execution evidence.

## Operations runbooks

- `how-to-use-h5i.md`: required safe command-capture workflow for
  resource-intensive verification.
- `operations/cloudflare-worker-deploy.md`: preview/production deployment.
- `operations/cloudflare-worker-key-rotation.md`: encryption and HMAC key
  rotation.
- `operations/cloudflare-worker-incident-response.md`: incident handling.
- `operations/cloudflare-worker-restore.md`: restore and recovery.

## Designs and implementation plans

- `superpowers/specs/2026-07-27-system-wide-refactoring-design.md`: approved
  normative design for the active repository-wide refactor.
- `superpowers/plans/README.md`: current and executed-plan index.
- `superpowers/plans/2026-07-27-system-wide-refactor-phase-0-repository-specification-truth.md`:
  current Phase 0 execution plan.
- `superpowers/plans/2026-07-18-cloudflare-worker-public-backend.md`: executed
  historical intent for the public-backend baseline.

## Phase reports

`phase-reports/README.md` catalogs implementation evidence. Phase reports
describe what was attempted or measured at that time; they are not current
normative behavior and are not a substitute for entry/domain specifications.

## Rule for agents

Never rely on a single long prompt. Read the relevant document before
implementing a feature. If a task touches multiple areas, read every touched
domain document. Treat Git-tracked state as clean-clone truth and follow
`05-repository-authority.md` when adding documents, ignores, generated sources,
or phase evidence.
