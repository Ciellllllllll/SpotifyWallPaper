# Privacy Notice For The Public Backend Beta

## Status

This notice covers the optional Cloudflare Worker public backend. It does not
authorize a general Wallpaper Engine Workshop release. Before a limited beta,
the operator must publish the production hostname, effective date, operator
identity, privacy contact, and incident contact. Those values are not yet
configured in this repository.

Users must receive this notice and the linked EULA before authorization and
must explicitly accept them on `/setup`.

## Data Processed

The backend processes the Spotify Client ID supplied by the user, OAuth state,
PKCE verifier, Spotify Access and Refresh Tokens, the generated Pairing Token,
source IP for transient abuse limiting, playback state, and control commands
needed to provide the service. Spotify track metadata and artwork URLs pass
through the normalized playback response. The backend does not receive or
store Spotify passwords and does not use a Spotify Client Secret.

The wallpaper receives only normalized playback data and a Pairing Token. It
does not receive Spotify Access or Refresh Tokens when public backend mode is
enabled.

## Storage And Security

- Access and Refresh Tokens and PKCE verifiers are encrypted before D1 storage.
- Pairing Token secrets are stored only as HMAC digests.
- Access Tokens may be encrypted in D1 because Workers are stateless.
- Worker invocation logs are disabled because OAuth callback URLs contain
  authorization codes.
- Aggregate metrics contain fixed route, status, latency, rate-limit, and
  refresh outcome classes only.
- The service does not store Spotify audio, lyrics, full callback URLs,
  authorization codes, Pairing Tokens, IP addresses, track metadata, or
  exception text in custom metrics.

Cloudflare and Spotify process data under their own terms as infrastructure and
API providers. Operators must complete their own processor and regional
privacy review before accepting beta users.

## Cookies

The Worker sets one strictly necessary first-party cookie named `swpb_oauth`.
It is HttpOnly, Secure, SameSite=Lax, scoped to the OAuth callback, expires
after ten minutes, and is cleared by the callback response. It binds the
authorization browser to the stored OAuth session and is not used for
analytics, advertising, or third-party tracking. Blocking or deleting it
prevents an in-progress authorization from completing. Users can manage it
through browser cookie controls.

## Retention

Live credentials remain until account deletion, explicit revocation, or Spotify
authorization becomes invalid. Spotify authorization is treated as requiring
reauthorization six months after the original authorization.

Account deletion removes live OAuth sessions, encrypted Spotify tokens, Client
ID, Pairing digest, refresh leases, and cache. A separate deletion-ledger D1
database retains a non-secret `publicId` tombstone for 35 days so a D1 Time
Travel restore cannot silently restore deleted credentials. Cloudflare backup
and Time Travel retention may temporarily preserve encrypted historical data;
the tombstone reconciliation procedure must run before restored traffic is
reopened.

Consumed OAuth sessions are deleted atomically. Abandoned expired sessions are
purged by scheduled maintenance.

## User Choices

Users can:

- stop using the public backend and switch to mock, direct legacy, or loopback
  local mode;
- reauthorize Spotify while retaining the same Pairing Token;
- delete backend data from the same-origin `/setup` page;
- disconnect the Spotify application in Spotify account settings; and
- remove the Pairing Token from Wallpaper Engine properties.

Backend deletion and Spotify-side disconnect are separate actions. Users should
perform both when they want to end access completely.

## Incident And Privacy Contact

Non-sensitive incidents or deletion failures may be reported through the
repository issue tracker:
`https://github.com/Ciellllllllll/SpotifyWallPaper/issues`. Include only the
time and a redacted symptom. Do not place Client IDs, credentials, Pairing
Tokens, callback URLs, or personal Spotify data in a public issue.

A monitored private channel for sensitive reports and the production
operator's privacy identity are not configured yet. Limited beta and general
publication remain blocked until those contacts are published and recorded in
the public-backend phase report.

## EULA

The beta EULA is recorded in `docs/eula.md` and served by the Worker at
`/terms`. Spotify is an intended third-party beneficiary of this notice and
that EULA and may enforce their Spotify-specific terms. The operator must
complete legal review and publish dated operator details before accepting
Spotify-connected beta users.

## Changes

Material changes to stored data, retention, providers, authentication, or
public availability require an updated notice, threat-model review, and a new
effective date before deployment.
