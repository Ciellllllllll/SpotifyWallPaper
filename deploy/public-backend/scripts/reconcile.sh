#!/bin/sh
set -eu
umask 077

[ "$(id -u)" -eq 0 ] || exit 1
export PGHOST=/run/postgresql PGPORT=5433
pending_file=$(mktemp /run/spotify-wallpaper/.reconcile.XXXXXX)
trap 'rm -f -- "$pending_file"' EXIT HUP INT TERM
now_ms="$(date +%s)000"

expired_stats=$(runuser -u swp_maintenance -- psql --no-psqlrc --tuples-only --no-align --field-separator=' ' \
  --set=ON_ERROR_STOP=1 --dbname=spotify_wallpaper --command="
WITH cutoff AS (
  SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT AS now_ms
), deleted_setup AS (
  DELETE FROM setup_sessions WHERE expires_at_ms < (SELECT now_ms FROM cutoff) RETURNING 1
), deleted_oauth AS (
  DELETE FROM oauth_sessions WHERE expires_at_ms < (SELECT now_ms FROM cutoff) RETURNING 1
), deleted_confirmation AS (
  DELETE FROM callback_confirmations WHERE expires_at_ms < (SELECT now_ms FROM cutoff) RETURNING 1
)
SELECT (SELECT count(*) FROM deleted_setup),
       (SELECT count(*) FROM deleted_oauth),
       (SELECT count(*) FROM deleted_confirmation)")
set -- $expired_stats
[ "$#" -eq 3 ]
printf '%s' "$1$2$3" | grep -Eq '^[0-9]+$'
printf 'expired_setup=%s expired_oauth=%s expired_confirmation=%s\n' "$1" "$2" "$3"

runuser -u swp_maintenance -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --dbname=spotify_wallpaper_deletion_ledger \
  --command="COPY (SELECT public_id FROM deletion_tombstones WHERE reconciled_at_ms IS NULL ORDER BY public_id LIMIT 100) TO STDOUT" >"$pending_file"

attempted=0
reconciled=0
failed=0
while IFS= read -r public_id; do
  [ -n "$public_id" ] || continue
  printf '%s' "$public_id" | grep -Eq '^[A-Za-z0-9_-]{22}$' || exit 1
  attempted=$((attempted + 1))

  {
    printf '\\set public_id %s\n' "$public_id"
    printf '%s\n' "UPDATE deletion_tombstones SET reconciliation_attempts = reconciliation_attempts + 1, last_attempt_at_ms = $now_ms WHERE public_id = :'public_id' AND reconciled_at_ms IS NULL;"
  } | runuser -u swp_maintenance -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --dbname=spotify_wallpaper_deletion_ledger >/dev/null 2>&1 || {
    failed=$((failed + 1))
    continue
  }

  {
    printf '\\set public_id %s\n' "$public_id"
    printf '%s\n' 'BEGIN;'
    printf '%s\n' \
      "DELETE FROM spotify_backoff" \
      "WHERE spotify_client_id IN (" \
      "  SELECT spotify_client_id FROM credentials WHERE public_id = :'public_id'" \
      ") AND NOT EXISTS (" \
      "  SELECT 1 FROM credentials AS other" \
      "  WHERE other.spotify_client_id = spotify_backoff.spotify_client_id" \
      "    AND other.public_id <> :'public_id'" \
      ");" \
      "DELETE FROM oauth_sessions WHERE credential_public_id = :'public_id';" \
      "DELETE FROM credentials WHERE public_id = :'public_id';"
    printf '%s\n' 'COMMIT;'
  } | runuser -u swp_maintenance -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --dbname=spotify_wallpaper >/dev/null 2>&1 || {
    failed=$((failed + 1))
    continue
  }

  reconciled_at_ms="$(date +%s)000"
  {
    printf '\\set public_id %s\n' "$public_id"
    printf '%s\n' "UPDATE deletion_tombstones SET reconciled_at_ms = $reconciled_at_ms WHERE public_id = :'public_id' AND reconciled_at_ms IS NULL;"
  } | runuser -u swp_maintenance -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --dbname=spotify_wallpaper_deletion_ledger >/dev/null 2>&1 || {
    failed=$((failed + 1))
    continue
  }
  reconciled=$((reconciled + 1))
done <"$pending_file"

stats=$(runuser -u swp_maintenance -- psql --no-psqlrc --tuples-only --no-align --field-separator=' ' --set=ON_ERROR_STOP=1 --dbname=spotify_wallpaper_deletion_ledger \
  --command="SELECT count(*), COALESCE(min(deleted_at_ms), 0), COALESCE(sum(reconciliation_attempts), 0) FROM deletion_tombstones WHERE reconciled_at_ms IS NULL")
set -- $stats
pending=${1:-0}
oldest_pending=${2:-0}
retry=${3:-0}
printf 'attempted=%s reconciled=%s failed=%s pending=%s oldest_pending=%s retry=%s\n' "$attempted" "$reconciled" "$failed" "$pending" "$oldest_pending" "$retry"
[ "$failed" -eq 0 ]
