# Codex Entrypoint

## Current instruction

Work on the existing Spotify-linked Wallpaper Engine product according to the
tracked repository authority. Do not assume the repository is an empty
scaffold, and do not treat any single document as complete by itself.
`AGENTS.md`, `config/repository-authority.json`, and this file define the start
procedure.

## First actions

1. Read `AGENTS.md`.
2. Read `docs/README.md`.
3. Read `docs/01-project-goals-and-non-goals.md`.
4. Read `docs/04-quality-gates.md`.
5. Read `docs/05-repository-authority.md`.
6. Select the domain docs for the current task.
7. For architecture or cross-cutting work, also read
   `docs/02-repository-structure.md`, `docs/03-implementation-phases.md`,
   `docs/30-subagent-matrix.md`, and the approved system-wide refactor design.
8. For public-backend work, also read `docs/25-public-backend.md`.
9. For the active system-wide refactor, read
   `docs/superpowers/specs/2026-08-04-system-wide-refactoring-structure-first.md`
   and `docs/superpowers/plans/2026-08-04-system-wide-refactor-ponytail.md`.

## Current phase selection

Inspect the current branch, tracked specifications, phase reports, and tests
before choosing work. The active 2026-08-04 structure-first authority owns the
refactor sequence. The 2026-07-27 design is historical evidence.
`docs/03-implementation-phases.md` remains the normative product-capability
construction order for new capability work.

The product already has a browser-previewable mock wallpaper. Every phase must
preserve a credential-free mock path. `album-details` mode shows the full
characterization set:

- album background placeholder
- album jacket
- track title
- artist names
- progress display
- clock
- debug overlay toggle placeholder

`album-only` is intentionally narrower: it shows the background, album art,
visualizer/seekbar, and debug/transition state while hiding track text,
controls, volume, and clock according to the explicit display-mode contract.
Phase 1 golden fixtures cover both modes so this distinction is not inferred
from component CSS.

This keeps UI, layout, theme, and Wallpaper Engine behavior verifiable without
live Spotify access.

## Do not start with

- Rainmeter integration
- complex visualizer particles
- external lyrics APIs
- advanced transition effects
- native wallpaper rendering outside Wallpaper Engine
- full settings app before wallpaper MVP exists

## Definition of a valid phase report

Each phase report must include: Phase name, Summary, Changed files, Relevant
docs read, Implemented requirements, Known gaps, Tests run, Risks introduced,
Review outcome, Fixes from review, Verification commands, and Next recommended
task. A missing or incomplete report means the phase is incomplete.
