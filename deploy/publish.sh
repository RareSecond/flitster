#!/usr/bin/env bash
set -euo pipefail
: "${SSH_HOST:?Set SSH_HOST}"
release=${1:?Usage: deploy/publish.sh RELEASE}
[[ "$release" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]] || exit 64
ssh_user=${SSH_USER:-deploy}
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
docker build --platform linux/amd64 --target runtime -t "flitster:$release" .
docker build --platform linux/amd64 --target migrate -t "flitster-migrate:$release" .
docker save "flitster:$release" "flitster-migrate:$release" | gzip > "$archive"
scp "$archive" "$ssh_user@$SSH_HOST:/srv/apps/flitster/incoming/$release.tar.gz"
echo "Uploaded $release. An administrator must run: /usr/local/sbin/flitster-release $release"
