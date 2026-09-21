# Spotify Wallpaper EULA Draft

## Standard direct configuration

Static GitHub Pages authorization and Wallpaper Engine direct Spotify access
are the standard setup. Users supply their own Client ID, keep authorization
data confidential, and comply with Spotify account, Development Mode, quota,
content-display, and synchronization policies. Removing operator infrastructure
cost does not remove Spotify Premium, Wallpaper Engine, or GitHub restrictions.
Token refresh does not extend Spotify's original authorization lifetime or
guarantee uninterrupted service. Base64-encoded authorization data is not
encrypted; local credential storage has the limitations in `privacy.md`.

This remains a draft requiring operator identity, effective date, applicable
legal terms, and privacy contact before release. Implementing a Pages workflow
does not approve publication or establish acceptance of these terms. The
Spotify minimum terms below apply to the application; the retained backend
status and consent paragraphs concern only the optional legacy service.

## Status

This is the repository copy of the EULA served at `/terms` by the Node.js VPS
backend. It is not a substitute for operator legal review. Production is
`SPOTIFY_MODE=policy_locked` and cannot accept Spotify authorization,
reauthorization, playback/control, deletion, or Pairing Token issuance. The
production operator, effective date, jurisdiction, contact details, and any
locally required consumer terms must be completed before a separately
approved Spotify-connected Limited beta.

If a future unlock is approved, authorization through the public backend must
require explicit acceptance of this EULA and acknowledgement of
`docs/privacy.md`. Synthetic acceptance tests do not create a user agreement
or authorize real Spotify traffic.

## Spotify Minimum Terms

- The operator makes no warranties on behalf of Spotify and disclaims
  applicable implied warranties concerning the Spotify Platform, Spotify
  Service, and Spotify Content, including merchantability, fitness for a
  particular purpose, and non-infringement.
- Users may not modify or create derivative works of the Spotify Platform,
  Spotify Service, or Spotify Content.
- Users may not decompile, reverse engineer, or disassemble the Spotify
  Platform, Spotify Service, or Spotify Content.
- The operator, not Spotify, is responsible for this application. Spotify has
  no liability for the application.
- Spotify is a third-party beneficiary of this EULA and may enforce these
  Spotify-specific terms directly.

## Application Terms

If the service is separately unlocked, users must keep Pairing Tokens
confidential, use their own authorized Spotify Developer application, comply
with Spotify account and Development Mode limits, and stop using the backend
when authorization is revoked. The service may remain locked or be suspended
for security, abuse prevention, maintenance, legal compliance, or upstream
availability.

The application is provided as a beta without an availability guarantee. The
production operator must publish any additional warranty, liability,
termination, governing-law, and consumer-rights terms required for the target
jurisdictions before accepting users.
