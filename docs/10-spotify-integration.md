# Spotify Integration

## Responsibilities

This domain handles Spotify OAuth, token refresh, API polling, normalized playback state, playback operations, and Spotify error handling.

These concerns cross a provider boundary. Mock, direct, and backend are
explicit `PlaybackProvider` kinds with
one polling/control contract. Provider selection distinguishes `mock`,
`ready`, and `invalid`; configuration errors are not network errors. The
runtime owns lifecycle and scheduling, while providers own their transport and
credential state. No provider is required for deterministic browser mock mode.

## OAuth policy

Use Authorization Code with PKCE. Do not use Client Secret in the Web Wallpaper.

The wallpaper accepts Client ID and Refresh Token through its dedicated
Wallpaper Engine property or explicit process-memory session input. Standard
Wallpaper Engine direct mode persists credentials in its dedicated IndexedDB
store as the limited exception described below.
Settings JSON is preference-only: embedded credentials are ignored and are
never migrated or exported. The configurator may help the user obtain a
Refresh Token, but raw credentials stay in the native/provider boundary.

Do not log tokens or full callback URLs.

## Provider modes

- `direct`: standard Wallpaper Engine access to Spotify using each user's Client ID and Refresh Token.
- `backend` with loopback HTTP: optional local Rust backend.
- Public HTTPS backend origins are rejected, including formerly configured origins.
- no usable provider: browser mock or last safe display.

An explicitly selected but invalid backend configuration must not silently fall back to direct credentials.

## Static authorization and direct credential persistence

Initial authorization and reauthorization use the static Pages helper at
`https://ciellllllllll.github.io/SpotifyWallPaper/spotify-auth/` with exact
Redirect URI `https://ciellllllllll.github.io/SpotifyWallPaper/spotify-auth/callback/`.
These are deployment targets, not a claim that this migration published them.
Each user enters an editable Client ID; no build-time Spotify credential is
required. PKCE S256 state, verifier, Client ID, Redirect URI, and creation time
belong to one single-use, ten-minute sessionStorage transaction. Callback
parameters are removed from the browser URL before network completion.

The helper hands off `swpt2.` data containing the minimum credentials and
authorization identity/time. Compatible `swpt1.` input remains accepted with
unknown original authorization time. Base64url is encoding, not encryption;
both formats contain a secret Refresh Token, unlike a backend `swpb1.` token.
The helper keeps successful credentials only in page memory for explicit copy.
GitHub receives the initial callback request containing its short-lived code;
this is not an entirely server-free OAuth exchange.

Wallpaper Engine uses IndexedDB `spotify-wallpaper-direct-credentials`, store
`credentials`, separately from settings. It contains plaintext Client ID,
latest Refresh/Access Tokens, expiry, authorization identity, revision, and a
refresh lease with a bounded waiting deadline. The host controls its physical profile location.
This is not an OS secret vault and does not protect against same-user malware,
DevTools, or modified wallpaper code. Browser mock startup does not restore it.

Repeated initial property data must retain the latest saved token. New valid
authorization replaces the old one only after persistence succeeds. Empty
explicit input disconnects; absent properties retain state. Disconnect and a
current-revision `invalid_grant` delete active secrets and retain non-secret
retirement digests so stale properties cannot resurrect an authorization.
Deleting the whole storage area removes that protection; clear the host input
and revoke Spotify access when appropriate before clearing storage.

Short atomic transactions, lease identity, authorization identity, and revision
protect shared-storage refresh. No transaction spans a network request.
Provider disposal must not discard a completed token rotation, but an older
authorization cannot overwrite a replacement. A late 401 retries once with the
current token; only current `invalid_grant` retires credentials. Persistence
failure is distinct from revoked authorization and is not a restart guarantee.

Explicit disconnect erases durable secrets even after malformed settings close
the networking safety gate; disconnect must not reopen that gate. Invalid
settings alone retain the saved authorization. An explicit provider selection
supersedes pending authorization activation even when the displayed provider
has not changed; appearance-only notifications do not cancel activation.

The lease is persisted before the token request and remains until its result
is confirmed in storage. Deadline expiry is an unknown outcome, not permission
for another session to retry with the old Refresh Token. All sessions sharing
that database fail closed until the original result is saved or a new
authorization is imported. No module-global memory registry is required.

After a completion write fails, the original session retains the response and
its completion timestamp in memory. It retries that write before another
Spotify request, preserving authorization/revision/lease checks and the original
Retry-After deadline. Rotation and invalid_grant can therefore recover by saving
the original response without resending the old token. A lost acknowledgement
is handled by rereading the committed record. Ordinary persisted HTTP failures
still use the shared cooldown and backoff.

The original response cannot be recovered after its process ends. An orphaned
lease, lost token-endpoint response, or malformed successful token response
requires reauthorization if the original session cannot resolve it. This
conservative stop concerns token refresh, not ordinary playback API outages.
Do not promise permanent automatic recovery or coordination across different
storage areas. Existing version-1 leases use the same fail-closed rule.

Spotify's Refresh Token lifetime is six months from original authorization,
not extended by Access Token refresh. Do not impose a 24-hour lifetime or
convert six months into an automatic 180-day deletion rule. See the
[Spotify refresh documentation](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens).
Wallpaper Engine CORS, storage persistence/sharing, sleep/resume, and real
72-hour operation remain separate real-machine acceptance checks. Separate
storage contexts cannot be promised shared locking or safe token reuse;
authorize each separately and validate real-account behavior.

## Retired public backend

The hosted proxy is removed. Old `swpb1.` input is rejected with a fixed Pages
reauthorization message without replacing active direct credentials. The
optional loopback Rust backend and its separate credential input remain.

## Required scopes

Passive display:

- `user-read-currently-playing`
- `user-read-playback-state`

Playback operations:

- `user-modify-playback-state`

Future optional library features must request library scopes only when enabled.

## Normalized playback model

Do not pass raw Spotify API responses directly to UI. Normalize into a display-safe model containing:

- item kind: track, episode, none
- item id
- item uri
- title
- artists or publisher/show names
- album or show title
- image URLs
- duration ms
- progress ms
- is playing
- device state
- shuffle state
- repeat state
- volume percent
- external URL
- fetched timestamp

The dependency-free `normalizeSpotifyPlaybackPayload(raw, fetchedAt)` in
`packages/shared-types` is the single TypeScript authority. It requires a valid
`fetchedAt`, non-empty trimmed track/episode `id` and `uri`, finite bounded
integers for numeric fields, `progressMs <= durationMs`, at most 32 artists and
8 image URLs, and the `none` invariant (`id/uri=null`, zero duration/progress,
not playing). Direct mode wraps its result to retain the `item_null` warning;
Rust normalization is intentionally kept
at the language boundary and is aligned through provider-v1 fixtures.

## Polling

Default polling:

- playing: about 1 second
- paused/stopped: slower, about 3 seconds
- error: backoff
- rate-limited: respect retry delay if available

Between polls, progress display may be interpolated locally while playing.

## Error handling

Classify at least:

- unauthorized
- forbidden
- rate limited
- network error
- unavailable/no active device
- unknown response shape
- item null

Errors must not crash the wallpaper.

Loopback provider-v1 responses use `{ ok: true, value }` or `{ ok: false, error }`, preserve `retryAfterMs`, return normalized playback only, keep `source: 'spotify'`, and include `fetchedAt`.

## Playback controls

Support when allowed:

- play/pause
- next
- previous
- seek
- volume
- shuffle
- repeat

Premium or restricted-device failures must show safe disabled/error state.
