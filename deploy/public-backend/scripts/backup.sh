#!/bin/sh
set -eu
umask 077

[ "$(id -u)" -eq 0 ] || exit 1
export PGHOST=/run/postgresql PGPORT=5433
backup_root=/var/backups/spotify-wallpaper
retention_seconds=$((35 * 24 * 60 * 60))
retention_cutoff_epoch=$(( $(date +%s) - retention_seconds ))
validation_database=
validation_created=false
temporary_dump=
temporary_sidecar=
final_dump=
final_sidecar=
final_dump_published=false
final_sidecar_published=false
backup_committed=false

cleanup() {
  trap '' HUP INT TERM
  trap - EXIT
  if [ "$validation_created" = true ]; then
    runuser -u swp_restore -- dropdb --if-exists "$validation_database" >/dev/null 2>&1 || true
  fi
  if [ "$backup_committed" != true ]; then
    [ -z "$temporary_dump" ] || rm -f -- "$temporary_dump"
    [ -z "$temporary_sidecar" ] || rm -f -- "$temporary_sidecar"
    [ "$final_dump_published" != true ] || rm -f -- "$final_dump"
    [ "$final_sidecar_published" != true ] || rm -f -- "$final_sidecar"
  fi
}
trap cleanup EXIT
trap 'exit 143' HUP INT TERM

validate_dump() {
  label=$1
  dump=$2
  validation_database="swp_validate_${label}_$$"

  pg_restore --list "$dump" >/dev/null
  trap '' HUP INT TERM
  runuser -u swp_restore -- createdb --template=template0 "$validation_database" >/dev/null
  validation_created=true
  trap 'exit 143' HUP INT TERM
  runuser -u swp_restore -- pg_restore --no-owner --no-privileges --dbname="$validation_database" <"$dump" >/dev/null
  /usr/local/libexec/spotify-wallpaper/validate-database.sh "$validation_database" "$label" restored
  trap '' HUP INT TERM
  runuser -u swp_restore -- dropdb "$validation_database" >/dev/null
  validation_created=false
  validation_database=
  trap 'exit 143' HUP INT TERM
}

validate_sidecar() {
  sidecar_dump=$1
  sidecar_file=$sidecar_dump.sha256
  [ -f "$sidecar_dump" ]
  [ ! -L "$sidecar_dump" ]
  [ -f "$sidecar_file" ]
  [ ! -L "$sidecar_file" ]
  [ "$(realpath -- "$sidecar_dump")" = "$sidecar_dump" ]
  [ "$(realpath -- "$sidecar_file")" = "$sidecar_file" ]
  [ "$(stat -c %U -- "$sidecar_dump")" = root ]
  [ "$(stat -c %a -- "$sidecar_dump")" = 600 ]
  [ "$(stat -c %U -- "$sidecar_file")" = root ]
  [ "$(stat -c %a -- "$sidecar_file")" = 600 ]
  sidecar_entry=$(cat -- "$sidecar_file")
  sidecar_digest=$(sha256_digest "$sidecar_dump")
  [ "$sidecar_entry" = "$sidecar_digest  ${sidecar_dump##*/}" ]
  (cd "${sidecar_dump%/*}" && sha256sum --check --strict "${sidecar_file##*/}" >/dev/null)
}

prune_old() {
  label=$1
  directory="$backup_root/$label"
  candidates=$(mktemp)
  if ! find "$directory" -maxdepth 1 -type f -name "$label-*.dump" -print >"$candidates"; then
    rm -f -- "$candidates"
    return 1
  fi
  status=0
  while IFS= read -r candidate; do
    if ! resolved=$(realpath -- "$candidate"); then
      status=1
      break
    fi
    case "$resolved" in "$directory"/"$label"-*.dump) ;; *) status=1; break ;; esac
    if [ "$(stat -c %U -- "$resolved")" != root ] || [ "$(stat -c %a -- "$resolved")" != 600 ]; then
      status=1
      break
    fi
    if ! validate_sidecar "$resolved"; then
      status=1
      break
    fi
    if ! modified_epoch=$(stat -c %Y -- "$resolved"); then
      status=1
      break
    fi
    if [ "$modified_epoch" -le "$retention_cutoff_epoch" ] && ! rm -f -- "$resolved" "$resolved.sha256"; then
      status=1
      break
    fi
  done <"$candidates"
  rm -f -- "$candidates"
  [ "$status" -eq 0 ]
}

assert_retention() {
  label=$1
  directory="$backup_root/$label"
  candidates=$(mktemp)
  if ! find "$directory" -maxdepth 1 -type f -name "$label-*.dump" -print >"$candidates"; then
    rm -f -- "$candidates"
    return 1
  fi
  status=0
  while IFS= read -r candidate; do
    if ! modified_epoch=$(stat -c %Y -- "$candidate"); then
      status=1
      break
    fi
    if [ "$modified_epoch" -le "$retention_cutoff_epoch" ]; then
      status=1
      break
    fi
  done <"$candidates"
  rm -f -- "$candidates"
  [ "$status" -eq 0 ]
}

purge_expired_tombstones() {
  retention_cutoff_ms="${retention_cutoff_epoch}000"
  runuser -u swp_maintenance -- psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
    --dbname=spotify_wallpaper_deletion_ledger \
    --command="DELETE FROM deletion_tombstones WHERE reconciled_at_ms < $retention_cutoff_ms" >/dev/null
}

sha256_digest() {
  line=$(sha256sum -- "$1") || return 1
  digest=${line%% *}
  [ "${#digest}" -eq 64 ] || return 1
  case "$digest" in *[!0-9a-f]*) return 1 ;; esac
  printf '%s\n' "$digest"
}

backup_one() {
  database=$1
  label=$2
  temporary_dump=
  temporary_sidecar=
  final_dump=
  final_sidecar=
  final_dump_published=false
  final_sidecar_published=false
  backup_committed=false
  directory="$backup_root/$label"
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  mkdir -p -- "$directory"
  chmod 0700 -- "$directory"
  temporary_dump=$(mktemp "$directory/.${label}.XXXXXX.dump")

  snapshot_epoch=$(date +%s)
  runuser -u swp_backup -- pg_dump --format=custom --no-owner --no-privileges --dbname="$database" >"$temporary_dump"
  touch -d "@$snapshot_epoch" "$temporary_dump"
  [ "$(stat -c %Y -- "$temporary_dump")" = "$snapshot_epoch" ]
  [ "$(stat -c %U -- "$temporary_dump")" = root ]
  [ "$(stat -c %a -- "$temporary_dump")" = 600 ]
  validate_dump "$label" "$temporary_dump"

  digest=$(sha256_digest "$temporary_dump")
  verified_digest=$(sha256_digest "$temporary_dump")
  [ "$verified_digest" = "$digest" ]
  temporary_sidecar=$(mktemp "$directory/.${label}.XXXXXX.sha256")
  printf '%s  %s\n' "$digest" "${temporary_dump##*/}" >"$temporary_sidecar"
  (cd "$directory" && sha256sum --check "${temporary_sidecar##*/}" >/dev/null)
  final="$directory/$label-$timestamp.dump"
  [ ! -e "$final" ]
  [ ! -L "$final" ]
  [ ! -e "$final.sha256" ]
  [ ! -L "$final.sha256" ]
  final_dump=$final
  final_sidecar=$final.sha256
  printf '%s  %s\n' "$digest" "${final##*/}" >"$temporary_sidecar"
  trap '' HUP INT TERM
  ln -- "$temporary_dump" "$final"
  final_dump_published=true
  trap 'exit 143' HUP INT TERM
  rm -f -- "$temporary_dump"
  temporary_dump=
  (cd "$directory" && sha256sum --check "${temporary_sidecar##*/}" >/dev/null)
  trap '' HUP INT TERM
  ln -- "$temporary_sidecar" "$final_sidecar"
  final_sidecar_published=true
  trap 'exit 143' HUP INT TERM
  rm -f -- "$temporary_sidecar"
  temporary_sidecar=
  [ "$(stat -c %U -- "$final")" = root ]
  [ "$(stat -c %a -- "$final")" = 600 ]
  validate_sidecar "$final"
  backup_committed=true
  printf 'backup_ok %s\n' "$database"
}

backup_one spotify_wallpaper primary
backup_one spotify_wallpaper_deletion_ledger ledger
prune_old primary
prune_old ledger
assert_retention primary
assert_retention ledger
purge_expired_tombstones
