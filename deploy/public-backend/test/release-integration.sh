#!/bin/sh
set -eu
umask 077

[ "$(id -u)" -eq 0 ]
case "$(node --version)" in v22.*) ;; *) exit 1 ;; esac
[ -d /repo/apps/public-backend/src ]
groupadd --system swp-public
groupadd --system swp-admin
useradd --system --no-create-home --shell /usr/sbin/nologin --groups swp-public swp_backend
useradd --system --no-create-home --shell /usr/sbin/nologin caddy
useradd --system --no-create-home --shell /usr/sbin/nologin oauth2-proxy

work=/tmp/swp-release-integration
source_tree=$work/source
first=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
second=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

cat >/usr/local/bin/systemctl <<EOF
#!/bin/sh
case "\${1:-}" in
  is-active) exit 3 ;;
  daemon-reload)
    printf '%s\\n' daemon-reload >>"$work/systemctl.log"
    [ ! -e "$work/daemon-reload.fail" ] || exit 1
    exit 0
    ;;
  *) exit 1 ;;
esac
EOF
chmod 0755 /usr/local/bin/systemctl

make_artifact() {
  release_id=$1
  output=$2
  tree=$work/artifact-$release_id
  install -d -m 0700 "$tree/apps/public-backend" "$tree/packages/shared-types"
  cp "$source_tree/package.json" "$source_tree/package-lock.json" "$tree/"
  cp "$source_tree/apps/public-backend/package.json" "$tree/apps/public-backend/"
  cp -a "$source_tree/apps/public-backend/dist" "$source_tree/apps/public-backend/migrations" \
    "$source_tree/apps/public-backend/legal" "$tree/apps/public-backend/"
  cp "$source_tree/packages/shared-types/package.json" "$tree/packages/shared-types/"
  cp -a "$source_tree/packages/shared-types/dist" "$tree/packages/shared-types/"
  printf '%s\n' "$release_id" >"$tree/RELEASE_ID"
  (cd "$tree" && find . -type f ! -name SHA256SUMS -printf '%P\0' | LC_ALL=C sort -z | xargs -0 sha256sum >SHA256SUMS)
  tar --create --gzip --file="$output" --directory="$tree" .
}

make_config_bundle() {
  release_id=$1
  output=$2
  tree=$work/config-$release_id
  install -d -m 0700 "$tree"
  cp -a /repo/deploy/public-backend/. "$tree/"
  rm -rf -- "$tree/test" "$tree/scripts/build-config-bundle.sh"
  if [ "$release_id" = "$second" ]; then
    printf '%s\n' '# release-integration-second' >>"$tree/Caddyfile"
  fi
  printf '%s\n' "$release_id" >"$tree/RELEASE_ID"
  (cd "$tree" && find . -type f ! -name CONFIG-MANIFEST.sha256 -printf '%P\0' | LC_ALL=C sort -z | xargs -0 sha256sum >CONFIG-MANIFEST.sha256)
  tar --create --gzip --file="$output" --directory="$tree" .
}

make_invalid_artifact() {
  output=$1
  tree=$work/invalid-artifact
  cp -a "$work/artifact-$first" "$tree"
  install -d -m 0700 "$tree/apps/public-backend/dist/src/extra.js"
  printf '%s\n' invalid >"$tree/apps/public-backend/dist/src/extra.js/payload.js"
  (cd "$tree" && rm -f SHA256SUMS && find . -type f ! -name SHA256SUMS -printf '%P\0' | LC_ALL=C sort -z | xargs -0 sha256sum >SHA256SUMS)
  tar --create --gzip --file="$output" --directory="$tree" .
}

install -d -m 0700 "$source_tree/apps/public-backend" "$source_tree/packages/shared-types"
cp /repo/package.json /repo/package-lock.json /repo/tsconfig.base.json "$source_tree/"
cp -a /repo/apps/public-backend/package.json /repo/apps/public-backend/tsconfig.json \
  /repo/apps/public-backend/src /repo/apps/public-backend/legal \
  /repo/apps/public-backend/migrations "$source_tree/apps/public-backend/"
cp -a /repo/packages/shared-types/package.json /repo/packages/shared-types/tsconfig.json \
  /repo/packages/shared-types/src "$source_tree/packages/shared-types/"
(
  cd "$source_tree"
  npm ci --ignore-scripts --workspace @spotify-wallpaper/public-backend \
    --workspace @spotify-wallpaper/shared-types >"$work/npm.log" 2>&1
  npm run build:shared-types >>"$work/npm.log" 2>&1
  npm run build --workspace @spotify-wallpaper/public-backend >>"$work/npm.log" 2>&1
)

make_artifact "$first" "$work/$first.tar.gz"
make_artifact "$second" "$work/$second.tar.gz"
make_config_bundle "$first" "$work/$first-config.tar.gz"
make_config_bundle "$second" "$work/$second-config.tar.gz"
make_invalid_artifact "$work/invalid.tar.gz"

if sh /repo/deploy/public-backend/scripts/release.sh deploy \
  "$work/invalid.tar.gz" "$(sha256sum "$work/invalid.tar.gz" | cut -d ' ' -f 1)" \
  "$work/$first-config.tar.gz" "$(sha256sum "$work/$first-config.tar.gz" | cut -d ' ' -f 1)" \
  "$first" >/dev/null 2>&1; then
  exit 1
fi

deploy() {
  release_id=$1
  sh /repo/deploy/public-backend/scripts/release.sh deploy \
    "$work/$release_id.tar.gz" "$(sha256sum "$work/$release_id.tar.gz" | cut -d ' ' -f 1)" \
    "$work/$release_id-config.tar.gz" "$(sha256sum "$work/$release_id-config.tar.gz" | cut -d ' ' -f 1)" \
    "$release_id" >/dev/null 2>&1
}

deploy "$first"
[ "$(stat -c %a /opt/spotify-wallpaper)" = 755 ]
[ "$(stat -c %a /opt/spotify-wallpaper/generations)" = 755 ]
[ "$(readlink /opt/spotify-wallpaper/current)" = "/opt/spotify-wallpaper/generations/$first" ]
[ "$(cat /opt/spotify-wallpaper/current/app/RELEASE_ID)" = "$first" ]
[ "$(cat /opt/spotify-wallpaper/current/config/deploy/public-backend/RELEASE_ID)" = "$first" ]
[ "$(readlink /etc/caddy/Caddyfile)" = /opt/spotify-wallpaper/current/config/deploy/public-backend/Caddyfile ]
runuser -u nobody -- test -r /opt/spotify-wallpaper/current/config/deploy/public-backend/Caddyfile
runuser -u nobody -- /usr/bin/node --input-type=module --eval \
  "await import('/opt/spotify-wallpaper/current/app/packages/shared-types/dist/index.js')"

deploy "$second"
[ "$(cat /opt/spotify-wallpaper/current/app/RELEASE_ID)" = "$second" ]
grep -q '^# release-integration-second$' /etc/caddy/Caddyfile

sh /repo/deploy/public-backend/scripts/release.sh rollback "$first" >/dev/null 2>&1
[ "$(cat /opt/spotify-wallpaper/current/app/RELEASE_ID)" = "$first" ]
! grep -q '^# release-integration-second$' /etc/caddy/Caddyfile
[ "$(wc -l <"$work/systemctl.log")" -ge 2 ]

# A failed reload must restore the previous generation and config links.
: >"$work/daemon-reload.fail"
if deploy "$second"; then
  exit 1
fi
[ "$(cat /opt/spotify-wallpaper/current/app/RELEASE_ID)" = "$first" ]
! grep -q '^# release-integration-second$' /etc/caddy/Caddyfile
rm -f -- "$work/daemon-reload.fail"

# The second generation already exists: re-deploy must resume instead of failing.
deploy "$second"
[ "$(cat /opt/spotify-wallpaper/current/app/RELEASE_ID)" = "$second" ]
[ "$(cat /opt/spotify-wallpaper/current/config/deploy/public-backend/RELEASE_ID)" = "$second" ]
sh /repo/deploy/public-backend/scripts/release.sh rollback "$first" >/dev/null 2>&1
[ "$(cat /opt/spotify-wallpaper/current/app/RELEASE_ID)" = "$first" ]
[ "$(wc -l <"$work/systemctl.log")" -ge 4 ]

printf '%s\n' RELEASE_INTEGRATION_PASS
