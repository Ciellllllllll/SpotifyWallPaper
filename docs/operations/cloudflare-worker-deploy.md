# Public Backend VPS Deployment Runbook

> The filename is retained temporarily to avoid a path-only staging change.
> This content is the current Node.js/PostgreSQL VPS runbook; it does not
> authorize a Cloudflare deployment.

## Scope and release state

Deploy the optional backend to the operator-controlled Linux VPS at
`https://ciel-spotify-wallpaper.duckdns.org`. The production stack is
Node.js 22, PostgreSQL 17, Caddy, OAuth2 Proxy, systemd, and two
permission-separated AF_UNIX sockets.

Production must set `SPOTIFY_MODE=policy_locked`. The deployment proves the
locked stack only. Do not register a Spotify callback, use a real Spotify
credential, issue a Pairing Token, or expose `synthetic_test`.

Stop unless all of these are true:

- the artifact checksum and reviewed release ID are recorded;
- Node.js major version is 22 and PostgreSQL major version is 17;
- DNS and TLS resolve only the fixed production origin;
- the PostgreSQL migration and two independent backup-validation gates pass;
- Caddy/OAuth2 Proxy request/auth/access logging is disabled;
- Node production has no TCP listener;
- public/admin socket users, groups, directories, and modes match tracked
  systemd/proxy configuration; and
- rollback and fail-closed restore procedures have been reviewed.

## Filesystem and service boundaries

Install immutable application-and-configuration generations beneath
`/opt/spotify-wallpaper/generations/` and point
`/opt/spotify-wallpaper/current` to one verified generation. Store
root-owned configuration and systemd credentials beneath
`/etc/spotify-wallpaper/`. Runtime sockets belong beneath
`/run/spotify-wallpaper/` and are recreated by systemd.

Build the source artifact only from the clean reviewed `HEAD`, passing that
exact 40-character Git SHA to the builder. The builder rebuilds both ignored
`dist` trees and writes the SHA to `RELEASE_ID`; release validation requires
that file to match the deployment release ID and its `SHA256SUMS` entry. The
remaining allowlist is the root manifest/lock, public-backend
manifest/compiled dist/migrations/legal files, and shared-types manifest/dist.
It must not contain `node_modules`, deployment configuration, TypeScript
source, source maps, tests, fixtures, dumps, `.env` files, logs, secrets, or
tool caches.
The only external runtime npm dependency is `pg`; the local
`@spotify-wallpaper/shared-types` package remains a product dependency.

Systemd, Caddy, OAuth2 Proxy, PostgreSQL, and timer files are a separate config
bundle generated from tracked deployment files at the same reviewed Git SHA.
Record and verify its sorted SHA-256 manifest independently. Never install
configuration directly from a mutable working checkout.
Build it with
`deploy/public-backend/scripts/build-config-bundle.sh <reviewed-HEAD-SHA> <new-output.tar.gz>`;
the builder archives an explicit production-file allowlist and excludes its
own builder and every deployment test.

The release tool installs fixed root-owned links from the live operating-system
paths into
`/opt/spotify-wallpaper/current/config/deploy/public-backend/`.
One atomic `current` switch therefore activates or rolls back the application
and all non-secret configuration together. The fixed mappings are:

- `/etc/caddy/Caddyfile` and
  `/etc/spotify-wallpaper/oauth2-proxy.cfg`;
- `/etc/postgresql/17/swp/postgresql.conf`, `pg_hba.conf`, and `pg_ident.conf`;
- every tracked `swp-*.service` and `swp-*.timer` beneath
  `/etc/systemd/system/`;
- the tracked sysusers and tmpfiles definitions; and
- the runtime SQL and shell files beneath
  `/usr/local/libexec/spotify-wallpaper/`.

The real `/etc/spotify-wallpaper/public-backend.env` and
`oauth2-proxy.env` files contain local secrets and are deliberately not links
and not bundle members. Their tracked `.example` files are reference material
only. The link installer refuses an existing regular file or a link to any
other source; it never overwrites a package or operator file.

Never print environment variables or systemd credentials. Deployment records
contain only release ID, artifact checksum, fixed component versions, fixed
migration names, timestamps, and pass/fail outcomes.

## Database gate

PostgreSQL uses exactly:

- `spotify_wallpaper`;
- `spotify_wallpaper_deletion_ledger`.

The application, migration, backup, and restore roles are separate and
least-privilege. Credentials are supplied by root-owned PostgreSQL service
definitions or systemd credentials, never command-line passwords or tracked
files.
The peer-authenticated local `postgres` role is reachable only from the OS
`postgres` account and is used solely by the root-run primary-loss recovery
procedure to establish the reviewed owner and ACL boundary. No service process
uses that role.

Before service restart:

1. set a root-only `umask 077`, place traffic in maintenance, and stop Node;
2. run the tracked primary migrations with `ON_ERROR_STOP=1`;
3. run the tracked ledger migrations independently with `ON_ERROR_STOP=1`;
4. verify both schema-version tables contain exactly the release migrations;
5. create each custom-format dump through a root-owned temporary file on the
   same VPS, verify owner root and mode `0600`, validate with
   `pg_restore --list`, and calculate its checksum without renaming it;
6. restore that still-temporary dump into its own isolated temporary
   validation database;
7. build a clean expected database from every tracked migration, compare its
   full schema, constraints, indexes, and privileges with the restored copy,
   reject unexpected objects or public write privileges, and run fixed
   aggregate checks without selecting credential contents; and
8. only after every validation succeeds, atomically rename the dump into that
   database's independent backup series, then drop only the explicitly named
   temporary validation database. On failure, delete the temporary dump by
   its exact verified path and never give it a retained-backup name.

No normal, emergency, or validation dump is copied off the VPS. Temporary
files and expired 35-day backups are deleted only by exact absolute path after
owner/mode/path validation. Same-VPS backup cannot recover VPS/disk loss.

A primary success cannot substitute for a ledger success. Any migration,
dump, checksum, validation-restore, or schema mismatch keeps traffic closed.
Do not build a D1 import step; no live D1 data has been evidenced.

## Install

1. Create the fresh PostgreSQL `17/swp` cluster in stopped state. Preserve any
   package-created Caddy and PostgreSQL configuration at separately named,
   root-only paths, leaving only the exact reviewed link targets absent. Do not
   remove an active configuration or use this first-install step for an
   existing cluster.
2. Verify the config-bundle transport checksum, extract it into a root-only
   temporary directory, and verify `CONFIG-MANIFEST.sha256` before executing
   anything from it.
3. Invoke that extracted bundle's `release.sh deploy` command with the source
   artifact, config bundle, both transport checksums, and exact release SHA.
   The command re-verifies both archives, extracts the allowlisted artifact
   into a new empty directory, and rejects unexpected files, symlinks, source
   maps, writable executables, or secret-bearing files.
4. The release command runs workspace-scoped
   `npm ci --omit=dev --ignore-scripts`, then verifies shared-type import,
   startup, and health.
5. The release command writes and verifies a
   sorted SHA-256 manifest over the complete runtime tree including
   `node_modules`, grants non-root services only read/directory-traverse access,
   removes every write bit, stores the application and configuration together
   under the exact release SHA, installs only the fixed links above, and
   atomically switches `current`. A completely prepared existing generation is
   verified and reused after an interrupted promotion. On an already installed
   host, every fixed link must already point through `current`; any other file
   or link stops deployment.
6. After the release smoke passes, reload systemd and start only the
   PostgreSQL cluster while Node, OAuth2 Proxy, and Caddy remain stopped.
   `release.sh` applies the verified sysusers and tmpfiles definitions before
   its non-root smoke, so the service accounts and socket directories already
   exist when startup is checked.
7. As the local `postgres` OS user, execute the linked
   `/usr/local/libexec/spotify-wallpaper/bootstrap.sql` against the `postgres`
   database. It idempotently creates or resets the five login roles to the
   exact passwordless, least-privilege attributes and creates both fixed
   databases before applying owners and database privileges.
8. Configure the VPS/provider firewall to allow inbound TCP 443 and deny
   inbound TCP 80. Verify that an HTTP probe is blocked or never returns a
   redirect/`Location` header before opening traffic.
9. Run `systemd-analyze verify` against every installed unit, then run
   `swp-migrate.service`. It is a non-resident oneshot; its completion is
   ordered before Node without leaving the migration unit active.
10. Validate Caddy and OAuth2 Proxy configuration without dumping secrets, then
   start Node, OAuth2 Proxy, and Caddy in that order.

The Node unit must set `SPOTIFY_MODE=policy_locked`, use an unprivileged user,
apply the tracked sandbox, and create only the two AF_UNIX sockets. Any
unknown mode must fail startup. A production TCP `LISTEN` owned by the Node
process is an immediate deployment failure.

## Route and socket verification

Verify locally without credentials:

- public socket accepts only `GET /health`, `GET /privacy`, `GET /terms`,
  `GET /auth/callback`, `GET /api/playback`, `POST /api/control`,
  `DELETE /api/account`, and
  `OPTIONS /api/playback|/api/control`;
- admin socket accepts only `GET /setup`, `POST /auth/start`,
  `GET|POST /auth/confirm`, and `POST /auth/reauthorize`;
- every wrong-socket, wrong-method, unknown-path, and trailing-slash request is
  rejected;
- `/health` succeeds while both databases are intentionally unavailable;
- every exact allowed Spotify route/method returns the identical no-store 503
  without Node reading body, Cookie, Authorization, database, rate limiter,
  randomness, or outbound state;
- every wrong-socket, wrong-method, unknown-path, and trailing-slash request is
  rejected.

Verify socket ownership/mode. Production Caddy forwards only the exact public
route table, the exact admin table through OAuth2 Proxy, and the reviewed GET
OAuth2 endpoint families. Validate the authenticated setup body only in an
externally unreachable synthetic environment; production Node remains locked.
Do not weaken permissions to make a smoke test pass.

## External smoke

Use the exact origin and non-verbose clients. Do not record query strings,
headers, redirect locations, or credentials.

Expected results:

- `GET /health`: fixed successful liveness response;
- `GET /privacy`: current Privacy Notice;
- `GET /terms`: current EULA;
- unauthenticated `GET /setup`: redirect into the reviewed GitHub login path;
- authenticated allowed-user `GET /setup`: fixed no-store 503 from the
  policy-locked Node route;
- `GET /auth/callback`: fixed no-store 503;
- `GET /api/playback`: fixed no-store 503;
- `POST /api/control`: fixed no-store 503;
- `DELETE /api/account`: fixed no-store 503.

Confirm no Caddy/OAuth2 Proxy request/auth/access record was created and Node
emitted only approved fixed events/counts. Do not run an OAuth flow or send a
Bearer token.

## Local readiness and alerts

Run local fixed-output checks for:

- Node process and socket state;
- PostgreSQL connectivity and exact migration versions for both databases;
- backup age, size, checksum, and isolated validation-restore outcome for each
  database;
- deletion-ledger pending/oldest/retry aggregate state;
- disk/inode capacity;
- TLS certificate lifetime;
- failed systemd units and timer freshness; and
- absence of a Node TCP listener.

Alerts use secret-free fixed subjects/bodies through the approved local
Postfix relay. Test delivery to the reviewed recipients. No readiness check
adds an HTTP route or prints a URL, header, Client ID, IP, row, or secret.

## Rollback

Application rollback does not roll back either database.

1. return to maintenance and stop Node;
2. confirm the previous artifact is compatible with both current schemas;
3. invoke `release.sh rollback <release-sha>`; it re-verifies the immutable
   generation, atomically repoints the single `current` link, and runs
   `systemctl daemon-reload` before returning;
4. restart Node, OAuth2 Proxy, and Caddy in order;
5. repeat socket, policy-lock, external smoke, and local readiness checks; and
6. keep traffic closed if data integrity is uncertain.

Use the restore runbook for data recovery. Never compensate for a schema or
ledger problem by exposing a previous binary.

## Acceptance

Record the immutable release ID/checksum, fixed component versions, migration
names, both backup-validation results, socket permissions, policy-lock matrix,
local readiness results, alert delivery, rollback test, and soak result.

The dormant hardened OAuth acceptance line is tested separately in an
externally unreachable synthetic environment. A successful locked deployment
and synthetic OAuth suite still do not authorize real Spotify traffic.
