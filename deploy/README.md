# Codictive VPS deployment

DNS already resolves `flitster.codictive.be` to `161.35.95.167` through the existing wildcard. Codictive owns Caddy routing, the Compose stack, and the administrator release helper. This repository owns application images and the deployment workflow.

## First installation

In Phase Cloud, create app `flitster` and use environment `production`. Store
`DATABASE_URL`, optional `DIRECT_URL`, and `LIBRARY_OWNER_ID=personal-import` at
path `/`. Grant a service account access to this environment and create its CLI
Personal Secret Token. Keep database connection strings, including SSL parameters,
in Phase; neither the VPS nor CI needs an application `.env` file.

Provision `/srv/apps/flitster/phase-service-token` with that bootstrap token,
owner/group 1000 and mode 0400. Compose mounts it read-only into both containers.
The pinned Phase CLI fetches secrets at each application or migration startup.
CLI working files use `/tmp` (tmpfs); the application filesystem is read-only.
The bootstrap token is removed from the child application's environment.
Phase Cloud must be reachable for startup; a running process keeps its existing
values until restarted. Token expiry/revocation affects subsequent startups.

The deployment is intentionally public without proxy authentication. Anyone who
can reach the URL can view and edit the shared personal library.

Apply the app role from Codictive:

```sh
ansible-playbook playbooks/site.yml --tags flitster
```

In GitHub, add `PHASE_SERVICE_TOKEN` to this repository's `production`
environment. As in GAINS, its service account needs read access to
`codictive/production`, containing `INFRA_SSH_HOST`, `INFRA_SSH_KEY`, and
`INFRA_SSH_KNOWN_HOSTS`. These credentials authenticate as the VPS administrator
and pin its SSH host key. The mounted runtime token also needs read access to
`flitster/production`.

Push or merge to `master`, or manually run the Deploy workflow on `master`.
It builds both Linux images, uploads them, and invokes
`/usr/local/sbin/flitster-release` automatically. Pull requests build and test
without deploying or accessing production secrets.

For a manual release, build and bundle the images first, then use Phase:

```sh
release=$(git rev-parse HEAD)
docker build --platform linux/amd64 --target runtime -t "flitster:$release" .
docker build --platform linux/amd64 --target migrate -t "flitster-migrate:$release" .
docker save "flitster:$release" "flitster-migrate:$release" | gzip > flitster-release.tar.gz
phase run --app codictive --env production "bash deploy/publish.sh $release"
```

Then apply Codictive's proxy configuration with `make proxy`. Caddy automatically obtains a certificate. Verify that `/api/health` returns JSON and the library loads successfully in the browser.

## Releases and rollback

The helper serializes deployments, loads the uploaded images, runs `prisma migrate deploy`, and replaces the app only after migrations succeed. Compose waits for the application's HTTP health check. A failed app start triggers restoration of the previous image. `/api/health` checks the HTTP process, not database connectivity; separately verify library loading. The application may be briefly unavailable during replacement.

For rollback, read `/srv/apps/flitster/previous` and invoke the same helper with that release ID. Retain its app and migration images. Database migrations are not reversed; migrations must remain compatible with the previous application. Take database backups before destructive schema changes. Old images are retained until an administrator removes them.

The GitHub workflow runs the existing tests and builds before accessing production
credentials. It transfers a one-day release artifact to a separate deployment
job, fetches infrastructure credentials using Phase CLI v2.3.2, uploads over
host-key-verified SSH, activates the release, and checks the public `/api/health`
endpoint. Deployment jobs are serialized. Temporary SSH credentials are removed
on success or failure. Optional GitHub variables `INFRA_PHASE_APP` and `PHASE_HOST`
override the default infrastructure app (`codictive`) and Phase endpoint.

No registry credentials are needed: images travel as a compressed Docker archive over SSH. Database credentials are managed in Phase and injected into application processes, not stored in CI or application env files on the VPS. The runtime runs as a non-root user, publishes no host ports, and connects to Caddy through `codictive_edge`.

## Phase implementation

`Dockerfile` pins Phase CLI v2.3.0 and verifies the official Linux amd64 binary's
SHA-256 checksum. `deploy/phase-entrypoint.sh` requires the mounted token and an
explicit app/environment, then invokes `phase run`. Codictive's
`flitster_phase_app` and `flitster_phase_environment` variables select the context.
Builds never contact Phase or receive its token.

Reference: https://docs.phase.dev/integrations/platforms/docker
