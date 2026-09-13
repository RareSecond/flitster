FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS phase
# Official Phase CLI v2.3.0, pinned and verified for the x86_64 VPS.
ADD --chmod=0755 --checksum=sha256:5ccedc9153563077c75370916c70ca7ad0b6e324b99177a6d5c5e3767f97956f https://github.com/phasehq/cli/releases/download/v2.3.0/phase_cli_2.3.0_linux_amd64 /usr/local/bin/phase
COPY --chmod=0755 deploy/phase-entrypoint.sh /usr/local/bin/phase-entrypoint

FROM base AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM build AS migrate
COPY --from=phase /usr/local/bin/phase /usr/local/bin/phase
COPY --from=phase /usr/local/bin/phase-entrypoint /usr/local/bin/phase-entrypoint
USER node
ENTRYPOINT ["phase-entrypoint"]
CMD ["migrate"]

FROM build AS dependencies
RUN npm prune --omit=dev

FROM phase AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
COPY server/serve.mjs ./server/serve.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["phase-entrypoint"]
CMD ["app"]
