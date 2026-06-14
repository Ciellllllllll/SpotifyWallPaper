# docs README

This directory splits the project specification into small files so Codex and SubAgents do not miss middle sections of a large prompt.

## Entry documents

- `00-codex-entrypoint.md`: how Codex should start.
- `01-project-goals-and-non-goals.md`: product scope and forbidden scope.
- `02-repository-structure.md`: expected monorepo layout and ownership.
- `03-implementation-phases.md`: required implementation order.
- `04-quality-gates.md`: completion criteria and review gates.

## Domain documents

- `10-spotify-integration.md`: OAuth, token refresh, polling, playback operations.
- `11-wallpaper-engine.md`: Wallpaper Engine properties, audio listener, browser mock mode.
- `12-rust-wasm-core.md`: Rust/WASM responsibilities and tests.
- `13-settings-schema.md`: versioned settings, defaults, migrations.
- `14-ui-layout.md`: coordinate-based layout, layers, presets.
- `15-background-theme.md`: album background, theme generation, readability.
- `16-visualizer.md`: audio visualizer modes and customization.
- `17-lyrics.md`: LRC lyrics support and future provider interface.
- `18-transitions.md`: track-change transition model.
- `19-player-clock.md`: player UI, controls, seekbar, clock.
- `20-tauri-configurator.md`: optional desktop configurator.
- `21-rainmeter.md`: optional Rainmeter export.
- `22-performance.md`: performance rules.
- `23-test-qa.md`: tests, mocks, manual QA.
- `24-docs-and-reporting.md`: documentation and phase reports.
- `30-subagent-matrix.md`: SubAgent ownership and handoff rules.

## Release and QA documents

- `user-guide.md`: setup, Spotify, Wallpaper Engine, configurator, settings, lyrics, Rainmeter, and troubleshooting.
- `qa-checklist.md`: automated and manual QA checklist for release/regression verification.
- `release-notes-v0.0.1.md`: current milestone release notes, known gaps, and verification commands.

## Rule for agents

Never rely on a single long prompt. Read the relevant document before implementing a feature. If a task touches multiple areas, read every touched domain document.
