# Quality Gates

## Work classes

Classify the change before editing:

- **Small isolated change:** changes at most three tracked files; all changed
  files are inside one existing `apps/<name>/`, `packages/<name>/`,
  `crates/<name>/`, `scripts/`, or `tests/` boundary, or the change is one
  `docs/<file>` or one root file; and it changes no credential,
  authentication, security-sensitive, external contract, settings schema, architecture,
  dependency, CI, repository policy, Phase, or release behavior.
- **Normal change:** behavior or documentation changes that may cross existing
  implementation boundaries but do not touch the strict triggers below. Every
  change that is neither small nor strict is normal.
- **Strict-gated change:** security-sensitive, authentication, secrets, public
  backend, Tauri, settings schema or migrations, external contracts,
  dependencies, architecture, cross-cutting behavior, documentation authority,
  CI or repository policy, Phase/release work, or an explicitly requested full
  review. A task assigned to a Phase or release is strict even when its file
  count fits the small boundary.

When uncertain, use the stricter class. Security and hard-rule checks apply to
all classes.

## Review gate

Small isolated changes use focused local verification and do not require a
read-only reviewer, SpecGuard, or SubAgent by default. Normal changes use
focused self-review and relevant tests; an independent reviewer is added only
when risk or uncertainty justifies it.

Strict-gated changes use the full procedure in `AGENTS.md`: targeted
verification, a read-only Sol review, a SpecGuard review, and the relevant
independent role reviews below. A Security Reviewer is mandatory when the
strict trigger involves credentials, authentication, public backend, OAuth,
cryptography, logging, redirects, or Tauri. An Architecture Agent is mandatory
for architecture or cross-cutting changes. Fixes and re-review continue until
explicit `PASS`, followed by the Ponytail full audit on the same diff.
`Lean already. Ship.` is the only accepted `PONYTAIL PASS`. A finding or
changed diff returns to Sol review. Commit only after the required gates are
consecutive, then verify the committed HEAD and a clean worktree.

## Strict Ponytail baseline

For strict-gated work, confirm and freeze the latest stable Ponytail baseline:

1. Run `codex plugin marketplace list --json`.
2. Refresh with `codex plugin marketplace upgrade ponytail --json`.
3. Cross-check the Git source and revision in
   `.codex-marketplace-install.json`, the marketplace snapshot, the installed
   `.codex-plugin/plugin.json` and `package.json`, and
   `codex plugin list --available --json --marketplace ponytail`.
4. If the advertised stable differs, stop and resolve the update with
   `codex plugin add ponytail@ponytail --json`; do not use a prerelease,
   source mismatch, or unknown compatibility.
5. Record source, revision, version, verification time, hooks, mode, and audit
   result in `.codex/reports`. If an update occurred, restart Codex Desktop
   and verify the new session before continuing.

## Required for every phase

- Build passes.
- Relevant tests pass.
- Formatting or linting passes if configured.
- Browser mock mode still works.
- No secret appears in logs.
- No new required dependency on Tauri for wallpaper runtime.
- No API polling loop can run every frame.
- No unhandled settings corruption path.
- Phase report is written.
- Optional public-backend failures do not prevent wallpaper startup.

## Security gate

The implementation must never print or persist secrets unintentionally. The following are considered secrets:

- Spotify Refresh Token
- Spotify Access Token
- OAuth authorization code
- full OAuth callback URL containing sensitive parameters
- any future API key
- public-backend Pairing Token
- OAuth state and PKCE verifier
- Worker encryption and Pairing HMAC keys

Debug display may show whether a token exists and token expiry time, but not the token value.

For the public Worker:

- Cloudflare invocation logs must be disabled.
- OAuth and setup pages use no-store, no-referrer, and restrictive CSP headers.
- Refresh and Access Tokens are encrypted before D1 storage.
- Pairing secrets are stored only as keyed HMAC digests.
- Arbitrary HTTPS origins and redirects never receive Pairing Tokens.
- Account deletion invalidates the Pairing Token before returning success.

## Stability gate

The wallpaper must start even if:

- Spotify settings are missing.
- Refresh token is invalid.
- Spotify API is offline.
- item is null.
- album image is missing.
- settings JSON is malformed.
- Wallpaper Engine audio listener is unavailable.
- public backend or D1 is unavailable.
- Spotify Refresh Token requires reauthorization.

## Performance gate

The implementation must not:

- call Spotify APIs per frame
- extract album colors per frame
- recreate large canvases unnecessarily
- update clock every frame
- run heavy visual effects in low-power mode

## SpecGuard gate

Before each phase is complete, SpecGuard must verify that the work matches relevant docs and does not violate `AGENTS.md` hard rules.

For non-Phase work, SpecGuard is required only for strict-gated or explicitly
requested reviews. Small isolated changes use the local security, stability,
performance, and mock-path checks relevant to the touched files.

## Reporting gate

Phase, release, and strict-gated work use the full report format from the
entrypoint documents. The full report contains exactly:

- Phase name (or the strict-gated work item name when the work is not part of a Phase)
- Summary
- Changed files
- Relevant docs read
- Implemented requirements
- Known gaps
- Tests run
- Risks introduced
- Review outcome, including work class, required/completed/omitted gates, and
  the frozen Ponytail baseline when applicable
- Fixes from review
- Verification commands
- Next recommended task

Small and normal tasks outside a Phase use a compact report containing the work class,
summary, changed files, verification, known risks, intentionally omitted
gates, and next task.
