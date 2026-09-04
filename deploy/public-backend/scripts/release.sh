#!/bin/sh
set -eu
umask 077

[ "$(id -u)" -eq 0 ] || exit 1
root=/opt/spotify-wallpaper
generations=$root/generations
config_source=$root/current/config/deploy/public-backend
self_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
preflight=$self_directory/preflight.sh

ensure_root_directory() {
  path=$1
  if [ -L "$path" ]; then
    return 1
  fi
  if [ -e "$path" ]; then
    [ -d "$path" ] || return 1
    [ "$(stat -c %u -- "$path")" -eq 0 ] || return 1
    chmod 0755 -- "$path"
  else
    install -d -o root -g root -m 0755 -- "$path"
  fi
}

config_files() {
  cat <<'EOF'
Caddyfile
CONFIG-MANIFEST.sha256
RELEASE_ID
environment/oauth2-proxy.env.example
environment/public-backend.env.example
oauth2-proxy.cfg
postgresql/bootstrap.sql
postgresql/pg_hba.conf
postgresql/pg_ident.conf
postgresql/postgresql.conf
scripts/backup.sh
scripts/grants-ledger.sql
scripts/grants-primary.sql
scripts/install-oauth2-proxy.sh
scripts/migrate.sh
scripts/monitor.sh
scripts/preflight.sh
scripts/reconcile.sh
scripts/release.sh
scripts/restore.sh
scripts/validate-database.sh
scripts/verify-authorization-boundary.sh
systemd/swp-backup.service
systemd/swp-backup.timer
systemd/swp-caddy.service
systemd/swp-migrate.service
systemd/swp-monitor.service
systemd/swp-monitor.timer
systemd/swp-oauth2-proxy.service
systemd/swp-public-backend.service
systemd/swp-reconcile.service
systemd/swp-reconcile.timer
sysusers.d/spotify-wallpaper.conf
tmpfiles.d/spotify-wallpaper.conf
EOF
}

config_link() {
  target=$1
  source=$config_source/$2
  if [ -L "$target" ]; then
    [ "$(readlink -- "$target")" = "$source" ] || return 1
    [ "${config_link_mode:-install}" = remove ] || return 0
    rm -f -- "$target"
    return
  fi
  [ ! -e "$target" ] || return 1
  [ "${config_link_mode:-install}" = check ] && return
  [ "${config_link_mode:-install}" = remove ] && return
  install -d -m 0755 -- "${target%/*}"
  ln -s -- "$source" "$target"
}

install_config_links() {
  config_link /etc/caddy/Caddyfile Caddyfile || return 1
  config_link /etc/spotify-wallpaper/oauth2-proxy.cfg oauth2-proxy.cfg || return 1
  config_link /etc/postgresql/17/swp/postgresql.conf postgresql/postgresql.conf || return 1
  config_link /etc/postgresql/17/swp/pg_hba.conf postgresql/pg_hba.conf || return 1
  config_link /etc/postgresql/17/swp/pg_ident.conf postgresql/pg_ident.conf || return 1
  config_link /etc/tmpfiles.d/spotify-wallpaper.conf tmpfiles.d/spotify-wallpaper.conf || return 1
  config_link /etc/sysusers.d/spotify-wallpaper.conf sysusers.d/spotify-wallpaper.conf || return 1
  config_link /usr/local/libexec/spotify-wallpaper/bootstrap.sql postgresql/bootstrap.sql || return 1
  for name in \
    swp-backup.service swp-backup.timer swp-caddy.service swp-migrate.service \
    swp-monitor.service swp-monitor.timer swp-oauth2-proxy.service \
    swp-public-backend.service swp-reconcile.service swp-reconcile.timer
  do
    config_link "/etc/systemd/system/$name" "systemd/$name" || return 1
  done
  for name in \
    backup.sh grants-ledger.sql grants-primary.sql install-oauth2-proxy.sh \
    migrate.sh monitor.sh preflight.sh reconcile.sh release.sh restore.sh \
    validate-database.sh verify-authorization-boundary.sh
  do
    config_link "/usr/local/libexec/spotify-wallpaper/$name" "scripts/$name" || return 1
  done
}

check_config_links() {
  config_link_mode=check
  if install_config_links; then
    status=0
  else
    status=$?
  fi
  unset config_link_mode
  return "$status"
}

remove_config_links() {
  config_link_mode=remove
  if install_config_links; then
    status=0
  else
    status=$?
  fi
  unset config_link_mode
  return "$status"
}

valid_release_id() {
  value=$1
  [ "${#value}" -eq 40 ] || return 1
  case "$value" in *[!0-9a-f]*) return 1 ;; esac
}

verify_checksum() {
  file=$1
  expected=$2
  [ "${#expected}" -eq 64 ] || return 1
  case "$expected" in *[!0-9a-f]*) return 1 ;; esac
  line=$(sha256sum -- "$file") || return 1
  actual=${line%% *}
  [ "${#actual}" -eq 64 ] || return 1
  case "$actual" in *[!0-9a-f]*) return 1 ;; esac
  [ "$actual" = "$expected" ]
}

assert_no_find_matches() {
  matches=$(mktemp)
  if ! find "$@" -print -quit >"$matches"; then
    rm -f -- "$matches"
    return 1
  fi
  status=0
  [ ! -s "$matches" ] || status=1
  rm -f -- "$matches"
  return "$status"
}

validate_archive() {
  archive=$1
  members=$(mktemp)
  verbose=$(mktemp)
  status=0
  if ! tar --list --file="$archive" >"$members"; then
    status=1
  else
    while IFS= read -r member; do
      case "$member" in ''|/*|../*|*/../*|*/..) status=1; break ;; esac
    done <"$members"
  fi
  if [ "$status" -eq 0 ] && ! tar --list --verbose --file="$archive" >"$verbose"; then
    status=1
  fi
  if [ "$status" -eq 0 ]; then
    awk 'substr($1,1,1) !~ /[-d]/ { exit 1 }' "$verbose" || status=1
  fi
  rm -f -- "$members" "$verbose"
  [ "$status" -eq 0 ]
}

source_path_allowed() {
  path=$1
  case "$path" in
    ./SHA256SUMS|./RELEASE_ID|./package.json|./package-lock.json|./apps|./apps/public-backend|./apps/public-backend/package.json|./apps/public-backend/dist|./apps/public-backend/dist/src|./apps/public-backend/dist/legal|./apps/public-backend/migrations|./apps/public-backend/migrations/deletion-ledger|./apps/public-backend/legal|./packages|./packages/shared-types|./packages/shared-types/package.json|./packages/shared-types/dist)
      return 0
      ;;
    ./apps/public-backend/dist/src/*.js|./apps/public-backend/dist/src/*.d.ts)
      name=${path##*/}
      [ "$path" = "./apps/public-backend/dist/src/$name" ]
      ;;
    ./apps/public-backend/dist/legal/*.md)
      name=${path##*/}
      [ "$path" = "./apps/public-backend/dist/legal/$name" ]
      ;;
    ./apps/public-backend/migrations/*.sql)
      name=${path##*/}
      [ "$path" = "./apps/public-backend/migrations/$name" ]
      ;;
    ./apps/public-backend/migrations/deletion-ledger/*.sql)
      name=${path##*/}
      [ "$path" = "./apps/public-backend/migrations/deletion-ledger/$name" ]
      ;;
    ./apps/public-backend/legal/*.md)
      name=${path##*/}
      [ "$path" = "./apps/public-backend/legal/$name" ]
      ;;
    ./packages/shared-types/dist/*.js|./packages/shared-types/dist/*.d.ts)
      name=${path##*/}
      [ "$path" = "./packages/shared-types/dist/$name" ]
      ;;
    *)
      return 1
      ;;
  esac
}

validate_source_tree() {
  tree=$1
  [ -f "$tree/package.json" ] && [ -f "$tree/package-lock.json" ]
  [ -f "$tree/SHA256SUMS" ] && [ -f "$tree/RELEASE_ID" ]
  valid_release_id "$(cat "$tree/RELEASE_ID")"
  [ -f "$tree/apps/public-backend/package.json" ]
  [ -d "$tree/apps/public-backend/dist" ]
  [ -d "$tree/apps/public-backend/dist/src" ]
  [ -d "$tree/apps/public-backend/dist/legal" ]
  [ -d "$tree/apps/public-backend/migrations" ]
  [ -d "$tree/apps/public-backend/migrations/deletion-ledger" ]
  [ -d "$tree/apps/public-backend/legal" ]
  [ -f "$tree/packages/shared-types/package.json" ]
  [ -d "$tree/packages/shared-types/dist" ]
  assert_no_find_matches "$tree" -type l
  assert_no_find_matches "$tree" -type f -name '*.map'
  assert_no_find_matches "$tree" -type f -name '*.ts' ! -name '*.d.ts'
  assert_no_find_matches "$tree/apps/public-backend/dist/src" -mindepth 1 -maxdepth 1 ! -type f
  assert_no_find_matches "$tree/apps/public-backend/dist/legal" -mindepth 1 -maxdepth 1 ! -type f
  assert_no_find_matches "$tree/apps/public-backend/migrations" -mindepth 1 -maxdepth 1 ! -type f ! -path "$tree/apps/public-backend/migrations/deletion-ledger"
  assert_no_find_matches "$tree/apps/public-backend/migrations/deletion-ledger" -mindepth 1 -maxdepth 1 ! -type f
  assert_no_find_matches "$tree/apps/public-backend/legal" -mindepth 1 -maxdepth 1 ! -type f
  assert_no_find_matches "$tree/packages/shared-types/dist" -mindepth 1 -maxdepth 1 ! -type f

  paths=$(mktemp)
  if ! (cd "$tree" && find . -mindepth 1 -print) >"$paths"; then
    rm -f -- "$paths"
    return 1
  fi
  status=0
  while IFS= read -r path; do
    source_path_allowed "$path" || { status=1; break; }
  done <"$paths"
  rm -f -- "$paths"
  [ "$status" -eq 0 ] || return 1
  (cd "$tree" && sha256sum --check --strict SHA256SUMS >/dev/null)
}

smoke_locked_tree() {
  tree=$1
  runtime_root=/run/spotify-wallpaper
  public_directory=$runtime_root/public
  admin_directory=$runtime_root/admin
  public_socket=/run/spotify-wallpaper/public/public.sock
  admin_socket=/run/spotify-wallpaper/admin/admin.sock
  created_root=false
  created_public=false
  created_admin=false
  cleanup_done=false
  backend_pid=
  cleanup_smoke() {
    [ "$cleanup_done" = true ] && return 0
    cleanup_done=true
    if [ -n "$backend_pid" ]; then
      kill "$backend_pid" 2>/dev/null || true
      wait "$backend_pid" 2>/dev/null || true
    fi
    rm -f -- "$public_socket" "$admin_socket"
    [ "$created_public" != true ] || rmdir -- "$public_directory"
    [ "$created_admin" != true ] || rmdir -- "$admin_directory"
    [ "$created_root" != true ] || rmdir -- "$runtime_root"
  }
  if [ -L "$runtime_root" ] || {
    [ -e "$runtime_root" ] && [ ! -d "$runtime_root" ]
  }; then
    return 1
  fi
  if [ -L "$public_directory" ] || {
    [ -e "$public_directory" ] && [ ! -d "$public_directory" ]
  }; then
    return 1
  fi
  if [ -L "$admin_directory" ] || {
    [ -e "$admin_directory" ] && [ ! -d "$admin_directory" ]
  }; then
    return 1
  fi
  if [ -e "$public_socket" ] || [ -L "$public_socket" ] ||
    [ -e "$admin_socket" ] || [ -L "$admin_socket" ]; then
    return 1
  fi
  trap 'cleanup_smoke; cleanup_incoming' EXIT
  trap 'cleanup_smoke; exit 143' HUP INT TERM
  if [ ! -e "$runtime_root" ]; then
    install -d -o root -g root -m 0755 -- "$runtime_root"
    created_root=true
  fi
  [ "$(stat -c '%U:%G:%a' "$runtime_root")" = root:root:755 ] || {
    cleanup_smoke
    return 1
  }
  if [ ! -e "$public_directory" ]; then
    install -d -o swp_backend -g swp-public -m 2770 -- "$public_directory"
    created_public=true
  fi
  if [ ! -e "$admin_directory" ]; then
    install -d -o swp_backend -g swp-admin -m 2770 -- "$admin_directory"
    created_admin=true
  fi
  [ "$(stat -c '%U:%G:%a' "$public_directory")" = swp_backend:swp-public:2770 ] || {
    cleanup_smoke
    return 1
  }
  [ "$(stat -c '%U:%G:%a' "$admin_directory")" = swp_backend:swp-admin:2770 ] || {
    cleanup_smoke
    return 1
  }
  runuser -u swp_backend -- env \
    SPOTIFY_MODE=policy_locked \
    PUBLIC_SOCKET_PATH="$public_socket" \
    ADMIN_SOCKET_PATH="$admin_socket" \
    /usr/bin/node "$tree/apps/public-backend/dist/src/index.js" \
    >/dev/null 2>&1 &
  backend_pid=$!
  ready=false
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if [ -S "$public_socket" ] && [ -S "$admin_socket" ]; then ready=true; break; fi
    kill -0 "$backend_pid" 2>/dev/null || break
    sleep 1
  done
  if [ "$ready" != true ] || ! curl --silent --fail --unix-socket "$public_socket" http://localhost/health >/dev/null 2>&1; then
    kill "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
    cleanup_smoke
    return 1
  fi
  kill "$backend_pid" 2>/dev/null || true
  wait "$backend_pid" 2>/dev/null || true
  cleanup_smoke
}

materialize_workspace_link() {
  tree=$1
  public_link=$tree/node_modules/@spotify-wallpaper/public-backend
  [ -L "$public_link" ]
  [ "$(realpath -- "$public_link")" = "$tree/apps/public-backend" ]
  rm -f -- "$public_link"

  link=$tree/node_modules/@spotify-wallpaper/shared-types
  [ -L "$link" ]
  target=$(realpath -- "$link")
  [ "$target" = "$tree/packages/shared-types" ]
  copy=$tree/node_modules/@spotify-wallpaper/.shared-types-copy
  cp -aL -- "$target" "$copy"
  rm -f -- "$link"
  mv -- "$copy" "$link"
}

write_runtime_manifest() {
  tree=$1
  files=$(mktemp)
  sorted_files=$(mktemp)
  if ! (cd "$tree" && find . -type f ! -name RUNTIME-MANIFEST.sha256 -print0) >"$files"; then
    rm -f -- "$files" "$sorted_files"
    return 1
  fi
  if ! LC_ALL=C sort -z "$files" >"$sorted_files"; then
    rm -f -- "$files" "$sorted_files"
    return 1
  fi
  [ -s "$sorted_files" ] || {
    rm -f -- "$files" "$sorted_files"
    return 1
  }
  if ! (cd "$tree" && xargs -0 sha256sum <"$sorted_files" >RUNTIME-MANIFEST.sha256); then
    rm -f -- "$files" "$sorted_files"
    return 1
  fi
  rm -f -- "$files" "$sorted_files"
  (cd "$tree" && sha256sum --check RUNTIME-MANIFEST.sha256 >/dev/null)
}

verify_runtime_manifest() {
  tree=$1
  listed=$(mktemp)
  sorted_listed=$(mktemp)
  actual=$(mktemp)
  sorted_actual=$(mktemp)
  if ! (cd "$tree" && cut -c67- RUNTIME-MANIFEST.sha256) >"$listed"; then
    rm -f -- "$listed" "$sorted_listed" "$actual" "$sorted_actual"
    return 1
  fi
  if ! LC_ALL=C sort "$listed" >"$sorted_listed"; then
    rm -f -- "$listed" "$sorted_listed" "$actual" "$sorted_actual"
    return 1
  fi
  if ! (cd "$tree" && find . -type f ! -name RUNTIME-MANIFEST.sha256 -print) >"$actual"; then
    rm -f -- "$listed" "$sorted_listed" "$actual" "$sorted_actual"
    return 1
  fi
  if ! LC_ALL=C sort "$actual" >"$sorted_actual"; then
    rm -f -- "$listed" "$sorted_listed" "$actual" "$sorted_actual"
    return 1
  fi
  if cmp -s "$sorted_listed" "$sorted_actual"; then
    status=0
  else
    status=1
  fi
  rm -f -- "$listed" "$sorted_listed" "$actual" "$sorted_actual"
  return "$status"
}

verify_release_tree() {
  tree=$1
  [ -d "$tree/node_modules" ] && [ -f "$tree/RUNTIME-MANIFEST.sha256" ]
  (cd "$tree" && sha256sum --check RUNTIME-MANIFEST.sha256 >/dev/null)
  assert_no_find_matches "$tree" -perm /0222
  verify_runtime_manifest "$tree"
}

verify_config_tree() {
  tree=$1
  release_id=$2
  [ -d "$tree" ] && [ "$(cat "$tree/RELEASE_ID")" = "$release_id" ]
  [ -f "$tree/CONFIG-MANIFEST.sha256" ]
  assert_no_find_matches "$tree" -type l
  assert_no_find_matches "$tree" -mindepth 1 ! -type f ! -type d
  assert_no_find_matches "$tree" -mindepth 1 -type d -empty
  expected_paths=$(mktemp)
  sorted_expected_paths=$(mktemp)
  actual_paths=$(mktemp)
  sorted_actual_paths=$(mktemp)
  expected_manifest_paths=$(mktemp)
  sorted_expected_manifest_paths=$(mktemp)
  actual_manifest_paths=$(mktemp)
  sorted_actual_manifest_paths=$(mktemp)
  if ! config_files >"$expected_paths"; then
    rm -f -- "$expected_paths" "$sorted_expected_paths" "$actual_paths" "$sorted_actual_paths" "$expected_manifest_paths" "$sorted_expected_manifest_paths" "$actual_manifest_paths" "$sorted_actual_manifest_paths"
    return 1
  fi
  if ! LC_ALL=C sort "$expected_paths" >"$sorted_expected_paths"; then
    rm -f -- "$expected_paths" "$sorted_expected_paths" "$actual_paths" "$sorted_actual_paths" "$expected_manifest_paths" "$sorted_expected_manifest_paths" "$actual_manifest_paths" "$sorted_actual_manifest_paths"
    return 1
  fi
  if ! (cd "$tree" && find . -type f -printf '%P\n') >"$actual_paths"; then
    rm -f -- "$expected_paths" "$sorted_expected_paths" "$actual_paths" "$sorted_actual_paths" "$expected_manifest_paths" "$sorted_expected_manifest_paths" "$actual_manifest_paths" "$sorted_actual_manifest_paths"
    return 1
  fi
  if ! LC_ALL=C sort "$actual_paths" >"$sorted_actual_paths"; then
    rm -f -- "$expected_paths" "$sorted_expected_paths" "$actual_paths" "$sorted_actual_paths" "$expected_manifest_paths" "$sorted_expected_manifest_paths" "$actual_manifest_paths" "$sorted_actual_manifest_paths"
    return 1
  fi
  if ! cmp -s "$sorted_expected_paths" "$sorted_actual_paths"; then
    rm -f -- "$expected_paths" "$sorted_expected_paths" "$actual_paths" "$sorted_actual_paths" "$expected_manifest_paths" "$sorted_expected_manifest_paths" "$actual_manifest_paths" "$sorted_actual_manifest_paths"
    return 1
  fi
  if ! grep -v '^CONFIG-MANIFEST\.sha256$' "$expected_paths" >"$expected_manifest_paths"; then
    rm -f -- "$expected_paths" "$sorted_expected_paths" "$actual_paths" "$sorted_actual_paths" "$expected_manifest_paths" "$sorted_expected_manifest_paths" "$actual_manifest_paths" "$sorted_actual_manifest_paths"
    return 1
  fi
  if ! LC_ALL=C sort "$expected_manifest_paths" >"$sorted_expected_manifest_paths"; then
    rm -f -- "$expected_paths" "$sorted_expected_paths" "$actual_paths" "$sorted_actual_paths" "$expected_manifest_paths" "$sorted_expected_manifest_paths" "$actual_manifest_paths" "$sorted_actual_manifest_paths"
    return 1
  fi
  if ! cut -c67- "$tree/CONFIG-MANIFEST.sha256" >"$actual_manifest_paths"; then
    rm -f -- "$expected_paths" "$sorted_expected_paths" "$actual_paths" "$sorted_actual_paths" "$expected_manifest_paths" "$sorted_expected_manifest_paths" "$actual_manifest_paths" "$sorted_actual_manifest_paths"
    return 1
  fi
  if ! LC_ALL=C sort "$actual_manifest_paths" >"$sorted_actual_manifest_paths"; then
    rm -f -- "$expected_paths" "$sorted_expected_paths" "$actual_paths" "$sorted_actual_paths" "$expected_manifest_paths" "$sorted_expected_manifest_paths" "$actual_manifest_paths" "$sorted_actual_manifest_paths"
    return 1
  fi
  if ! cmp -s "$sorted_expected_manifest_paths" "$sorted_actual_manifest_paths"; then
    rm -f -- "$expected_paths" "$sorted_expected_paths" "$actual_paths" "$sorted_actual_paths" "$expected_manifest_paths" "$sorted_expected_manifest_paths" "$actual_manifest_paths" "$sorted_actual_manifest_paths"
    return 1
  fi
  rm -f -- "$expected_paths" "$sorted_expected_paths" "$actual_paths" "$sorted_actual_paths" "$expected_manifest_paths" "$sorted_expected_manifest_paths" "$actual_manifest_paths" "$sorted_actual_manifest_paths"
  (cd "$tree" && sha256sum --check --strict CONFIG-MANIFEST.sha256 >/dev/null)
}

verify_generation() {
  generation=$1
  release_id=$2
  [ -d "$generation" ] && [ ! -L "$generation" ]
  [ "$(cat "$generation/app/RELEASE_ID")" = "$release_id" ]
  verify_release_tree "$generation/app"
  verify_config_tree "$generation/config/deploy/public-backend" "$release_id"
  assert_no_find_matches "$generation" -perm /0222
}

prepare_generation() {
  artifact=$1
  config_bundle=$2
  release_id=$3
  generation=$generations/$release_id
  if [ -e "$generation" ]; then
    verify_generation "$generation" "$release_id"
    return
  fi

  incoming=$(mktemp -d "$generations/.incoming-$release_id.XXXXXX")
  cleanup_incoming() { rm -rf -- "$incoming"; }
  trap cleanup_incoming EXIT HUP INT TERM
  app=$incoming/app
  config=$incoming/config/deploy/public-backend
  mkdir -p -- "$app" "$config"
  tar --extract --file="$config_bundle" --directory="$config" --no-same-owner --no-same-permissions
  verify_config_tree "$config" "$release_id"
  chmod 0755 -- "$config"/scripts/*.sh
  tar --extract --file="$artifact" --directory="$app" --no-same-owner --no-same-permissions
  validate_source_tree "$app"
  [ "$(cat "$app/RELEASE_ID")" = "$release_id" ]
  (
    cd "$app"
    npm ci --omit=dev --ignore-scripts --workspace @spotify-wallpaper/public-backend --workspace @spotify-wallpaper/shared-types
    /usr/bin/node --input-type=module --eval "await import('@spotify-wallpaper/shared-types')"
  ) >/dev/null
  materialize_workspace_link "$app"
  assert_no_find_matches "$app" -type l
  chmod a+rx -- "$incoming"
  chmod -R a+rX -- "$app"
  systemd-sysusers "$config/sysusers.d/spotify-wallpaper.conf"
  systemd-tmpfiles --create "$config/tmpfiles.d/spotify-wallpaper.conf"
  smoke_locked_tree "$app"
  trap cleanup_incoming EXIT HUP INT TERM
  write_runtime_manifest "$app"

  chmod -R a+rX -- "$incoming"
  chmod -R a-w -- "$incoming"
  verify_generation "$incoming" "$release_id"
  mv -T -- "$incoming" "$generation"
  trap - EXIT HUP INT TERM
}

promote_generation() {
  release_id=$1
  generation=$generations/$release_id
  verify_generation "$generation" "$release_id"
  if [ -e "$root/current" ] && [ ! -L "$root/current" ]; then
    return 1
  fi
  previous_target=
  previous_current=false
  if [ -L "$root/current" ]; then
    previous_target=$(readlink -- "$root/current")
    case "$previous_target" in "$generations"/*) ;; *) return 1 ;; esac
    previous_release_id=${previous_target##*/}
    valid_release_id "$previous_release_id"
    [ "$previous_target" = "$generations/$previous_release_id" ]
    verify_generation "$previous_target" "$previous_release_id"
    previous_current=true
  fi

  trap '' HUP INT TERM
  promotion_status=0
  link=
  rollback_link=
  if install_config_links; then
    promotion_status=0
  else
    promotion_status=$?
  fi
  if [ "$promotion_status" -eq 0 ]; then
    link=$root/.current-$release_id-$$
    ln -s -- "$generation" "$link" || promotion_status=$?
  fi
  if [ "$promotion_status" -eq 0 ]; then
    mv -T -- "$link" "$root/current" || promotion_status=$?
  fi
  if [ "$promotion_status" -eq 0 ]; then
    check_config_links || promotion_status=$?
  fi
  if [ "$promotion_status" -eq 0 ]; then
    systemctl daemon-reload || promotion_status=$?
  fi
  if [ "$promotion_status" -eq 0 ]; then
    trap 'exit 143' HUP INT TERM
    return 0
  fi

  [ -z "$link" ] || rm -f -- "$link" || true
  if [ "$previous_current" = true ]; then
    rollback_link=$root/.current-rollback-$$
    if ln -s -- "$previous_target" "$rollback_link" &&
      mv -T -- "$rollback_link" "$root/current" &&
      check_config_links
    then
      systemctl daemon-reload || true
    else
      rm -f -- "$rollback_link" || true
    fi
  else
    rm -f -- "$root/current" || true
    remove_config_links || true
  fi
  trap 'exit 143' HUP INT TERM
  return "$promotion_status"
}

deploy_release() {
  [ "$#" -eq 5 ] || exit 1
  artifact=$1
  artifact_sha=$2
  config_bundle=$3
  config_sha=$4
  release_id=$5
  valid_release_id "$release_id"
  verify_checksum "$artifact" "$artifact_sha"
  verify_checksum "$config_bundle" "$config_sha"
  validate_archive "$artifact"
  validate_archive "$config_bundle"
  ensure_root_directory "$root"
  ensure_root_directory "$generations"
  check_config_links
  /bin/sh "$preflight" node
  prepare_generation "$artifact" "$config_bundle" "$release_id"
  promote_generation "$release_id"
  printf 'release_promoted %s\n' "$release_id"
}

rollback_release() {
  [ "$#" -eq 1 ] || exit 1
  release_id=$1
  valid_release_id "$release_id"
  ensure_root_directory "$root"
  ensure_root_directory "$generations"
  check_config_links
  /bin/sh "$preflight" node
  promote_generation "$release_id"
  printf 'release_rolled_back %s\n' "$release_id"
}

install_config_links_only() {
  [ "$#" -eq 0 ] || exit 1
  target=$(realpath -- "$root/current")
  release_id=$(cat "$target/app/RELEASE_ID")
  valid_release_id "$release_id"
  [ "$target" = "$generations/$release_id" ]
  verify_generation "$target" "$release_id"
  check_config_links
  install_config_links
  printf 'config_links_installed %s\n' "$release_id"
}

validate_source_only() {
  [ "$#" -eq 1 ] || exit 1
  tree=$(realpath -- "$1")
  validate_source_tree "$tree"
  printf '%s\n' source_tree_valid
}

command=${1:-}
shift || true
case "$command" in
  deploy) deploy_release "$@" ;;
  rollback) rollback_release "$@" ;;
  install-config-links) install_config_links_only "$@" ;;
  validate-source) validate_source_only "$@" ;;
  *) exit 1 ;;
esac
