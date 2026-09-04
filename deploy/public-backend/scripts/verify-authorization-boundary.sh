#!/bin/sh
set -eu
umask 077

[ "${SWP_ISOLATED_PROXY_TEST:-}" = 1 ] || exit 1
[ "$(id -u)" -eq 0 ] || exit 1
[ "$#" -eq 1 ] || exit 1
cookie_jar=$(realpath -- "$1")
[ -f "$cookie_jar" ]
[ "$(stat -c %U -- "$cookie_jar")" = root ]
[ "$(stat -c %a -- "$cookie_jar")" = 600 ]
! systemctl is-active --quiet swp-public-backend.service
systemctl is-active --quiet swp-oauth2-proxy.service
systemctl is-active --quiet swp-caddy.service

socket=/run/spotify-wallpaper/admin/admin.sock
result=/run/spotify-wallpaper/admin/.authorization-boundary-result
[ ! -e "$socket" ]
install -o swp_backend -g swp-admin -m 0600 /dev/null "$result"
dummy_pid=
cleanup() {
  if [ -n "$dummy_pid" ]; then
    kill "$dummy_pid" 2>/dev/null || true
    wait "$dummy_pid" 2>/dev/null || true
  fi
  rm -f -- "$socket" "$result"
}
trap cleanup EXIT HUP INT TERM

runuser -u swp_backend -- /usr/bin/node --input-type=module --eval '
  import { chmodSync, writeFileSync } from "node:fs";
  import { createServer } from "node:http";
  const [socket, result] = process.argv.slice(1);
  process.umask(0o117);
  const server = createServer((request, response) => {
    const values = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (request.rawHeaders[index].toLowerCase() === "authorization") values.push(request.rawHeaders[index + 1]);
    }
    writeFileSync(result, values.length === 1 && values[0] === "A" ? "ok" : "failed", { mode: 0o600 });
    response.writeHead(204).end();
    server.close();
  });
  server.listen(socket, () => chmodSync(socket, 0o660));
' "$socket" "$result" >/dev/null 2>&1 &
dummy_pid=$!

for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -S "$socket" ] && break
  kill -0 "$dummy_pid" 2>/dev/null || exit 1
  sleep 1
done
[ -S "$socket" ]
curl --silent --fail --output /dev/null --cookie "$cookie_jar" --header 'Authorization: A' \
  https://ciel-spotify-wallpaper.duckdns.org/setup
wait "$dummy_pid"
dummy_pid=
[ "$(cat "$result")" = ok ]
printf '%s\n' AUTHORIZATION_BOUNDARY_PASS
