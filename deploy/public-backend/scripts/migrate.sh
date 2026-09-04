#!/bin/sh
set -eu

export PGHOST=/run/postgresql PGPORT=5433 PGUSER=swp_migrator
release=/opt/spotify-wallpaper/current/app/apps/public-backend/migrations
script_directory=/usr/local/libexec/spotify-wallpaper

run_stream() {
  database=$1
  directory=$2
  lock_key=$3
  batch=$(mktemp)
  trap 'rm -f -- "$batch"' EXIT HUP INT TERM

  {
    printf '%s\n' '\set ON_ERROR_STOP on'
    printf 'SELECT pg_advisory_lock(1937072752, %s);\n' "$lock_key"
    for migration in "$directory"/*.sql; do
      [ -f "$migration" ] || exit 1
      version=${migration##*/}
      version=${version%.sql}
      printf '%s' "$version" | grep -Eq '^[0-9]{4}_[a-z0-9_]+$' || exit 1
      printf "\\set migration_version '%s'\n" "$version"
      printf '%s\n' "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS has_table \\gset"
      printf '%s\n' '\if :has_table'
      printf '%s\n' "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = :'migration_version') AS already_applied \\gset"
      printf '%s\n' '\else' '\set already_applied false' '\endif'
      printf '%s\n' '\if :already_applied' '\else'
      printf '\\i %s\n' "$migration"
      printf '%s\n' "SELECT count(*) = 1 AS migration_recorded FROM schema_migrations WHERE version = :'migration_version' \\gset"
      printf '%s\n' '\if :migration_recorded' '\else' '\quit 3' '\endif' '\endif'
    done
    printf 'SELECT pg_advisory_unlock(1937072752, %s);\n' "$lock_key"
  } >"$batch"

  psql --no-psqlrc --quiet --dbname="$database" --set=ON_ERROR_STOP=1 --file="$batch" >/dev/null
  rm -f -- "$batch"
  trap - EXIT HUP INT TERM
  printf 'migration_ok %s\n' "$database"
}

run_stream spotify_wallpaper "$release" 1886151024
run_stream spotify_wallpaper_deletion_ledger "$release/deletion-ledger" 1684368750

psql --no-psqlrc --quiet --dbname=spotify_wallpaper --set=ON_ERROR_STOP=1 \
  --file="$script_directory/grants-primary.sql" >/dev/null
psql --no-psqlrc --quiet --dbname=spotify_wallpaper_deletion_ledger --set=ON_ERROR_STOP=1 \
  --file="$script_directory/grants-ledger.sql" >/dev/null
