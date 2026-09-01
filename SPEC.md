# Flitster — server migration spec

Moving Flitster from a single-phone localStorage prototype to a public app on
TanStack Start, backed by the Neon Postgres that already holds the deck, and
deployed to a Linux server with Docker.

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

Deployed as two containers behind Caddy on a Linux server — see §10.

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

Target: a Linux server, Docker, Neon stays remote.

```
Internet ──► Caddy (:80/:443, automatic Let's Encrypt)
                │
                └──► flitster (Start node-server preset, :3000)
                          │
                          └──► Neon Postgres (remote)
```

- **Multi-stage Dockerfile** on `node:24-alpine`: install → build → copy the
  Start node-server output into a slim runtime stage.
- **Caddy** terminates TLS with automatic certificates. This finally replaces the
  self-signed LAN cert, and it matters more than usual here: camera and
  `devicemotion` both require a secure context, so a real certificate is a
  functional requirement, not hygiene.
- **Compose** with two services, `app` and `caddy`. No Postgres service — Neon is
  remote and stays that way.
- **Migrations** run via `drizzle-kit` as an explicit step, not on container
  start. Automatic migration-on-boot makes rollbacks unpleasant.

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

---

## 12. Decisions still needed

- **`ADMIN_TOKEN` value** — generate one, or supply your own?
- **Domain / public origin** — needed for Caddy and the Spotify redirect URI.
- **Import/export clipboard paths.** With a server they are either admin-only
  tools or vestigial. Keep, gate, or delete?
- **Deck write access.** Assumed admin-only, same as playlists — confirm.

Settled: TanStack Start over Hono; Drizzle for the data layer; Neon retained
rather than self-hosted Postgres; Docker + Caddy on a Linux server.

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
10. **Docker + Caddy**, deploy, register the redirect URI.
11. **Update README** — it currently says "Not built: any server."
