> Archived on 2026-09-21: the hosted backend has been retired. This is historical evidence, not a current deployment procedure or active service agreement. See `docs/25-public-backend.md`.

# Public Backend VPS Migration Release Notes

## Status

This document records the approved migration target; it is not a shipped
release note until implementation, deployment, and the locked acceptance line
pass. The current public-backend authority targets Node.js 22 ESM on a Linux VPS with
PostgreSQL 17, Caddy, OAuth2 Proxy, and two permission-separated AF_UNIX
sockets. The fixed production origin is
`https://ciel-spotify-wallpaper.duckdns.org`.

When deployed, production is intentionally `SPOTIFY_MODE=policy_locked`. Every
exact allowed Spotify route/method, including `GET /auth/callback`, returns a
fixed no-store 503 before Node reads body, Cookie, Authorization, database,
rate-limit, randomness, or outbound state. Spotify-connected Limited beta and general
Workshop publication are not approved.

This planned release has two separate acceptance lines: the locked VPS deployment and
the dormant hardened OAuth protocol tested only with externally unreachable
synthetic inputs. Completing either line does not authorize real Spotify
traffic.

## Architecture contract

- Caddy terminates TLS and forwards only the exact public table, the exact
  admin table through OAuth2 Proxy, and the five reviewed GET OAuth2 endpoint
  families; every other method/path is 404.
- OAuth2 Proxy protects the exact admin allowlist in production. Policy-locked
  Node still returns 503 for authenticated Spotify setup routes; their working
  bodies are exercised only in the externally unreachable synthetic line.
- Node production opens no TCP listener and binds only the public/admin
  AF_UNIX sockets.
- `GET /health` is DB-independent liveness.
- PostgreSQL readiness, migrations, backups, restore validation, disk, and
  deletion reconciliation are local/systemd checks, not extra HTTP routes.
- `spotify_wallpaper` and
  `spotify_wallpaper_deletion_ledger` are migrated, dumped, validated,
  retained, and restored independently.
- Account deletion and restore safety remain ledger-first and fail closed.
- Caddy/OAuth2 Proxy request/auth/access logs are disabled. Node emits fixed
  event names/counts only, never URLs, query/callback data, headers, Client
  ID, IP address, exception text, or secrets.

The public route allowlist is `GET /health`, `GET /privacy`, `GET /terms`,
`GET /auth/callback`, `GET /api/playback`, `POST /api/control`,
`DELETE /api/account`, and `OPTIONS /api/playback|/api/control`. The admin
allowlist is `GET /setup`, `POST /auth/start`, `GET|POST /auth/confirm`, and
`POST /auth/reauthorize`. Wrong socket/path/method and trailing-slash variants
are rejected.

## Dormant protocol

The retained future protocol uses BYO public Spotify Client ID,
Authorization Code with PKCE, encrypted Spotify tokens, one-time `swpb1.`
Pairing Token issuance, HMAC-only Pairing secret storage, single-flight
refresh, normalized playback/controls, reauthorization, and ledger-first
account deletion.

Only `__Host-swp-setup`, `__Host-swp-oauth-v2`, and
`__Host-swp-confirm` are permitted as short-lived, strictly necessary
first-party cookies in synthetic tests. Production policy lock neither reads
nor emits them.

There is no evidence of live D1 data, so this migration does not include or
authorize a D1 import utility. Historical Cloudflare plans and reports remain
unchanged as evidence.

## Provider compatibility

Browser mock, legacy direct `swpt1.`, loopback Rust, and backend provider
contracts remain independent. The wallpaper retains the shared normalized
playback model. A locked backend response preserves the wallpaper's last safe
display/status and never downgrades to direct mode or sends a Pairing Token to
another origin.

## Known gates

- Spotify approval or a policy-compatible redesign covering authorization,
  sound-recording/visual synchronization, product naming, and Spotify Mark
  usage.
- Original unmodified artwork and required Spotify attribution/link.
- Published dated Privacy Notice/EULA with operator identity and monitored
  private contacts.
- Separately reviewed production application-mode and systemd/network change.
- Exact callback registration only after that unlock is approved.
- Verified migration, backup, isolated restore, ledger replay, disk,
  certificate, cost, abuse, and alert-delivery evidence.
- Security and SpecGuard approval.
- Spotify-connected Limited beta and required soak.

Until every applicable gate is evidenced and the unlock is separately
approved, do not register the callback, connect a real Spotify account, issue
a Pairing Token, invite users, or publish a Spotify-connected build.
