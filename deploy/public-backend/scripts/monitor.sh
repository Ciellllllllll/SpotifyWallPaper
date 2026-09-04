#!/bin/sh
set -eu
umask 077

[ "$(id -u)" -eq 0 ] || exit 1
export PGHOST=/run/postgresql PGPORT=5433
recipient=cielgameee@gmail.com

alert() {
  check_name=$1
  printf 'Spotify Wallpaper backend local check failed: %s.\n' "$check_name" |
    /usr/bin/mail -s 'Spotify Wallpaper backend alert' "$recipient" >/dev/null 2>&1 || true
}

check_runtime() {
  /usr/local/libexec/spotify-wallpaper/preflight.sh node || return 1
  /usr/local/libexec/spotify-wallpaper/preflight.sh oauth2-proxy || return 1
  systemctl is-active --quiet swp-public-backend.service || return 1
  systemctl is-active --quiet swp-oauth2-proxy.service || return 1
  systemctl is-active --quiet swp-caddy.service || return 1
  [ -S /run/spotify-wallpaper/public/public.sock ] || return 1
  [ -S /run/spotify-wallpaper/admin/admin.sock ] || return 1
  [ -S /run/spotify-wallpaper/oauth/oauth2-proxy.sock ] || return 1
  [ "$(stat -c %a /run/spotify-wallpaper/public/public.sock)" = 660 ] || return 1
  [ "$(stat -c %G /run/spotify-wallpaper/public/public.sock)" = swp-public ] || return 1
  [ "$(stat -c %a /run/spotify-wallpaper/admin/admin.sock)" = 660 ] || return 1
  [ "$(stat -c %G /run/spotify-wallpaper/admin/admin.sock)" = swp-admin ] || return 1
  [ "$(stat -c %a /run/spotify-wallpaper/oauth/oauth2-proxy.sock)" = 660 ] || return 1
  [ "$(stat -c %G /run/spotify-wallpaper/oauth/oauth2-proxy.sock)" = swp-oauth ] || return 1
  curl --silent --fail --unix-socket /run/spotify-wallpaper/public/public.sock http://localhost/health >/dev/null 2>&1 || return 1
  pid=$(systemctl show --property=MainPID --value swp-public-backend.service)
  [ "$pid" -gt 1 ] || return 1
  listeners=$(mktemp) || return 1
  if ! ss --tcp --listening --processes >"$listeners" 2>/dev/null; then
    rm -f -- "$listeners"
    return 1
  fi
  grep_status=0
  grep -q "pid=$pid," "$listeners" || grep_status=$?
  rm -f -- "$listeners"
  [ "$grep_status" -eq 1 ]
}

check_database() {
  server_version_num=$(runuser -u swp_maintenance -- psql --no-psqlrc --tuples-only --no-align --dbname=spotify_wallpaper --command="SELECT current_setting('server_version_num')" 2>/dev/null) || return 1
  [ "$server_version_num" = 170011 ] || return 1 # PostgreSQL 17.11 only
  primary=$(runuser -u swp_maintenance -- psql --no-psqlrc --tuples-only --no-align --dbname=spotify_wallpaper --command='SELECT string_agg(version, '"'"','"'"' ORDER BY version) FROM schema_migrations' 2>/dev/null) || return 1
  ledger=$(runuser -u swp_maintenance -- psql --no-psqlrc --tuples-only --no-align --dbname=spotify_wallpaper_deletion_ledger --command='SELECT string_agg(version, '"'"','"'"' ORDER BY version) FROM schema_migrations' 2>/dev/null) || return 1
  [ "$primary" = 0001_initial ] && [ "$ledger" = 0001_initial ]
}

fresh_backup() {
  label=$1
  directory=/var/backups/spotify-wallpaper/$label
  candidates=$(mktemp) || return 1
  sorted_candidates=$(mktemp) || {
    rm -f -- "$candidates"
    return 1
  }
  if ! find "$directory" -maxdepth 1 -type f -name "$label-*.dump" -mmin -2160 -print 2>/dev/null >"$candidates"; then
    rm -f -- "$candidates" "$sorted_candidates"
    return 1
  fi
  if ! LC_ALL=C sort "$candidates" >"$sorted_candidates"; then
    rm -f -- "$candidates" "$sorted_candidates"
    return 1
  fi
  latest=$(tail -n 1 "$sorted_candidates") || {
    rm -f -- "$candidates" "$sorted_candidates"
    return 1
  }
  rm -f -- "$candidates" "$sorted_candidates"
  [ -n "$latest" ] || return 1
  [ "$(stat -c %U "$latest")" = root ] || return 1
  [ "$(stat -c %a "$latest")" = 600 ] || return 1
  [ -f "$latest.sha256" ] || return 1
  (cd "$directory" && sha256sum --check "${latest##*/}.sha256" >/dev/null 2>&1)
}

check_backup() {
  fresh_backup primary && fresh_backup ledger
}

check_disk() {
  for flag in P Pi; do
    disk_file=$(mktemp) || return 1
    if ! df -"$flag" /opt/spotify-wallpaper /var/backups/spotify-wallpaper >"$disk_file"; then
      rm -f -- "$disk_file"
      return 1
    fi
    if ! check_disk_table "$disk_file"; then
      rm -f -- "$disk_file"
      return 1
    fi
    rm -f -- "$disk_file" || return 1
  done
}

check_disk_table() {
  table=$1
  awk_status=0
  awk 'NR > 1 { gsub(/%/, "", $5); if ($5 >= 90) bad=1 } END { exit bad ? 0 : 1 }' "$table" || awk_status=$?
  if [ "$awk_status" -eq 0 ]; then
    return 1
  fi
  [ "$awk_status" -eq 1 ]
}

check_reconciliation() {
  overdue=$(runuser -u swp_maintenance -- psql --no-psqlrc --tuples-only --no-align --dbname=spotify_wallpaper_deletion_ledger \
    --command="SELECT count(*) FROM deletion_tombstones WHERE reconciled_at_ms IS NULL AND COALESCE(last_attempt_at_ms, deleted_at_ms) < (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT - 900000" 2>/dev/null) || return 1
  [ "$overdue" = 0 ]
}

check_tls() {
  command -v openssl >/dev/null 2>&1 || return 1
  command -v timeout >/dev/null 2>&1 || return 1
  tls_certificate=$(mktemp /run/spotify-wallpaper/.tls-certificate.XXXXXX) || return 1
  status=0
  if ! timeout 15s openssl s_client \
    -connect ciel-spotify-wallpaper.duckdns.org:443 \
    -servername ciel-spotify-wallpaper.duckdns.org \
    -verify_hostname ciel-spotify-wallpaper.duckdns.org \
    -verify_return_error </dev/null >"$tls_certificate" 2>/dev/null; then
    status=1
  elif ! openssl x509 -checkend 604800 -noout <"$tls_certificate" >/dev/null 2>&1; then
    status=1
  fi
  rm -f -- "$tls_certificate"
  return "$status"
}

fresh_timer() {
  unit=$1
  maximum_age_seconds=$2
  systemctl is-active --quiet "$unit" || return 1
  last_trigger=$(systemctl show --property=LastTriggerUSec --value "$unit") || return 1
  [ -n "$last_trigger" ] && [ "$last_trigger" != n/a ] || return 1
  last_epoch=$(date --date="$last_trigger" +%s 2>/dev/null) || return 1
  now_epoch=$(date +%s)
  age_seconds=$((now_epoch - last_epoch))
  [ "$age_seconds" -ge 0 ] && [ "$age_seconds" -le "$maximum_age_seconds" ]
}

check_systemd() {
  failed_units=$(systemctl --failed --no-legend --plain 2>/dev/null) || return 1
  [ -z "$failed_units" ] || return 1
  fresh_timer swp-backup.timer 129600 || return 1
  fresh_timer swp-reconcile.timer 1800 || return 1
  fresh_timer swp-monitor.timer 900
}

run_check() {
  name=$1
  if "check_$name" >/dev/null 2>&1; then
    return 0
  fi
  alert "$name"
  return 1
}

case "${1:-all}" in
  runtime|database|backup|disk|reconciliation|tls|systemd) run_check "$1" ;;
  all)
    status=0
    for check_name in runtime database backup disk reconciliation tls systemd; do
      run_check "$check_name" || status=1
    done
    exit "$status"
    ;;
  *) exit 1 ;;
esac
