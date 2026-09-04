#!/bin/sh
set -eu
umask 077

[ "$#" -eq 2 ] || exit 1
release_id=$1
output=$2
[ "${#release_id}" -eq 40 ]
case "$release_id" in *[!0-9a-f]*) exit 1 ;; esac
[ "$(git rev-parse HEAD)" = "$release_id" ]
[ ! -e "$output" ]
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM

archive=$temporary/config.tar
git archive "$release_id" -- \
  deploy/public-backend/Caddyfile \
  deploy/public-backend/oauth2-proxy.cfg \
  deploy/public-backend/environment/oauth2-proxy.env.example \
  deploy/public-backend/environment/public-backend.env.example \
  deploy/public-backend/postgresql/bootstrap.sql \
  deploy/public-backend/postgresql/pg_hba.conf \
  deploy/public-backend/postgresql/pg_ident.conf \
  deploy/public-backend/postgresql/postgresql.conf \
  deploy/public-backend/scripts/backup.sh \
  deploy/public-backend/scripts/grants-ledger.sql \
  deploy/public-backend/scripts/grants-primary.sql \
  deploy/public-backend/scripts/install-oauth2-proxy.sh \
  deploy/public-backend/scripts/migrate.sh \
  deploy/public-backend/scripts/monitor.sh \
  deploy/public-backend/scripts/preflight.sh \
  deploy/public-backend/scripts/reconcile.sh \
  deploy/public-backend/scripts/release.sh \
  deploy/public-backend/scripts/restore.sh \
  deploy/public-backend/scripts/validate-database.sh \
  deploy/public-backend/scripts/verify-authorization-boundary.sh \
  deploy/public-backend/systemd/swp-backup.service \
  deploy/public-backend/systemd/swp-backup.timer \
  deploy/public-backend/systemd/swp-caddy.service \
  deploy/public-backend/systemd/swp-migrate.service \
  deploy/public-backend/systemd/swp-monitor.service \
  deploy/public-backend/systemd/swp-monitor.timer \
  deploy/public-backend/systemd/swp-oauth2-proxy.service \
  deploy/public-backend/systemd/swp-public-backend.service \
  deploy/public-backend/systemd/swp-reconcile.service \
  deploy/public-backend/systemd/swp-reconcile.timer \
  deploy/public-backend/sysusers.d/spotify-wallpaper.conf \
  deploy/public-backend/tmpfiles.d/spotify-wallpaper.conf >"$archive"
tar --extract --file="$archive" --strip-components=2 --directory="$temporary"
rm -f -- "$archive"
printf '%s\n' "$release_id" >"$temporary/RELEASE_ID"
files=$(mktemp)
sorted_files=$(mktemp)
if ! (cd "$temporary" && find . -type f ! -name CONFIG-MANIFEST.sha256 -printf '%P\0') >"$files"; then
  rm -f -- "$files" "$sorted_files"
  exit 1
fi
if ! LC_ALL=C sort -z "$files" >"$sorted_files"; then
  rm -f -- "$files" "$sorted_files"
  exit 1
fi
[ -s "$sorted_files" ]
if ! (cd "$temporary" && xargs -0 sha256sum <"$sorted_files" >CONFIG-MANIFEST.sha256); then
  rm -f -- "$files" "$sorted_files"
  exit 1
fi
rm -f -- "$files" "$sorted_files"
(cd "$temporary" && sha256sum --check CONFIG-MANIFEST.sha256 >/dev/null)
tar --create --gzip --file="$output" --directory="$temporary" .
printf 'config_bundle_created %s\n' "$release_id"
