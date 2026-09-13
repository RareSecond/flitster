#!/bin/sh
set -eu
# A mounted bootstrap credential authenticates to Phase; application secrets
# are fetched at startup and are never written to an application env file.
: "${PHASE_APP:?Set PHASE_APP to the Phase application name}"
: "${PHASE_ENV:?Set PHASE_ENV to the Phase environment name}"
token_file=${PHASE_SERVICE_TOKEN_FILE:-/run/secrets/phase_service_token}
if [ ! -r "$token_file" ]; then
  echo 'Phase service token file is missing or unreadable' >&2
  exit 1
fi
PHASE_SERVICE_TOKEN=$(cat "$token_file")
[ -n "$PHASE_SERVICE_TOKEN" ] || { echo 'Phase service token is empty' >&2; exit 1; }
export PHASE_SERVICE_TOKEN
# Stateless authentication; keep any CLI working files on the container tmpfs.
export HOME=/tmp/phase
mkdir -p "$HOME"
unset PHASE_OFFLINE
case "${1:-}" in
  app) command='exec env -u PHASE_SERVICE_TOKEN node server/serve.mjs' ;;
  migrate) command='exec env -u PHASE_SERVICE_TOKEN npm run db:deploy' ;;
  *) echo 'Expected app or migrate' >&2; exit 64 ;;
esac
exec phase run --app "$PHASE_APP" --env "$PHASE_ENV" -- "$command"
