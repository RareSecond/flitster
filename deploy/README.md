# Codictive VPS deployment

DNS already resolves `flitster.codictive.be` to `161.35.95.167` through the existing wildcard. Codictive owns Caddy routing, the Compose stack, and the administrator release helper. This repository owns application images and the upload workflow.

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

Build and upload the two Linux images from this repository:

```sh
SSH_HOST=161.35.95.167 bash deploy/publish.sh release-20260913
```

The upload uses your SSH configuration (by default the `deploy` user). An administrator activates the release:

```sh
ssh root@161.35.95.167 /usr/local/sbin/flitster-release release-20260913
```

Then apply Codictive's proxy configuration with `make proxy`. Caddy automatically obtains a certificate. Verify that `/api/health` returns JSON and the library loads successfully in the browser.

## Releases and rollback

The helper serializes deployments, loads the uploaded images, runs `prisma migrate deploy`, and replaces the app only after migrations succeed. Compose waits for the application's HTTP health check. A failed app start triggers restoration of the previous image. `/api/health` checks the HTTP process, not database connectivity; separately verify library loading. The application may be briefly unavailable during replacement.

For rollback, read `/srv/apps/flitster/previous` and invoke the same helper with that release ID. Retain its app and migration images. Database migrations are not reversed; migrations must remain compatible with the previous application. Take database backups before destructive schema changes. Old images are retained until an administrator removes them.

The GitHub workflow tests, builds, and uploads images on `main` or manual dispatch. Configure the production environment's `SSH_HOST`, `SSH_KEY`, and verified `SSH_KNOWN_HOSTS` secrets. Activation is deliberately an administrator step: the deploy user has neither sudo nor Docker access. There is currently no Git remote configured for Flitster, so the workflow will not run until this repository is hosted on GitHub.

No registry credentials are needed: images travel as a compressed Docker archive over SSH. Database credentials are managed in Phase and injected into application processes, not stored in CI or application env files on the VPS. The runtime runs as a non-root user, publishes no host ports, and connects to Caddy through `codictive_edge`.

## Phase implementation

`Dockerfile` pins Phase CLI v2.3.0 and verifies the official Linux amd64 binary's
SHA-256 checksum. `deploy/phase-entrypoint.sh` requires the mounted token and an
explicit app/environment, then invokes `phase run`. Codictive's
`flitster_phase_app` and `flitster_phase_environment` variables select the context.
Builds never contact Phase or receive its token.

Reference: https://docs.phase.dev/integrations/platforms/docker
