# Docs and Reporting

## Required user docs

- README setup guide
- Spotify Developer setup guide
- Wallpaper Engine import guide
- Configurator guide
- Settings reference
- Rainmeter integration guide
- Troubleshooting guide
- privacy and data-deletion policy
- static Pages setup, reauthorization, local credential deletion, and disconnect guide
- retired infrastructure status, clearly separated from standard setup

## Required developer docs

- architecture overview
- module boundaries
- settings schema versioning
- Spotify integration notes
- WASM core notes
- phase reports
- Historical backend runbooks are archived evidence, not active procedures.

## Phase report template

Each Phase report must include exactly these fields:

- Phase name
- Summary
- Changed files
- Relevant docs read
- Implemented requirements
- Known gaps
- Tests run
- Risks introduced
- Review outcome
- Fixes from review
- Verification commands
- Next recommended task

Do not add report fields for Ponytail. Record the plan's frozen marketplace
source, snapshot revision, exact version, verification time, hooks, mode, and
audit result under `Review outcome`.

Release and strict-gated non-Phase work use the same fields; use the work item
name in `Phase name`. Small and normal tasks outside a Phase use the compact
report described in `AGENTS.md` and `docs/04-quality-gates.md` instead of
creating a Phase report. Any task assigned to a Phase uses the full Phase
report.

## Documentation rule

If implementation behavior changes, docs must be updated in the same phase. Do
not leave docs inconsistent with behavior.

All Markdown beneath `docs/` is tracked repository material and must be
classified by `config/repository-authority.json`. Phase reports and executed
plans are historical evidence: preserve their original narrative, but use
current entry/domain specifications for normative behavior. Ownership changes
to documents, ignore rules, or generated sources require policy, tests,
documentation, and review in the same commit.
