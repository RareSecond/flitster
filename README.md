# Deckades

Repurposing a **Marimic** deck (a Hitster clone) so it plays *my* music.

The physical cards carry only a QR code and a printed year — no song title. That
makes the deck a set of anonymous year-slots, and the song on each card is free
for us to decide. This app captures the deck once, then lets you build playlists
that fill those slots however you like.

It is also a deliberate test of whether a **PWA** is enough for this, or whether
the game needs a native app.

## The model

Three things, kept separate:

| | What it is | Changes |
| --- | --- | --- |
| **Deck** | `code → year`. The physical cards. | Captured once, then fixed |
| **Playlist** | A pool of tracks bucketed by year. Tied to no card. | Edited freely |
| **Round** | Scan a card → read its year → draw a track from the union of the **active** playlists | Per scan |

The card never names a song. That indirection is the point: any number of
playlists can be active at once, and the same deck replays with different music.

## Where it is

`years.json` holds the captured deck: **82 cards, 1957–2025**, all pointing at
`forflutna.se/marimic/year/<hash>`. 13 of those years have two cards, which is
why a round draws from a pool rather than mapping a card to a fixed song — three
1985 cards must give three different songs.

Working: database-backed deck capture and playlists, direct track entry, multi-playlist
activation, per-year coverage warnings, QR scanning, and flip-to-play audio previews.
Track IDs and metadata are supplied when creating tracks. Playback uses a saved
HTTPS preview URL directly; there is no Spotify login or track lookup.

## Stack

TanStack Start runs in [SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode).
The document shell is generated once at build time; screens, routing, game logic,
device APIs run in the browser. Routes are `/`,
`/deck`, and `/playlists`. The shared app layout preserves game state between screens.

Start server functions load and save the shared database library. Prisma and
database credentials remain server-only. Deck capture, playlist edits, active
playlists, and song-import progress persist in PostgreSQL; the browser holds only
a working copy. Writes are transactional and reject stale edits from other devices.

## Running it

```bash
npm install
cp .env.example .env.local   # add DATABASE_URL
npm run db:generate
npm run db:deploy
npm run dev
```

Open `https://<your-LAN-IP>:5173/` on the phone and accept the self-signed cert.
HTTPS is not optional — camera and motion sensors both need a secure context.


Tap **debug** for a live capability and sensor readout; that panel is how the PWA
question gets answered.

### Production

```bash
npm run build       # client/server bundles, SPA shell, PWA cache, type check
npm start           # http://localhost:3000; HOST and PORT are configurable
```

Use Node.js 22.12+ (or a newer supported release). Production phone access needs
an HTTPS reverse proxy. Provide
DATABASE_URL to the server at runtime.

The production host serves `dist/client` and the static SPA shell. Only
`/_serverFn/*` and `/api/*` requests reach the Start server handler. To deploy,
include `dist`, `server/serve.mjs`, `package.json`, `package-lock.json`, and install
production dependencies. `npm run preview` provides a local build preview.

A Node server is required for the database. Route `/_serverFn/*` and `/api/*`
to the Node host before applying the SPA fallback.

The service worker precaches the generated shell and all screen chunks for offline
navigation. Loading and saving the database library, preview playback require connectivity. Failed database loads show a retry action. Service
worker generation runs after Start's shell generation so the cache is complete.

Validation: `npm test`, `npm run typecheck`, and (after building)
`npm run test:production`.

## Adding tracks and playing previews

Create a playlist, open **edit**, and supply the Spotify track ID (or URI), title,
artist, and game year. Optionally supply an HTTPS preview audio URL. Existing songs'
preview URLs can be edited in the playlist. JSON playlist import/export also preserves
`previewUrl`. The application makes no Spotify API calls and needs no Spotify credentials.

A track ID identifies a recording; it does not contain a playable audio URL.
Songs without a preview URL remain in the library but are excluded from playback.
The existing seeded songs need preview URLs before they can play. No URLs are guessed
or automatically fetched. The camera tap unlocks audio on iOS, and flipping the phone
starts the saved preview.

## Not built

Separate app accounts, players, scoring, and timeline placement are not built.
The current deployment edits one shared personal library, selected server-side by
`LIBRARY_OWNER_ID` (defaults to `SEED_OWNER_ID`, then `personal-import`). Activations
are shared for that owner. Other owners' lists can be viewed and activated but not
edited. There is no Spotify account connection.
The Codictive deployment is intentionally public without authentication. Anyone
who can reach its URL can view and edit this shared library.

The app no longer stores data in localStorage. Existing `flitster.*` entries are
removed on startup without importing or overwriting the database. Legacy Spotify session entries are also removed on startup. No new browser tokens
or preferences are persisted.

See [database setup](prisma/README.md) for migrations and seed commands.

### Codictive VPS

See [deployment instructions](deploy/README.md) for Docker packaging, the paired
Codictive infrastructure changes, image uploads, public routing, and rollback.
