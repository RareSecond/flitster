# Flitster — server migration spec

Moving Flitster from a single-phone localStorage prototype to a public app on
TanStack Start, backed by the Neon Postgres that already holds the deck.

Status: dependency upgrade done, nothing else started.

---

## 1. What we're building

A public PWA that anyone can open and play with:

- **The deck** (82 cards, 1957–2025) is server-held and world-readable.
- **Playlists** are server-held, world-readable, and **writable only by Jasper**
  via a shared admin token.
- **No user accounts.** Deliberately deferred — see §12.
- Everything still works offline once loaded, because the app is played at
  parties on bad wifi.

The card→song indirection is unchanged and load-bearing: cards carry a *year*,
playlists are *pools bucketed by year*, and a round joins them at scan time.
Playlists never reference a card.

---

## 2. Where we are now

Two commits, both local, nothing pushed:

| commit | what |
| --- | --- |
| `a98fe1f` | Working PWA before dependency overhaul (safety net) |
| `cae2cba` | All dependencies upgraded to latest |

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
cannot exercise. This should be smoke-tested before the migration starts, so a
React 19 regression is not discovered tangled up in a framework change.

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
  └── localStorage — offline cache, Spotify tokens, per-device prefs
        │
        │  server functions (typed RPC)
        ▼
  Start server runtime
  ├── public reads:  getDeck, getPlaylists
  └── admin writes:  guarded by ADMIN_TOKEN
        │
        ▼
  Neon Postgres (plain Postgres; portable)
```

---

## 4. What lives where

This is the decision that everything else follows from.

| State | Today | After | Why |
| --- | --- | --- | --- |
| Deck (`flitster.deck`) | localStorage | **Server**, public read | Shared physical artifact; identical for everyone |
| Playlists (`flitster.playlists`) | localStorage | **Server**, public read / admin write | The thing worth sharing |
| Active playlist ids (`flitster.activePlaylists`) | localStorage | **Stays local** | Per-player session state. A stranger toggling your pools mid-game is a bug |
| Playback mode (`flitster.mode`) | localStorage | **Stays local** | Per-device capability (Premium vs not) |
| Spotify tokens (`flitster.spotify`) | localStorage | **Stays local, always** | Per-user OAuth credentials; must never reach our server |
| Used-tracks set (`usedRef`) | in-memory | **Stays in-memory** | Per-game, dies with the round |

---

## 5. Database schema

Additive. `deck_cards` is untouched.

```sql
CREATE TABLE playlists (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE playlist_tracks (
  playlist_id   text NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  uri           text NOT NULL,
  title         text NOT NULL,
  artist        text NOT NULL,
  year          integer NOT NULL,   -- authoritative, hand-corrected
  spotify_year  integer,            -- what Spotify claimed, kept to show overrides
  album_name    text,
  position      integer NOT NULL,
  PRIMARY KEY (playlist_id, uri)
);

CREATE INDEX playlist_tracks_year_idx ON playlist_tracks (year);
```

Notes:

- `PRIMARY KEY (playlist_id, uri)` enforces the existing de-dup rule in
  `addTracks` at the database level rather than in JS.
- `position` preserves authoring order; the client currently relies on array
  order and would otherwise get arbitrary row order back.
- `year` and `spotify_year` stay separate. The whole game hinges on the year
  being correctable, and we must keep showing what Spotify originally claimed.
- No RLS needed — nothing connects to Postgres except our own server functions.

---

## 6. Server functions

`src/server/db.ts` — one `postgres.js` (or `pg`) client reading `DATABASE_URL`.
No Neon-specific driver, so the database stays swappable.

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
| `addTracks(id, tracks[])` | upsert on `(playlist_id, uri)` |
| `removeTrack(id, uri)` | |
| `setTrackYear(id, uri, year)` | the hand-correction path |
| `addCard(code, year)` | deck capture |
| `removeCard(code)` | |

### Auth model

- `ADMIN_TOKEN` is a server env var. **Never in the client bundle.**
- Jasper pastes it once into a settings field; it lives in *his* localStorage and
  rides as a header on writes.
- Every write function re-checks the token server-side with a timing-safe
  comparison. Hiding the edit UI without a token is cosmetic; the server is the
  enforcement.
- Accepted risk: one shared secret, no revocation beyond rotating the env var.

---

## 7. Routing

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

## 8. Client rewire — the actual work

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
- `:78,:81` `exportDeck` → see §11
- `:87,:88` `importDeck` → see §11
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
- `:292,:302,:303` export/import → see §11

Pure functions in `playlists.ts` — `pickTrack`, `tracksForYear`, `activeTracks`,
`coverage`, `yearWarning` — keep working unchanged once fed from Query instead
of localStorage. They are the stable core; only the loading layer changes.

`setTrackYear` at `:256` deserves attention: it currently fires on every
keystroke against localStorage, which is free. Against a server it needs
debouncing or an on-blur commit, or it will hammer the endpoint.

---

## 9. Offline

Non-negotiable: the game is played at parties on bad wifi.

- Deck and playlists fetch on load, then write through to localStorage under the
  existing keys.
- On fetch failure, fall back to the cached copy and show a stale indicator.
- localStorage demotes from *source of truth* to *cache*. The keys stay the
  same, so an existing phone's data survives as a warm cache.
- Writes are admin-only and require connectivity. No offline write queue — not
  worth building for a single author.
- Service worker precaches the app shell exactly as it does today.

---

## 10. Known risks

1. **Start + vite-plugin-pwa coexistence.** Not settled from the registry alone.
   Validate in a throwaway skeleton *before* moving any application code.
2. **React 19 runtime regressions** (§2) — should be ruled out first.
3. **`setTrackYear` write volume** (§8).
4. **The scan-path synchronous read** (§8, `App.tsx:127`).

---

## 11. Decisions still needed

- **`ADMIN_TOKEN` value** — generate one, or supply your own?
- **Deploy target.** Start is host-agnostic via presets, so this no longer
  changes file layout, but it does decide the public origin. Needed before the
  Spotify redirect URI can be registered.
- **Public origin / domain** — the Spotify dashboard redirect URI must move off
  `https://192.168.1.11:5173/`. Every user runs their own PKCE flow against your
  client id, which already works, but the new URI must be registered.
- **Import/export clipboard paths.** With a server they are either admin-only
  tools or vestigial. Keep, gate, or delete?
- **Deck write access.** Assumed admin-only, same as playlists — confirm.

---

## 12. Out of scope

Named so they don't creep in:

- User accounts, ownership, per-user playlists.
- Players, scoring, timeline placement — the actual Hitster game rules.
- Offline write queue / conflict resolution.
- Multi-deck support. `deck_cards` is currently *the* deck, not *a* deck.

---

## 13. Sequence

Each step ends at a commit that builds and runs, so any of them can be the
stopping point.

1. **Smoke-test React 19 on a phone.** Camera, flip, both playback paths.
2. **Skeleton spike** — Vite 8 + Start + vite-plugin-pwa together, no app code.
   Kills risk #1 before it can contaminate anything.
3. **Schema** — create `playlists` and `playlist_tracks` in Neon.
4. **Server functions** — reads first, then writes with the token guard.
5. **Routes** — `/`, `/deck`, `/playlists`; delete the `screen` state.
6. **Rewire reads** — deck and playlists via Query, localStorage as cache.
   App is fully functional read-only at this point.
7. **Rewire writes** — mutations plus the admin token gate.
8. **Deploy** — public origin, register Spotify redirect URI, set env vars.
9. **Update README** — it currently says "Not built: any server."
