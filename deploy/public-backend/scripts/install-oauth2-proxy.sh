#!/bin/sh
set -eu
umask 077

version=7.15.3
[ "$(id -u)" -eq 0 ] || exit 1
[ "$#" -eq 2 ] || exit 1
archive=$(realpath -- "$1")
checksums=$(realpath -- "$2")
archive_name="oauth2-proxy-v$version.linux-amd64.tar.gz"
checksum_name="$archive_name-sha256sum.txt"
[ "${archive##*/}" = "$archive_name" ]
[ "${checksums##*/}" = "$checksum_name" ]
[ -f "$checksums" ]
line=$(grep -E "^[0-9a-f]{64}  \*?$archive_name$" "$checksums")
[ "$(printf '%s\n' "$line" | wc -l)" -eq 1 ]
(cd "${archive%/*}" && printf '%s\n' "$line" | sha256sum --check - >/dev/null)

temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
tar --extract --gzip --file="$archive" --directory="$temporary" --no-same-owner --no-same-permissions
binary=$(find "$temporary" -type f -name oauth2-proxy -print)
[ "$(printf '%s\n' "$binary" | wc -l)" -eq 1 ]
"$binary" --version 2>/dev/null | grep -Eq '^oauth2-proxy v7\.15\.3( |$)'
install -o root -g root -m 0755 -- "$binary" /usr/local/bin/oauth2-proxy
/usr/local/bin/oauth2-proxy --version 2>/dev/null | grep -Eq '^oauth2-proxy v7\.15\.3( |$)'
printf 'oauth2_proxy_installed %s\n' "$version"
