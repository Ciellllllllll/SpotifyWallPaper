# Retired Public Backend

The hosted Spotify proxy is retired as of 2026-09-21. Its Node/PostgreSQL
implementation, Caddy/OAuth2 Proxy/systemd deployment assets, artifact builder,
and dedicated CI are removed. Do not use the archived runbooks to deploy it.

With explicit user approval, these Cloudflare resources were permanently
deleted and their absence verified in the dashboard:

- Worker `spotify-wallpaper-api-preview` (including deployments and configuration).
- D1 `spotify-wallpaper-preview`.
- D1 `spotify-wallpaper-deletion-preview`.

The inspected VPS had no SpotifyWallPaper service or deployment directories.
The user requested no shutdown in that case, so the VPS remains unchanged.
Other projects' Cloudflare resources were not changed. This is not a claim
that unrelated account resources or provider-retained internal backups were purged.

Standard setup is the static GitHub Pages PKCE helper plus direct Spotify
access and credential persistence in Wallpaper Engine. See
`10-spotify-integration.md` and `user-guide.md`. Pages publication is separate
and was not performed as part of retirement.

The optional local Rust backend, Tauri configurator and Rainmeter remain.
Backend transport accepts only canonical HTTP loopback origins and rejects
redirects. Old public `swpb1.` input cannot be converted into Spotify tokens;
reauthorize through Pages. Replaying it must not replace working direct credentials.

Ignored local settings, build outputs and historical evidence remain protected.
Never remove ignore rules merely because their original producer is retired.

When an old hidden pairing value and an empty standard field arrive together,
retain the current credential. A later explicit standard-field-only edit does
not inherit the hidden pairing value; empty input then disconnects normally.
