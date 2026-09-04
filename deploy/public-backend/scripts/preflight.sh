#!/bin/sh
set -eu

case "${1:-}" in
  database)
    version=$(/usr/lib/postgresql/17/bin/postgres --version 2>/dev/null)
    case "$version" in
      'postgres (PostgreSQL) 17.11'|'postgres (PostgreSQL) 17.11 '*) ;;
      *) exit 1 ;;
    esac
    ;;
  node)
    case "$(/usr/bin/node --version 2>/dev/null)" in v22.*) ;; *) exit 1 ;; esac
    ;;
  oauth2-proxy)
    /usr/local/bin/oauth2-proxy --version 2>/dev/null | grep -Eq '^oauth2-proxy v7\.15\.3( |$)'
    ;;
  *) exit 1 ;;
esac
