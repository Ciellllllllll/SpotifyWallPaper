# Public Backend Beta Release Notes

## Status

The optional Cloudflare Worker backend and Wallpaper integration are
implemented for private staging and limited-beta preparation. General
Wallpaper Engine Workshop publication is not approved. Spotify-connected
Limited beta distribution is also blocked by the external policy, legal,
infrastructure, and operations gates below; local/mock-only staging remains
permitted.

## Added

- BYO Spotify Client ID authorization with Authorization Code and PKCE.
- One-time `swpb1.` Pairing Token issuance without exposing Spotify tokens to
  the wallpaper.
- Encrypted D1 credential storage, Access Token refresh, Spotify 429 backoff,
  reauthorization, controls, and account deletion.
- Pre-authorization Privacy/EULA consent pages and Development Mode
  restrictions on `/setup`.
- Row-isolated deletion reconciliation with retry/backlog aggregate metrics.
- Direct, loopback Rust, public Worker, and mock provider compatibility.
- Separate preview and production deployment inventories, rate limits,
  aggregate metrics, CI, secret scanning, and operations runbooks.

## User Setup

Each beta user creates a Spotify Developer application, registers the exact
production callback URI, opens the backend `/setup` page, authorizes Spotify,
and pastes the one-time-displayed Pairing Token into Wallpaper Engine. The
Pairing Token remains reusable until deletion or revocation and must not be
shared or placed in URLs, screenshots, logs, or support messages.

Spotify Development Mode currently requires a Premium app owner, permits one
Client ID per new developer and up to five allowlisted authenticated users per
app, and is not a scalable public managed-app path. Existing resources may be
grandfathered. Playback controls can additionally depend on Premium and device
restrictions.

## Reauthorization And Deletion

Authorization is treated as expiring six months after the original
authorization. The wallpaper preserves its last safe display and reports
authorization required. Reauthorization from `/setup` retains the same Pairing
Token.

Account deletion invalidates the Pairing Token and removes live credential
data. A non-secret deletion tombstone remains for 35 days for restore safety.
Users should also disconnect the application from Spotify account settings.

## Legacy Compatibility

Direct mode and `swpt1.` tokens remain available for developer and compatibility
testing. The static authorization helper is local developer-only legacy
infrastructure. Its manual workflow checks/builds but no longer deploys to
GitHub Pages.

## Known External Gates

- Spotify approval or a documented policy-compatible redesign covering BYO
  authorization, sound-recording/visual synchronization, product naming, and
  Spotify Mark usage.
- Original unmodified artwork with no crop, blur, animation, distortion, or
  overlay, plus required Spotify logo attribution and Spotify link.
- Published privacy notice with real operator and incident contacts.
- Published operator-reviewed EULA and verified pre-authorization consent.
- Fixed production custom domain and exact registered callback.
- Non-budget operational alert configuration and delivery tests.
- Spotify-connected Limited beta completion.
- 72-hour Wallpaper Engine soak completion.
- Verified cost, abuse, reconciliation, and incident alerts.

Until the policy/legal/infrastructure/alert gates are evidenced in the phase
report, the build must not be distributed to Spotify-connected Limited beta
users. General publication additionally requires the completed Limited beta
and 72-hour soak.
