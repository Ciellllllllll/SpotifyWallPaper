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
- public-backend setup, reauthorization, and disconnect guide

## Required developer docs

- architecture overview
- module boundaries
- settings schema versioning
- Spotify integration notes
- WASM core notes
- phase reports
- Cloudflare deployment, key rotation, incident, cost, and restore runbooks

## Phase report template

Each report must include exactly these fields:

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

## Documentation rule

If implementation behavior changes, docs must be updated in the same phase. Do
not leave docs inconsistent with behavior.

All Markdown beneath `docs/` is tracked repository material and must be
classified by `config/repository-authority.json`. Phase reports and executed
plans are historical evidence: preserve their original narrative, but use
current entry/domain specifications for normative behavior. Ownership changes
to documents, ignore rules, or generated sources require policy, tests,
documentation, and review in the same commit.
