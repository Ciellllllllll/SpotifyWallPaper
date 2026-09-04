#!/bin/sh
set -eu
umask 077

[ "$(id -u)" -eq 0 ] || exit 1
[ "$#" -eq 3 ] || exit 1
database=$1
label=$2
profile=$3
printf '%s' "$database" | grep -Eq '^[a-z][a-z0-9_]{0,62}$'
case "$label" in
  primary) aggregate="SELECT count(*) || ':' || (SELECT count(*) FROM credentials) || ':' || (SELECT count(*) FROM setup_sessions) || ':' || (SELECT count(*) FROM oauth_sessions) || ':' || (SELECT count(*) FROM callback_confirmations) || ':' || (SELECT count(*) FROM spotify_backoff) FROM schema_migrations" ;;
  ledger) aggregate="SELECT count(*) || ':' || (SELECT count(*) FROM deletion_tombstones) FROM schema_migrations" ;;
  *) exit 1 ;;
esac
case "$profile" in restored|live|recovery) ;; *) exit 1 ;; esac
actual_user=swp_restore
case "$profile" in
  live) actual_user=swp_maintenance ;;
  recovery) actual_user=postgres ;;
esac

export PGHOST=/run/postgresql PGPORT=5433
script_directory=/usr/local/libexec/spotify-wallpaper
migration_directory=/opt/spotify-wallpaper/current/app/apps/public-backend/migrations
[ "$label" = primary ] || migration_directory=$migration_directory/deletion-ledger
expected_database="swp_expected_${label}_$$"
expected_created=false
actual_raw=
expected_raw=
actual_schema=
expected_schema=

cleanup() {
  trap '' HUP INT TERM
  trap - EXIT
  rm -f -- "$actual_raw" "$expected_raw" "$actual_schema" "$expected_schema"
  if [ "$expected_created" = true ]; then
    runuser -u swp_restore -- dropdb --if-exists "$expected_database" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 143' HUP INT TERM

trap '' HUP INT TERM
runuser -u swp_restore -- createdb --template=template0 "$expected_database" >/dev/null
expected_created=true
trap 'exit 143' HUP INT TERM
for migration in "$migration_directory"/*.sql; do
  [ -f "$migration" ] || exit 1
  version=${migration##*/}
  version=${version%.sql}
  printf '%s' "$version" | grep -Eq '^[0-9]{4}_[a-z0-9_]+$'
  runuser -u swp_restore -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
    --dbname="$expected_database" --file="$migration" >/dev/null
done
if [ "$profile" != restored ]; then
  runuser -u swp_restore -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
    --dbname="$expected_database" --file="$script_directory/grants-$label.sql" >/dev/null
fi

actual_versions=$(runuser -u "$actual_user" -- psql --no-psqlrc --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 --dbname="$database" \
  --command="SELECT COALESCE(string_agg(version, ',' ORDER BY version), '') FROM schema_migrations")
expected_versions=$(runuser -u swp_restore -- psql --no-psqlrc --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 --dbname="$expected_database" \
  --command="SELECT COALESCE(string_agg(version, ',' ORDER BY version), '') FROM schema_migrations")
[ -n "$actual_versions" ]
[ "$actual_versions" = "$expected_versions" ]

actual_raw=$(mktemp "/var/backups/spotify-wallpaper/.${label}-actual-raw.XXXXXX")
expected_raw=$(mktemp "/var/backups/spotify-wallpaper/.${label}-expected-raw.XXXXXX")
actual_schema=$(mktemp "/var/backups/spotify-wallpaper/.${label}-actual-schema.XXXXXX")
expected_schema=$(mktemp "/var/backups/spotify-wallpaper/.${label}-expected-schema.XXXXXX")
runuser -u "$actual_user" -- pg_dump --schema-only --no-owner --dbname="$database" >"$actual_raw"
runuser -u swp_restore -- pg_dump --schema-only --no-owner --dbname="$expected_database" >"$expected_raw"
sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
  -e '/^-- Dumped from database version /d' -e '/^-- Dumped by pg_dump version /d' \
  "$actual_raw" >"$actual_schema"
sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
  -e '/^-- Dumped from database version /d' -e '/^-- Dumped by pg_dump version /d' \
  "$expected_raw" >"$expected_schema"
cmp --silent "$actual_schema" "$expected_schema"

privileges=$(runuser -u "$actual_user" -- psql --no-psqlrc --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 --dbname="$database" --command="
    SELECT NOT EXISTS (
      SELECT 1 FROM pg_class AS object
      JOIN pg_namespace AS namespace ON namespace.oid = object.relnamespace
      CROSS JOIN LATERAL aclexplode(object.relacl) AS privilege
      WHERE namespace.nspname = 'public' AND privilege.grantee = 0
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_namespace AS namespace
      CROSS JOIN LATERAL aclexplode(COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))) AS privilege
      WHERE namespace.nspname = 'public' AND privilege.grantee = 0 AND privilege.privilege_type = 'CREATE'
    );")
[ "$privileges" = t ]

role_security=$(runuser -u postgres -- psql --no-psqlrc --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 --dbname=postgres --command="
    SELECT count(*) = 5
      AND bool_and(rolcanlogin)
      AND bool_and(NOT rolsuper)
      AND bool_and(NOT rolinherit)
      AND bool_and(rolcreatedb = (rolname = 'swp_restore'))
      AND bool_and(NOT rolcreaterole)
      AND bool_and(NOT rolreplication)
      AND bool_and(NOT rolbypassrls)
      AND bool_and(rolconnlimit = -1)
      AND bool_and(rolpassword IS NULL)
    FROM pg_authid
    WHERE rolname IN (
      'swp_backend', 'swp_migrator', 'swp_backup', 'swp_restore', 'swp_maintenance'
    );")
[ "$role_security" = t ]

membership_security=$(runuser -u postgres -- psql --no-psqlrc --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 --dbname=postgres --command="
    SELECT NOT EXISTS (
      SELECT 1
      FROM pg_auth_members AS membership
      JOIN pg_roles AS member ON member.oid = membership.member
      WHERE member.rolname IN (
        'swp_backend', 'swp_migrator', 'swp_backup', 'swp_restore', 'swp_maintenance'
      )
    );")
[ "$membership_security" = t ]

if [ "$profile" != restored ]; then
  database_security=$(runuser -u "$actual_user" -- psql --no-psqlrc --tuples-only --no-align \
    --set=ON_ERROR_STOP=1 --dbname="$database" --command="
      SELECT database.owner = 'swp_migrator'
        AND NOT EXISTS (
          SELECT 1 FROM pg_class AS object
          JOIN pg_namespace AS namespace ON namespace.oid = object.relnamespace
          WHERE namespace.nspname = 'public' AND object.relowner <> database.datdba
        )
        AND (
          SELECT string_agg(
            COALESCE(grantee.rolname, 'PUBLIC') || ':' || database_acl.privilege_type || ':' || database_acl.is_grantable,
            ',' ORDER BY COALESCE(grantee.rolname, 'PUBLIC'), database_acl.privilege_type
          )
          FROM aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) AS database_acl
          LEFT JOIN pg_roles AS grantee ON grantee.oid = database_acl.grantee
        ) = 'swp_backend:CONNECT:false,swp_backup:CONNECT:false,swp_maintenance:CONNECT:false,swp_migrator:CONNECT:false,swp_migrator:CREATE:false,swp_migrator:TEMPORARY:false,swp_restore:CONNECT:false'
      FROM (
        SELECT target.datdba, target.datacl, owner.rolname AS owner
        FROM pg_database AS target
        JOIN pg_roles AS owner ON owner.oid = target.datdba
        WHERE target.datname = current_database()
      ) AS database;")
  [ "$database_security" = t ]
fi

counts=$(runuser -u "$actual_user" -- psql --no-psqlrc --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 --dbname="$database" --command="$aggregate")
printf '%s' "$counts" | grep -Eq '^[0-9]+(:[0-9]+)+$'

trap '' HUP INT TERM
runuser -u swp_restore -- dropdb "$expected_database" >/dev/null
expected_created=false
trap 'exit 143' HUP INT TERM
printf 'database_validation_ok %s\n' "$label"
