# Flitster — server migration spec

Moving Flitster from a single-phone localStorage prototype to a public app on
TanStack Start, backed by the Neon Postgres that already holds the deck, and
deployed as a container on the existing codictive VPS.

Status: dependency upgrade done, nothing else started.

---

## 1. What we're building

A public PWA that anyone can open and play with:

- **The deck** (82 cards, 1957–2025) is server-held and world-readable.
- **Playlists** are server-held, world-readable, and **writable only by Jasper**
  via a shared admin token.
- **No user accounts.** Deliberately deferred — see §13.
- **No Spotify login for most players.** Preview mode requires no Spotify
  account at all — see §7. Login becomes opt-in, only for full-track playback.
- Everything still works offline once loaded, because the app is played at
  parties on bad wifi.

The card→song indirection is unchanged and load-bearing: cards carry a *year*,
playlists are *pools bucketed by year*, and a round joins them at scan time.
Playlists never reference a card.

---

## 2. Where we are now

Three commits, all local, nothing pushed:

| commit | what |
| --- | --- |
| `a98fe1f` | Working PWA before dependency overhaul (safety net) |
| `cae2cba` | All dependencies upgraded to latest |
| `80edeba` | This spec |

Current stack after the upgrade:

| package | version |
| --- | --- |
| vite | 8.2.2 |
| react / react-dom | 19.2.8 |
| typescript | 7.0.2 |
| @vitejs/plugin-react | 6.1.1 |
| vite-plugin-pwa | 1.3.0 |
| @vitejs/plugin-basic-ssl | 2.3.0 |
| jsqr | 1.4.0 |

Verified: `tsc -b` clean, `vite build` succeeds, service worker still emitted,
dev server serves over HTTPS.

**Not verified: any runtime behaviour on a real phone after the React 19 jump.**
The camera path, the `devicemotion` flip detector, the audio-unlock-on-gesture
trick, and the Spotify PKCE redirect are all browser-behaviour concerns a build
cannot exercise. Smoke-test before the migration starts, so a React 19
regression is not discovered tangled up in a framework change.

Already in Postgres:

```sql
deck_cards (code text PK, year integer NOT NULL, added_at timestamptz NOT NULL)  -- 82 rows
```

---

## 3. Target architecture

TanStack Start (`@tanstack/react-start` 1.168.x, peers `vite >=7`, React 18 or
19 both fine) in **SPA mode**, not SSR.

Rationale for SPA mode: every screen depends on browser-only APIs — camera,
`devicemotion`, `<audio>` unlock, `localStorage` Spotify tokens. There is
nothing meaningful to server-render, and a static shell is what the service
worker wants to precache. Server functions still work in SPA mode, which is the
half of Start we actually want, along with the router.

```
Browser (PWA, offline-capable)
  ├── TanStack Router — /, /deck, /playlists
  ├── TanStack Query — cache + invalidation + offline fallback
  └── localStorage — offline cache, per-device prefs,
                     Spotify user tokens (connect mode only)
        │
        │  server functions (typed RPC)
        ▼
  Start server runtime  ──────────────►  Spotify Web API
  ├── public reads:  getDeck, getPlaylists         (client credentials,
  ├── admin writes:  guarded by ADMIN_TOKEN         secret stays server-side)
  └── admin catalog: search, resolve tracks
        │
        │  Drizzle
        ▼
  Neon Postgres (plain Postgres; portable, nothing Neon-specific)
```

Deployed as a single container behind the Caddy already running on the
codictive VPS — see §10.

---

## 4. What lives where

This is the decision that everything else follows from.

| State | Today | After | Why |
| --- | --- | --- | --- |
| Deck (`flitster.deck`) | localStorage | **Server**, public read | Shared physical artifact; identical for everyone |
| Playlists (`flitster.playlists`) | localStorage | **Server**, public read / admin write | The thing worth sharing |
| Active playlist ids (`flitster.activePlaylists`) | localStorage | **Stays local** | Per-player session state. A stranger toggling your pools mid-game is a bug |
| Playback mode (`flitster.mode`) | localStorage | **Stays local** | Per-device capability (Premium vs not) |
| Spotify user tokens (`flitster.spotify.tokens`) | localStorage | **Stays local, always** | Per-user OAuth credentials; must never reach our server. Now only needed for connect mode |
| Spotify **client secret** | did not exist | **Server env only** | Enables client-credentials catalog access |
| Used-tracks set (`usedRef`) | in-memory | **Stays in-memory** | Per-game, dies with the round |

---

## 5. Data layer — Drizzle

`drizzle-orm` over `postgres.js`, with `drizzle-kit` for migrations.

Chosen for the **migration story**, not the querying. Two tables and ~8 queries
would be fine in raw SQL, but the schema is already growing a `preview_url`
column and the target is a server that has to be migrated by hand. Drizzle is a
typed query builder rather than an active-record ORM: thin, no codegen daemon,
and the schema file doubles as documentation. Types flow from the schema through
the server functions and out via Start's RPC into the components.

Nothing Neon-specific — it is a `DATABASE_URL` and standard Postgres, so the
database stays swappable.

### Schema

`deck_cards` already exists and is untouched; it gets a Drizzle definition so it
is typed, not a new migration.

```ts
// src/server/schema.ts
export const deckCards = pgTable('deck_cards', {
  code:    text('code').primaryKey(),
  year:    integer('year').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull(),
})

export const playlists = pgTable('playlists', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const playlistTracks = pgTable('playlist_tracks', {
  playlistId:  text('playlist_id').notNull()
                 .references(() => playlists.id, { onDelete: 'cascade' }),
  uri:         text('uri').notNull(),
  title:       text('title').notNull(),
  artist:      text('artist').notNull(),
  year:        integer('year').notNull(),        // authoritative, hand-corrected
  spotifyYear: integer('spotify_year'),          // what Spotify claimed
  albumName:   text('album_name'),
  previewUrl:  text('preview_url'),              // resolved at authoring time (§7)
  previewCheckedAt: timestamp('preview_checked_at', { withTimezone: true }),
  position:    integer('position').notNull(),
}, (t) => ({
  pk:      primaryKey({ columns: [t.playlistId, t.uri] }),
  yearIdx: index('playlist_tracks_year_idx').on(t.year),
}))
```

Notes:

- `PRIMARY KEY (playlist_id, uri)` enforces the existing de-dup rule in
  `addTracks` at the database level rather than in JS.
- `position` preserves authoring order; the client currently relies on array
  order and would otherwise get arbitrary row order back.
- `year` and `spotify_year` stay separate. The whole game hinges on the year
  being correctable, and we must keep showing what Spotify originally claimed.
- `preview_checked_at` supports re-resolving rotated preview URLs (§7).
- No RLS needed — nothing connects to Postgres except our own server functions.

---

## 6. Server functions

`src/server/db.ts` — one `postgres.js` client wrapped in Drizzle, reading
`DATABASE_URL`.

### Public (no auth)

| Function | Returns |
| --- | --- |
| `getDeck()` | `DeckCard[]` — all 82 rows |
| `getPlaylists()` | `Playlist[]` with nested tracks, ordered by `position` |

### Admin (bearer token required)

| Function | Notes |
| --- | --- |
| `createPlaylist(name)` | |
| `renamePlaylist(id, name)` | |
| `deletePlaylist(id)` | cascades to tracks |
| `addTracks(id, tracks[])` | upsert on `(playlist_id, uri)`; resolves `preview_url` |
| `removeTrack(id, uri)` | |
| `setTrackYear(id, uri, year)` | the hand-correction path |
| `addCard(code, year)` | deck capture |
| `removeCard(code)` | |
| `searchTracks(query)` | proxied to Spotify with client credentials |
| `importSpotifyPlaylist(url)` | proxied; bulk authoring path |

### Auth model

- `ADMIN_TOKEN` is a server env var. **Never in the client bundle.**
- Jasper pastes it once into a settings field; it lives in *his* localStorage and
  rides as a header on writes.
- Every write function re-checks the token server-side with a timing-safe
  comparison. Hiding the edit UI without a token is cosmetic; the server is the
  enforcement.
- Accepted risk: one shared secret, no revocation beyond rotating the env var.

---

## 7. Spotify — who actually needs to log in

The current app makes every player authenticate. That was forced by having no
server: a browser cannot hold a client secret, so the only way to reach the API
was a per-user PKCE token. With a server, most of it stops needing a user.

Splitting the existing API surface by what it genuinely requires:

| Needs a **user** token (+ Premium) | Works with an **app** token (client credentials) |
| --- | --- |
| `getDevices` → `/me/player/devices` | `searchTracks` → `/v1/search` |
| `playTrack` → `PUT /me/player/play` | `getTrack` → `/v1/tracks/{id}` |
| `pausePlayback` → `PUT /me/player/pause` | `getPlaylistTracks` → `/v1/playlists/{id}/tracks` |
| `getCurrentlyPlaying` | |
| — **connect mode only** | — **authoring and preview only** |

The scopes in `spotifyAuth.ts` (`user-read-playback-state`,
`user-modify-playback-state`, `user-read-currently-playing`) are all
playback-control. Nothing in the catalog path needs them.

### Consequences

1. **Catalog calls move server-side.** Search and playlist import become admin
   server functions using client credentials. The secret never leaves the server.
2. **`preview_url` is resolved at authoring time and stored** in
   `playlist_tracks`. Preview mode then makes *zero* Spotify calls at play time —
   it is an `<audio src>` pointing at a stored URL.
3. **Preview mode needs no Spotify account.** Anyone can open the app and play.
   This is what makes "an app anyone can use" actually true.
4. **Login becomes opt-in**, surfaced only when a player switches to connect mode
   for full tracks. `spotifyAuth.ts` survives unchanged for that path.

### Risks specific to this

- **Preview URLs rotate.** They are CDN links, not stable identifiers. Store
  `preview_checked_at` and re-resolve server-side on playback failure or on a
  periodic sweep.
- **`preview_url` availability is not guaranteed.** Spotify restricted it for
  apps registered after Nov 2024. The existing `PreviewProbe` state machine in
  `App.tsx` suggests this is already known to be flaky. **Confirm the current
  client id still returns preview URLs before building on this** — if it does
  not, preview mode dies and connect mode (with login and Premium) becomes the
  only path, which changes §1 substantially.

---

## 8. Routing

Replaces `const [screen, setScreen] = useState<Screen>('play')` in `App.tsx:35`.

| Route | Screen | Notes |
| --- | --- | --- |
| `/` | Play | Scan → flip → play. The default. |
| `/deck` | Deck | Admin-gated for writes; browsing is public |
| `/playlists` | Playlists | Admin-gated for writes; browsing is public |

Gains real URLs and back-button behaviour, which the `useState` version never
had. Route files under `src/routes/`, root layout carries the nav currently
rendered in `App.tsx`.

---

## 9. Client rewire — the actual work

The bulk of the effort, and the riskiest part. Today every mutation is
synchronous and returns the whole new state:

```ts
setLists(addTracks(selectedId, [toPlaylistTrack(t)]))   // returns Playlists
```

That pattern cannot survive a network boundary. Each becomes a Query mutation
plus invalidation. Call sites to convert:

**`src/App.tsx`**
- `:127` `loadDeck()[code]` — **the constraint that shapes everything.** This runs
  inside the QR scan callback. It must stay synchronous, so the deck has to be
  resident in memory *before* a scan happens. Deck loads at app start via a
  route loader and is read from cache here, never fetched on demand.
- `:198` `Object.keys(loadDeck()).length` → Query read
- `:199` `activeIds().length` → unchanged, stays local

**`src/components/DeckScreen.tsx`**
- `:18` `useState<Deck>(loadDeck)` → `useQuery`
- `:50` `addCard` → mutation
- `:78,:81` `exportDeck` → see §12
- `:87,:88` `importDeck` → see §12
- `:173` `removeCard` → mutation

**`src/components/PlaylistScreen.tsx`**
- `:33` `useState<Playlists>(loadPlaylists)` → `useQuery`
- `:34,:117,:277` `activeIds` / `toggleActive` → unchanged, stays local
- `:44` `useMemo(loadDeck, [])` → Query read (feeds `coverage`)
- `:67,:79,:210` `addTracks` → mutation
- `:141` `createPlaylist` → mutation
- `:256` `setTrackYear` → mutation (debounce; it fires per keystroke today)
- `:260` `removeTrack` → mutation
- `:276` `deletePlaylist` → mutation
- `:292,:302,:303` export/import → see §12

**`src/lib/spotifyApi.ts`** — split. Catalog calls (`searchTracks`, `getTrack`,
`getPlaylistTracks`) move to server functions; playback calls (`getDevices`,
`playTrack`, `pausePlayback`, `getCurrentlyPlaying`) stay client-side on the user
token.

Pure functions in `playlists.ts` — `pickTrack`, `tracksForYear`, `activeTracks`,
`coverage`, `yearWarning` — keep working unchanged once fed from Query instead
of localStorage. They are the stable core; only the loading layer changes.

`setTrackYear` at `:256` deserves attention: it currently fires on every
keystroke against localStorage, which is free. Against a server it needs
debouncing or an on-blur commit, or it will hammer the endpoint.

---

## 10. Deployment

Target: the existing `codictive` VPS (`~/Documents/apps/codictive`), an
Ansible-managed box that already runs Caddy. Neon stays remote.

**Flitster is the first containerised app on that box.** The infra repo was built
anticipating this — the `codictive_edge` network comment reads *"Future app
containers join this network and are reachable by service name from Caddy, so
they never need to publish a port of their own"* — but the seam has no consumers
yet, so some of it has to be built.

```
Internet ──► Caddy (already running, /srv/stack, ports 80/443)
                │  reverse_proxy over codictive_edge
                └──► flitster:3000  (Start node-server preset, no published port)
                          │
                          └──► Neon Postgres (remote)
```

### What already exists and is reused

- **Caddy, TLS, ACME.** Certificates are automatic via the existing
  `acme_email`. No Caddy container in Flitster's compose — that would collide
  with the running one over ports 80/443.
- **The `codictive_edge` network.** Flitster joins it as `external: true` and
  publishes **no ports**. This is a security requirement, not tidiness: the infra
  README notes Docker writes its iptables rules ahead of UFW, so a published port
  punches straight through the firewall.
- **The `(hardening)` and `(cache)` Caddyfile snippets.** The cache snippet
  already does the right thing for a Vite PWA — `/assets/*` immutable, and `/`,
  `*.html`, `/sw.js` on `no-cache`, which is exactly the service-worker
  revalidation rule this app needs.

### What has to be added to the infra repo

`sites.yml` only understands `static_sites`, and `Caddyfile.j2` only emits
`root` + `file_server`. There is no `reverse_proxy` anywhere. Required changes,
all in `~/Documents/apps/codictive`:

1. **A new `apps:` list in `sites.yml`** — `name`, `domains`, `upstream`
   (`service:port`), optional `headers`.
2. **A second loop in `Caddyfile.j2`** emitting a `reverse_proxy` block per app,
   importing `hardening`, with its own log file. Existing static rendering is
   untouched.
3. **A `deploy-app.yml` reusable workflow** beside `deploy-static.yml`. The
   static one rsyncs a release directory and flips a symlink, which does not
   apply to a container. This one builds an image, pushes to **ghcr.io**, then
   over SSH pulls and restarts the service.
4. **A per-app compose file on the host**, e.g. `/srv/apps/flitster/`, joining
   `codictive_edge`.

### Runtime secrets — an open gap

The infra repo has no home for application secrets. `admin_ssh_keys` and
`deploy_ssh_keys` are *public* halves and safe in git; `DATABASE_URL`,
`ADMIN_TOKEN`, and `SPOTIFY_CLIENT_SECRET` are not, and there is no
`ansible-vault` usage in the repo today.

Options, cheapest first:

- **GitHub secrets → env file at deploy time.** The workflow writes
  `/srv/apps/flitster/.env` over SSH. Fits the existing `secrets: inherit`
  pattern and adds no new tooling. The `deploy` user currently owns nothing
  outside `sites_root`, so this needs a small permissions change.
- **`ansible-vault`.** Secrets live encrypted in the infra repo, written on
  converge. More correct, introduces a passphrase to manage.
- **Written on the host by hand once.** Simplest, but undocumented state on a box
  whose whole premise is that it is disposable and reproducible.

### The Flitster side

- **Multi-stage Dockerfile** on `node:24-alpine`: install → build → copy the
  Start node-server output into a slim runtime stage.
- **Compose** with one service, joined to the external `codictive_edge` network,
  no published ports, `restart: unless-stopped`.
- **Migrations** run via `drizzle-kit` as an explicit deploy step, not on
  container start. Automatic migration-on-boot makes rollbacks unpleasant.
- If any config is ever bind-mounted in, mount the **directory, never the single
  file** — the infra README documents the inode-pinning trap that makes a
  file mount silently stale.

### Rollback

Static sites get instant rollback by re-pointing a symlink (`site-release
rollback`). Containers get no equivalent for free. Tagging images with the commit
SHA and keeping the previous tag on the host gives roughly the same property:
retag and restart. Worth deciding whether that lives in the infra repo as a
`app-release` helper mirroring `site-release`.

### Environment variables

| Var | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | server | Neon connection string |
| `ADMIN_TOKEN` | server | Gates every write (§6) |
| `SPOTIFY_CLIENT_ID` | server | Client-credentials catalog access |
| `SPOTIFY_CLIENT_SECRET` | server | **Server only, never bundled** |
| `VITE_SPOTIFY_CLIENT_ID` | build | Still needed client-side for connect-mode PKCE |

The client id appears twice on purpose — public in the bundle for the PKCE flow,
and server-side paired with the secret for client credentials. Only the secret is
sensitive.

Once the origin is known, register `https://<domain>/` as the redirect URI in the
Spotify dashboard, replacing `https://192.168.1.11:5173/`.

---

## 11. Known risks

1. **Start + vite-plugin-pwa coexistence.** Not settled from the registry alone.
   Validate in a throwaway skeleton *before* moving any application code.
2. **`preview_url` availability** (§7) — verify before designing around it.
   This one can invalidate a headline feature.
3. **React 19 runtime regressions** (§2) — should be ruled out first.
4. **Preview URL rotation** (§7).
5. **`setTrackYear` write volume** (§9).
6. **The scan-path synchronous read** (§9, `App.tsx:127`).
7. **Infra repo has never run an app container.** The `codictive_edge` seam is
   designed but unused, and `Caddyfile.j2` has no `reverse_proxy` path at all.
   Flitster is the first consumer, so that work is greenfield rather than
   configuration (§10).

---

## 12. Decisions still needed

- **`ADMIN_TOKEN` value** — generate one, or supply your own?
- **Domain** — presumably `flitster.codictive.be`. The A record must exist
  *before* the Caddyfile mentions it, since Caddy requests a certificate as soon
  as it sees the hostname. Also becomes the Spotify redirect URI.
- **Runtime secret storage** (§10) — GitHub secrets written to an env file,
  `ansible-vault`, or by hand. This is a gap in the infra repo, not just a
  Flitster choice; whatever is picked sets the pattern for every future app.
- **Container rollback** (§10) — build an `app-release` helper mirroring
  `site-release`, or accept redeploy-to-roll-back for now.
- **Import/export clipboard paths.** With a server they are either admin-only
  tools or vestigial. Keep, gate, or delete?
- **Deck write access.** Assumed admin-only, same as playlists — confirm.

Settled: TanStack Start over Hono; Drizzle for the data layer; Neon retained
rather than self-hosted Postgres; deployed as a container behind the existing
Caddy on the codictive VPS.

---

## 13. Out of scope

Named so they don't creep in:

- User accounts, ownership, per-user playlists.
- Players, scoring, timeline placement — the actual Hitster game rules.
- Offline write queue / conflict resolution.
- Multi-deck support. `deck_cards` is currently *the* deck, not *a* deck.

---

## 14. Sequence

Each step ends at a commit that builds and runs, so any of them can be the
stopping point.

1. **Smoke-test React 19 on a phone.** Camera, flip, both playback paths.
2. **Verify `preview_url`** still comes back for the current client id (risk #2).
3. **Skeleton spike** — Vite 8 + Start + vite-plugin-pwa together, no app code.
   Kills risk #1 before it can contaminate anything.
4. **Drizzle + schema** — define all three tables, generate and run the migration
   for the two new ones.
5. **Server functions** — reads first, then writes with the token guard, then the
   Spotify catalog proxies.
6. **Routes** — `/`, `/deck`, `/playlists`; delete the `screen` state.
7. **Rewire reads** — deck and playlists via Query, localStorage as cache.
   App is fully functional read-only at this point.
8. **Rewire writes** — mutations plus the admin token gate.
9. **Spotify split** — catalog server-side, stored preview URLs, login demoted to
   opt-in for connect mode.
10. **Dockerfile + compose** on the Flitster side; verify the image runs locally.
11. **Infra repo work** (`~/Documents/apps/codictive`) — `apps:` in `sites.yml`,
    `reverse_proxy` rendering in `Caddyfile.j2`, `deploy-app.yml` workflow,
    secret storage. Point DNS at the VPS *before* `make sites`.
12. **Deploy**, register the Spotify redirect URI for the new origin.
13. **Update README** — it currently says "Not built: any server."

Steps 10–11 are a natural split point: everything before them lives in this
repo, and step 11 is entirely in the infra repo. It can be done by someone else,
or at a different time, without blocking the rest.
