# Privacy Notice For The Public Backend

## Status

This draft notice describes the approved optional Node.js/PostgreSQL VPS target
at
`https://ciel-spotify-wallpaper.duckdns.org`. Production runs only as
`SPOTIFY_MODE=policy_locked`. The service is not yet deployed or operator-
verified. Once deployed, it serves the public Privacy Notice, EULA, and
DB-independent health response, but every exact allowed Spotify route/method
returns a fixed no-store 503 before Node reads request or external state;
unrecognized methods and paths are rejected. It does not currently accept
Spotify authorization, issue Pairing Tokens, process playback/control traffic,
or delete an account.

The dormant hardened OAuth protocol is testable only with synthetic data in
an externally unreachable `synthetic_test` environment. This notice does not
authorize a Spotify-connected Limited beta or general Workshop release. The
operator identity, effective date, private privacy/incident contacts, and
jurisdictional review remain release blockers.

## Data processed

In production policy-lock mode, rejected Spotify route families are handled
before reading a request body, Cookie, Authorization header, database, rate
limiter, random source, or outbound service. Caddy and OAuth2 Proxy
request/auth/access logging is disabled. Node records only fixed event names
and aggregate counts.

For abuse controls after a future unlock, Caddy transiently supplies the
connection IP to Node through one overwritten internal header. Node strictly
normalizes and HMACs it, then discards the raw/canonical address. Only the
keyed digest and fixed window counters may exist in memory/database; no IP
address is stored or logged.

The dormant synthetic protocol is designed to process a public Spotify Client
ID, OAuth state, PKCE verifier, Spotify Access and Refresh Tokens, a generated
Pairing Token, playback state, and control commands needed to provide the
service. It does not receive Spotify passwords, use a Client Secret, record
Spotify audio, or fetch lyrics.

If a future separately approved unlock occurs, the wallpaper receives only
normalized playback data and a Pairing Token. It does not receive Spotify
Access or Refresh Tokens from the public backend.

## Storage and security

PostgreSQL 17 uses two permission-separated databases:

- `spotify_wallpaper` for OAuth sessions, encrypted Spotify tokens, public
  Client ID, Pairing digest, refresh leases, backoff, and live state;
- `spotify_wallpaper_deletion_ledger` for 35-day non-secret `publicId`
  tombstones and reconciliation status.

Access/Refresh Tokens and PKCE verifiers are encrypted before storage.
Pairing Token secrets are stored only as keyed HMAC digests. The complete
Pairing Token may appear only in the one-time no-store success response and
the Wallpaper Engine user property.

No service log or metric may contain a URL, query string, callback data,
header, Cookie, Authorization value, Client ID, IP address, `publicId`, OAuth
state, authorization code, PKCE verifier, Spotify token, Pairing Token, key
material, track metadata, upstream body, or exception text. Caddy and OAuth2
Proxy request/auth/access logs remain disabled.

The VPS host, DNS provider, certificate authority, OAuth2 Proxy identity
provider, PostgreSQL packages, and Spotify may process operational data under
their own terms. The operator must complete processor, regional, and retention
review before any real-user unlock.

## Cookies

Production policy lock runs before Cookie parsing and never sets an OAuth
cookie.

The externally unreachable synthetic protocol permits only these strictly
necessary first-party cookies:

- `__Host-swp-setup` for setup consent binding;
- `__Host-swp-oauth-v2` for top-level callback binding;
- `__Host-swp-confirm` for post-callback confirmation binding.

Each cookie is `HttpOnly`, `Secure`, host-only, has `Path=/`, omits
`Domain`, expires within ten minutes, and is cleared when consumed.
`__Host-swp-oauth-v2` and `__Host-swp-confirm` use `SameSite=Lax`;
`__Host-swp-setup` uses `SameSite=Strict`.
They are not used for analytics, advertising, or tracking. No legacy
`swpb_oauth` cookie is permitted.

## Retention, deletion, and backups

Production currently stores no live Spotify authorization because those
routes are locked. Under the dormant protocol, live credentials remain until
account deletion, explicit revocation, or invalid authorization, subject to
the separately reviewed retention notice active at any future unlock.

Deletion commits a non-secret tombstone to
`spotify_wallpaper_deletion_ledger` before deleting live state from
`spotify_wallpaper`. Tombstones remain for 35 days. The reconciler reapplies
them independently so one failed row does not block later rows.

The two databases are dumped, validated, retained, and restored independently.
After any primary restore, traffic remains closed until all retained
tombstones are replayed and pending reconciliation is zero. If a deletion
cannot be proven present, the service fails closed and affected credentials
are invalidated.

Database token fields remain encrypted inside root-only backup files. The
custom-format files themselves are mode `0600`, never leave the VPS in this
zero-cost design, and are not claimed to have a separate whole-file encryption
layer. This limitation means VPS or physical-disk loss is not recoverable.
Operational records contain only fixed database names, timestamps, sizes,
checksums, and success/failure states. No dump or row content belongs in an
issue, task report, CI artifact, screenshot, or repository file.

There is no evidence of live historical D1 data, and no D1 import utility is
authorized.

## User choices

Users can always use browser mock, legacy direct, or loopback local mode
without the VPS backend. While production is locked there is no backend
authorization or backend account to manage.

If a future unlock is separately approved, users must be able to reauthorize
while retaining the same Pairing identity, delete backend data, remove the
Pairing Token from Wallpaper Engine, and disconnect the application in
Spotify account settings. Backend deletion and Spotify-side disconnect remain
separate actions.

## Incident and privacy contact

Non-sensitive operational symptoms may be reported through:
`https://github.com/Ciellllllllll/SpotifyWallPaper/issues`.

Include only a time and redacted symptom. Never include a Client ID,
credential, Pairing Token, callback URL, header, IP address, or personal
Spotify data. A monitored private contact and the production operator's legal
identity are not configured; Spotify-connected beta and general publication
remain blocked until both are published and recorded.

## EULA and changes

The repository EULA is `docs/eula.md` and is served at `/terms`. Spotify is an
intended third-party beneficiary of the Spotify-specific terms. Operator legal
review and dated operator details are required before accepting any real
Spotify authorization.

Material changes to data, retention, providers, authentication, systemd
network exposure, application mode, or public availability require an updated
notice, threat-model review, and effective date before deployment.
