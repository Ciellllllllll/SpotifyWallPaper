# Quality Gates

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
