#!/bin/sh
set -eu
umask 077

[ "$(id -u)" -eq 0 ]
case "$(node --version)" in v22.*) ;; *) exit 1 ;; esac
postgres --version | grep -Eq '^postgres \(PostgreSQL\) 17\.'
[ -d /repo/apps/public-backend/src ]
[ -d /repo/packages/shared-types/src ]

work=/tmp/swp-synthetic-e2e
pgdata=$work/pgdata
runtime=$work/runtime
public_socket=$work/run/public.sock
admin_socket=$work/run/admin.sock
upstream_pid=
backend_pid=
stage=prepare

cleanup() {
  status=$?
  [ -z "$backend_pid" ] || kill "$backend_pid" >/dev/null 2>&1 || true
  [ -z "$upstream_pid" ] || kill "$upstream_pid" >/dev/null 2>&1 || true
  runuser -u postgres -- pg_ctl -D "$pgdata" -m immediate stop >/dev/null 2>&1 || true
  [ "$status" -eq 0 ] || printf 'SYNTHETIC_E2E_STAGE_FAILED %s\n' "$stage"
}
trap cleanup EXIT HUP INT TERM

backend_environment() {
  runuser -u swp_backend -- env \
    NODE_EXTRA_CA_CERTS="$work/ca.pem" \
    SPOTIFY_MODE=synthetic_test \
    PUBLIC_SOCKET_PATH="$public_socket" \
    ADMIN_SOCKET_PATH="$admin_socket" \
    PUBLIC_BASE_URL=https://synthetic.test \
    PG_SOCKET_DIR=/run/postgresql \
    OAUTH_STATE_HMAC_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA \
    TOKEN_ENCRYPTION_KEYRING='{"integration":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA"}' \
    TOKEN_ENCRYPTION_ACTIVE_KEY_ID=integration \
    PAIRING_HMAC_KEYRING='{"integration":"CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCA"}' \
    PAIRING_HMAC_ACTIVE_KEY_ID=integration \
    SYNTHETIC_AUTHORIZE_ENDPOINT=https://127.0.0.1:9443/authorize \
    SYNTHETIC_TOKEN_ENDPOINT=https://127.0.0.1:9443/api/token \
    SYNTHETIC_PLAYBACK_ENDPOINT=https://127.0.0.1:9443/v1/me/player \
    PRIVACY_VERSION=2026-08-31 \
    EULA_VERSION=2026-08-31 \
    "$@"
}

useradd --system --no-create-home --shell /usr/sbin/nologin swp_backend
install -d -m 0755 "$work"
install -d -m 0755 \
  "$runtime" "$runtime/apps" "$runtime/apps/public-backend" \
  "$runtime/packages" "$runtime/packages/shared-types"
install -d -o swp_backend -g swp_backend -m 0700 "$work/run"
install -d -o postgres -g postgres -m 0700 "$pgdata"
install -d -o postgres -g postgres -m 0775 /run/postgresql
install -d -m 0755 /opt/spotify-wallpaper/current/app/apps/public-backend/migrations
install -d -m 0755 /usr/local/libexec/spotify-wallpaper
cp /repo/package.json /repo/package-lock.json /repo/tsconfig.base.json "$runtime/"
cp -a /repo/apps/public-backend/package.json /repo/apps/public-backend/tsconfig.json \
  /repo/apps/public-backend/src /repo/apps/public-backend/legal "$runtime/apps/public-backend/"
cp -a /repo/packages/shared-types/package.json /repo/packages/shared-types/tsconfig.json \
  /repo/packages/shared-types/src "$runtime/packages/shared-types/"
cp -a /repo/apps/public-backend/migrations/. /opt/spotify-wallpaper/current/app/apps/public-backend/migrations/
install -m 0644 /repo/deploy/public-backend/scripts/grants-*.sql /usr/local/libexec/spotify-wallpaper/
(
  cd "$runtime"
  npm ci --ignore-scripts \
    --workspace @spotify-wallpaper/public-backend \
    --workspace @spotify-wallpaper/shared-types >"$work/npm.log" 2>&1
  npm run build:shared-types >>"$work/npm.log" 2>&1
  npm run build --workspace @spotify-wallpaper/public-backend >>"$work/npm.log" 2>&1
)
chmod -R a+rX "$runtime"

stage=caddy-config
caddy validate --config /repo/deploy/public-backend/Caddyfile --adapter caddyfile \
  >/dev/null 2>&1

stage=database
runuser -u postgres -- initdb -D "$pgdata" --auth-local=trust --auth-host=reject >/dev/null
runuser -u postgres -- pg_ctl -D "$pgdata" -o "-k /run/postgresql -p 5433 -c listen_addresses=''" -w start >/dev/null
export PGHOST=/run/postgresql PGPORT=5433
runuser -u postgres -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
  --dbname=postgres --file=/repo/deploy/public-backend/postgresql/bootstrap.sql >/dev/null
PGUSER=swp_migrator sh /repo/deploy/public-backend/scripts/migrate.sh >/dev/null

stage=tls
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=swp-synthetic-ca \
  -keyout "$work/ca.key" -out "$work/ca.pem" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -subj /CN=127.0.0.1 \
  -keyout "$work/server.key" -out "$work/server.csr" >/dev/null 2>&1
printf '%s\n' 'subjectAltName=IP:127.0.0.1' >"$work/server.ext"
openssl x509 -req -days 1 -in "$work/server.csr" -CA "$work/ca.pem" \
  -CAkey "$work/ca.key" -CAcreateserial -extfile "$work/server.ext" \
  -out "$work/server.pem" >/dev/null 2>&1
chmod 0644 "$work/ca.pem"

stage=upstream
SYNTHETIC_TLS_KEY="$work/server.key" \
SYNTHETIC_TLS_CERT="$work/server.pem" \
SYNTHETIC_READY_FILE="$work/upstream.ready" \
node /repo/deploy/public-backend/test/synthetic-upstream.mjs >"$work/upstream.log" 2>&1 &
upstream_pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -f "$work/upstream.ready" ] && break
  kill -0 "$upstream_pid" 2>/dev/null || exit 1
  sleep 1
done
[ -f "$work/upstream.ready" ]

stage=backend-filesystem
runuser -u swp_backend -- test -r "$runtime/apps/public-backend/dist/src/index.js"
stage=backend-database
runuser -u swp_backend -- env PGHOST=/run/postgresql PGPORT=5433 PGUSER=swp_backend \
  psql --no-psqlrc --quiet --dbname=spotify_wallpaper --command='SELECT 1' >/dev/null
stage=backend-config
backend_environment node --input-type=module --eval \
  "const {loadConfig}=await import('file://$runtime/apps/public-backend/dist/src/config.js');loadConfig(process.env)"
stage=backend-import
backend_environment node --input-type=module --eval \
  "await import('file://$runtime/apps/public-backend/dist/src/index.js')"
stage=backend
backend_environment node "$runtime/apps/public-backend/dist/src/index.js" >"$work/backend.log" 2>&1 &
backend_pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -S "$public_socket" ] && [ -S "$admin_socket" ] && break
  kill -0 "$backend_pid" 2>/dev/null || exit 1
  sleep 1
done
[ -S "$public_socket" ] && [ -S "$admin_socket" ]

stage=protocol
runuser -u swp_backend -- env \
  NODE_EXTRA_CA_CERTS="$work/ca.pem" \
  SYNTHETIC_PUBLIC_SOCKET="$public_socket" \
  SYNTHETIC_ADMIN_SOCKET="$admin_socket" \
  node /repo/deploy/public-backend/test/synthetic-client.mjs
