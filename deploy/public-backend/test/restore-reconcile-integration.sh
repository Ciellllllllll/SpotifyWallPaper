#!/bin/sh
set -eu
umask 077

# Run from the repository root with the official postgres:17 Debian image.
[ "$(id -u)" -eq 0 ]
postgres --version | grep -Eq '^postgres \(PostgreSQL\) 17\.'
[ -d /repo/deploy/public-backend ]

pgdata=/var/lib/postgresql/17/swp
pgconfig=/etc/postgresql/17/swp
backup_root=/var/backups/spotify-wallpaper
backup=
ledger_backup=
scripts=/usr/local/libexec/spotify-wallpaper
release=/opt/spotify-wallpaper/current/app/apps/public-backend/migrations
validator=$scripts/validate-database.sh
validator_real=$scripts/validate-database.real.sh

cleanup() {
  runuser -u postgres -- pg_ctl -D "$pgdata" -m immediate stop >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

groupadd --system swp-pg
usermod --append --groups swp-pg postgres
for user in swp_backend swp_migrator swp_backup swp_restore swp_maintenance; do
  useradd --system --no-create-home --shell /usr/sbin/nologin --groups swp-pg "$user"
done
install -d -m 0755 "$scripts" "$release/deletion-ledger" "$pgconfig"
install -d -m 0755 /run/spotify-wallpaper
install -d -m 0700 "$backup_root/primary" "$backup_root/ledger"
install -d -o postgres -g postgres -m 0700 "$pgdata"
install -d -o postgres -g swp-pg -m 0770 /run/postgresql
install -m 0644 /repo/deploy/public-backend/postgresql/postgresql.conf "$pgconfig/"
install -m 0644 /repo/deploy/public-backend/postgresql/pg_hba.conf "$pgconfig/"
install -m 0644 /repo/deploy/public-backend/postgresql/pg_ident.conf "$pgconfig/"
install -m 0755 /repo/deploy/public-backend/scripts/*.sh "$scripts/"
install -m 0644 /repo/deploy/public-backend/scripts/grants-*.sql "$scripts/"
install -m 0644 /repo/apps/public-backend/migrations/*.sql "$release/"
install -m 0644 /repo/apps/public-backend/migrations/deletion-ledger/*.sql "$release/deletion-ledger/"

cat >/usr/local/bin/systemctl <<'EOF'
#!/bin/sh
[ "${1:-}" = is-active ] && exit 3
exit 1
EOF
chmod 0755 /usr/local/bin/systemctl

runuser -u postgres -- initdb -D "$pgdata" --auth-local=trust --auth-host=reject >/dev/null
runuser -u postgres -- pg_ctl -D "$pgdata" \
  -o "-c config_file=$pgconfig/postgresql.conf" -w start >/dev/null
export PGHOST=/run/postgresql PGPORT=5433

[ "$(runuser -u postgres -- psql --no-psqlrc --tuples-only --no-align --dbname=postgres --command='SHOW data_directory')" = "$pgdata" ]
[ "$(runuser -u postgres -- psql --no-psqlrc --tuples-only --no-align --dbname=postgres --command='SHOW hba_file')" = "$pgconfig/pg_hba.conf" ]
[ "$(runuser -u postgres -- psql --no-psqlrc --tuples-only --no-align --dbname=postgres --command='SHOW ident_file')" = "$pgconfig/pg_ident.conf" ]
[ -z "$(runuser -u postgres -- psql --no-psqlrc --tuples-only --no-align --dbname=postgres --command='SHOW listen_addresses')" ]

runuser -u postgres -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
  --dbname=postgres --file=/repo/deploy/public-backend/postgresql/bootstrap.sql >/dev/null
runuser -u swp_migrator -- "$scripts/migrate.sh" >/dev/null
runuser -u swp_backend -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
  --dbname=spotify_wallpaper --command='SELECT 1' >/dev/null
if runuser -u swp_backend -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
  --username=swp_migrator --dbname=spotify_wallpaper --command='SELECT 1' >/dev/null 2>&1; then
  exit 1
fi

runuser -u swp_migrator -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
  --dbname=spotify_wallpaper <<'SQL'
INSERT INTO credentials (
  public_id, pairing_digest, pairing_key_id, spotify_client_id,
  refresh_authorized_at_ms, auth_status, created_at_ms, updated_at_ms
) VALUES (
  'AAAAAAAAAAAAAAAAAAAAAA',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  'integration', 'integration-client', 1, 'reauth_required', 1, 1
);
SQL
runuser -u swp_migrator -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
  --dbname=spotify_wallpaper_deletion_ledger <<'SQL'
INSERT INTO deletion_tombstones (
  public_id, deleted_at_ms, expires_at_ms, reconciled_at_ms,
  reconciliation_attempts, last_attempt_at_ms
) VALUES (
  'AAAAAAAAAAAAAAAAAAAAAA', 1700000000000, 1703024000000, 4102444800000, 7, 1700000000000
);
SQL

"$scripts/backup.sh" >/dev/null
primary_backups=$(mktemp)
ledger_backups=$(mktemp)
find "$backup_root/primary" -maxdepth 1 -type f -name 'primary-*.dump' -print >"$primary_backups"
find "$backup_root/ledger" -maxdepth 1 -type f -name 'ledger-*.dump' -print >"$ledger_backups"
[ "$(wc -l <"$primary_backups")" -eq 1 ]
[ "$(wc -l <"$ledger_backups")" -eq 1 ]
backup=$(cat "$primary_backups")
ledger_backup=$(cat "$ledger_backups")
rm -f -- "$primary_backups" "$ledger_backups"
[ -f "$backup.sha256" ]
[ -f "$ledger_backup.sha256" ]
pg_restore --list "$ledger_backup" >/dev/null

ledger_restore=spotify_wallpaper_ledger_restore_$$
runuser -u swp_restore -- createdb --template=template0 "$ledger_restore" >/dev/null
runuser -u swp_restore -- pg_restore --no-owner --no-privileges \
  --dbname="$ledger_restore" <"$ledger_backup" >/dev/null
"$scripts/validate-database.sh" "$ledger_restore" ledger restored
runuser -u swp_restore -- dropdb "$ledger_restore" >/dev/null

runuser -u postgres -- dropdb spotify_wallpaper

cp "$validator" "$validator_real"
cat >"$validator" <<'EOF'
#!/bin/sh
[ "${3:-}" = recovery ] && exit 1
exec /usr/local/libexec/spotify-wallpaper/validate-database.real.sh "$@"
EOF
chmod 0755 "$validator"
if "$scripts/restore.sh" primary-only-loss "$backup"; then
  exit 1
fi
rm -f -- "$validator"
mv -T -- "$validator_real" "$validator"
recovery_count=$(runuser -u postgres -- psql --no-psqlrc --tuples-only --no-align \
  --dbname=postgres --command="SELECT count(*) FROM pg_database WHERE datname LIKE 'spotify_wallpaper_recovery_%'")
[ "$recovery_count" = 0 ]

"$scripts/restore.sh" primary-only-loss "$backup"

credential_count=$(runuser -u swp_maintenance -- psql --no-psqlrc --tuples-only --no-align \
  --dbname=spotify_wallpaper --command='SELECT count(*) FROM credentials')
[ "$credential_count" = 0 ]
ledger_state=$(runuser -u swp_maintenance -- psql --no-psqlrc --tuples-only --no-align \
  --dbname=spotify_wallpaper_deletion_ledger \
  --command='SELECT reconciled_at_ms IS NOT NULL AND reconciliation_attempts = 8 FROM deletion_tombstones')
[ "$ledger_state" = t ]
pending=$(runuser -u swp_maintenance -- psql --no-psqlrc --tuples-only --no-align \
  --dbname=spotify_wallpaper_deletion_ledger \
  --command='SELECT count(*) FROM deletion_tombstones WHERE reconciled_at_ms IS NULL')
[ "$pending" = 0 ]
pg_restore --list "$backup" >/dev/null
printf '%s\n' RESTORE_RECONCILE_INTEGRATION_PASS
