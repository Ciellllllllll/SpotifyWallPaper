#!/bin/sh
set -eu
umask 077

[ "$(id -u)" -eq 0 ] || exit 1
[ "$#" -ge 1 ] || exit 1
scenario=$1
shift

case "$scenario" in
  ledger-only-loss|both-loss|cluster-loss|backup-only)
    printf '%s\n' RECOVERY_REJECTED_REAUTHORIZE_ALL
    exit 2
    ;;
  primary-only-loss) ;;
  *) exit 1 ;;
esac

[ "$#" -eq 1 ] || exit 1
for unit in \
  swp-public-backend.service \
  swp-oauth2-proxy.service \
  swp-caddy.service \
  swp-backup.service \
  swp-backup.timer \
  swp-reconcile.service \
  swp-reconcile.timer \
  swp-migrate.service
do
  systemctl is-active --quiet "$unit" && exit 1
done

export PGHOST=/run/postgresql PGPORT=5433
candidate=$(realpath -- "$1")
case "$candidate" in /var/backups/spotify-wallpaper/primary/primary-*.dump) ;; *) exit 1 ;; esac
[ -f "$candidate" ]
[ "$(stat -c %U -- "$candidate")" = root ]
[ "$(stat -c %a -- "$candidate")" = 600 ]
sidecar=$candidate.sha256
case "$sidecar" in /var/backups/spotify-wallpaper/primary/primary-*.dump.sha256) ;; *) exit 1 ;; esac
[ -f "$sidecar" ]
[ ! -L "$sidecar" ]
[ "$(realpath -- "$sidecar")" = "$sidecar" ]
[ "$(stat -c %U -- "$sidecar")" = root ]
[ "$(stat -c %a -- "$sidecar")" = 600 ]
candidate_digest_line=$(sha256sum -- "$candidate")
candidate_digest=${candidate_digest_line%% *}
case "$candidate_digest" in ''|*[!0-9a-f]*) exit 1 ;; esac
[ "$(cat -- "$sidecar")" = "$candidate_digest  ${candidate##*/}" ]
(cd "${sidecar%/*}" && sha256sum --check --strict "${sidecar##*/}" >/dev/null)
pg_restore --list "$candidate" >/dev/null

/usr/local/libexec/spotify-wallpaper/validate-database.sh spotify_wallpaper_deletion_ledger ledger live
fixed_database_exists=$(runuser -u postgres -- psql --no-psqlrc --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 --dbname=postgres \
  --command="SELECT count(*) FROM pg_database WHERE datname = 'spotify_wallpaper'")
[ "$fixed_database_exists" = 0 ]

recovery="spotify_wallpaper_recovery_$(date -u +%Y%m%d%H%M%S)_$$"
tombstones=$(mktemp /var/backups/spotify-wallpaper/.restore-tombstones.XXXXXX)
restore_sql=
keep_recovery=false
recovery_created=false
recovery_promoted=false
cleanup() {
  trap '' HUP INT TERM
  trap - EXIT
  rm -f -- "$tombstones" "$restore_sql"
  if [ "$recovery_created" = true ] && [ "$keep_recovery" = false ]; then
    failed_database=$recovery
    if [ "$recovery_promoted" = true ]; then
      failed_database=spotify_wallpaper
    fi
    runuser -u postgres -- dropdb --if-exists "$failed_database" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 143' HUP INT TERM

trap '' HUP INT TERM
runuser -u swp_restore -- createdb --template=template0 "$recovery" >/dev/null
recovery_created=true
trap 'exit 143' HUP INT TERM
runuser -u postgres -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
  --dbname=postgres --set=recovery="$recovery" >/dev/null <<'SQL'
ALTER DATABASE :"recovery" OWNER TO swp_migrator;
REVOKE ALL ON DATABASE :"recovery" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"recovery" TO swp_backend, swp_migrator, swp_backup, swp_restore, swp_maintenance;
SQL
runuser -u postgres -- pg_restore --role=swp_migrator --no-owner --no-privileges \
  --dbname="$recovery" <"$candidate" >/dev/null

runuser -u swp_maintenance -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --dbname=spotify_wallpaper_deletion_ledger \
  --command="COPY (SELECT public_id FROM deletion_tombstones ORDER BY public_id) TO STDOUT" >"$tombstones"

restore_sql=$(mktemp /var/backups/spotify-wallpaper/.restore-sql.XXXXXX)
if ! {
  printf '%s\n' 'BEGIN;' 'SET ROLE swp_migrator;' 'CREATE TEMP TABLE swp_restore_tombstones (public_id TEXT PRIMARY KEY);' 'COPY swp_restore_tombstones (public_id) FROM STDIN;' || exit 1
  cat "$tombstones" || exit 1
  printf '%s\n' '\.' \
    'DELETE FROM credentials WHERE public_id IN (SELECT public_id FROM swp_restore_tombstones);' \
    'TRUNCATE setup_sessions, oauth_sessions, callback_confirmations, spotify_backoff;' \
    "DO \$\$ BEGIN IF EXISTS (SELECT 1 FROM credentials c JOIN swp_restore_tombstones t ON t.public_id = c.public_id) THEN RAISE EXCEPTION 'retained deletion remains'; END IF; END \$\$;" \
    'COMMIT;' || exit 1
} >"$restore_sql"; then
  exit 1
fi
runuser -u postgres -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --dbname="$recovery" <"$restore_sql" >/dev/null
rm -f -- "$restore_sql"
restore_sql=

runuser -u postgres -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
  --dbname="$recovery" >/dev/null <<'SQL'
SET ROLE swp_migrator;
\i /usr/local/libexec/spotify-wallpaper/grants-primary.sql
SQL
/usr/local/libexec/spotify-wallpaper/validate-database.sh "$recovery" primary recovery
fixed_database_exists=$(runuser -u postgres -- psql --no-psqlrc --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 --dbname=postgres \
  --command="SELECT count(*) FROM pg_database WHERE datname = 'spotify_wallpaper'")
[ "$fixed_database_exists" = 0 ]
trap '' HUP INT TERM
runuser -u postgres -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
  --dbname=postgres --set=recovery="$recovery" >/dev/null <<'SQL'
ALTER DATABASE :"recovery" RENAME TO spotify_wallpaper;
SQL
recovery_promoted=true
trap 'exit 143' HUP INT TERM
/usr/local/libexec/spotify-wallpaper/validate-database.sh spotify_wallpaper primary live

runuser -u swp_maintenance -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
  --dbname=spotify_wallpaper_deletion_ledger \
  --command="UPDATE deletion_tombstones SET reconciled_at_ms = NULL" >/dev/null
pending=1
while [ "$pending" -gt 0 ]; do
  /usr/local/libexec/spotify-wallpaper/reconcile.sh
  pending=$(runuser -u swp_maintenance -- psql --no-psqlrc --tuples-only --no-align \
    --set=ON_ERROR_STOP=1 --dbname=spotify_wallpaper_deletion_ledger \
    --command="SELECT count(*) FROM deletion_tombstones WHERE reconciled_at_ms IS NULL")
  case "$pending" in ''|*[!0-9]*) exit 1 ;; esac
done

keep_recovery=true
printf 'RECOVERY_SWITCHED_TRAFFIC_CLOSED credential_matches_to_retained_tombstones pending=%s\n' "$pending"
