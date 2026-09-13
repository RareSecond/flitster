# Flitster

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

Working: deck capture, playlist pools with Spotify import/search, multi-playlist
activation, per-year coverage warnings, QR scanning, flip-to-play, and both
playback paths (in-app 30s preview, or remote-controlling the Spotify app).

## Stack

TanStack Start runs in [SPA mode](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode).
The document shell is generated once at build time; screens, routing, game logic,
device APIs, local storage, and Spotify PKCE run in the browser. Routes are `/`,
`/deck`, and `/playlists`. The shared app layout preserves game state between screens.

Reserve Start server functions for fetching or creating shared data. The existing
Prisma client remains server-only; this migration does not change data storage.

## Running it

```bash
npm install
cp .env.example .env.local   # add a Spotify client id
npm run dev
```

Open `https://<your-LAN-IP>:5173/` on the phone and accept the self-signed cert.
HTTPS is not optional — camera and motion sensors both need a secure context.
Register that exact URL as the redirect URI in the Spotify dashboard.

Tap **debug** for a live capability and sensor readout; that panel is how the PWA
question gets answered.

### Production

```bash
npm run build       # client/server bundles, SPA shell, PWA cache, type check
npm start           # http://localhost:3000; HOST and PORT are configurable
```

Use Node.js 22.12+ (or a newer supported release). Production phone access needs
an HTTPS reverse proxy. Keep the same public origin to retain browser data and
the registered Spotify redirect URI.

The production host serves `dist/client` and the static SPA shell. Only
`/_serverFn/*` and `/api/*` requests reach the Start server handler. To deploy,
include `dist`, `server/serve.mjs`, `package.json`, `package-lock.json`, and install
production dependencies. `npm run preview` provides a local build preview.

Static hosting can serve `dist/client` with a fallback to `/_shell.html`.
When data actions are added, route `/_serverFn/*` and `/api/*` to the Node host
before applying that fallback.

The service worker precaches the generated shell and all screen chunks for offline
navigation. Spotify API calls and playback still require connectivity. Service
worker generation runs after Start's shell generation so the cache is complete.

Validation: `npm test`, `npm run typecheck`, and (after building)
`npm run test:production`.

## The two things that decide the outcome

1. **Playback.** Spotify's Web Playback SDK does not work on mobile browsers, so
   a PWA cannot be the player. Two ways around it: play the 30s `preview_url`
   clip in an in-app `<audio>` element (no Premium, no app switch), or
   remote-control the installed Spotify app over Connect (full track, Premium
   required). Both are built and toggleable. The catch on the preview path is
   that iOS only starts audio from a user gesture, and our trigger is a
   `devicemotion` event — so the audio element is unlocked with 50ms of silence
   on the scan tap and reused at flip time.
2. **The year is the game, and Spotify lies about it.** `release_date` is the
   date of the *album that matched*, not of the song — a 1985 single on a 2015
   reissue reports 2015. Imported years are prefilled, compilations and
   reissue-shaped album names are flagged, and every year is hand-editable.

## Importing a song list

In **Playlists**, choose **Import Belgian Hitster (194 songs)** to prepare the
included 1960–2025 list, then **Match songs on Spotify** using your Spotify login.
The playlist is activated automatically. The first exact artist/title match is
added regardless of Spotify's album year; missing matches stay in a review queue with alternate search
and skip controls. The supplied year is retained, even when Spotify reports a
different album year. Review the recordings and years before playing.
Use **Accept matching songs — keep our years** to apply this to an existing review
queue. Songs with no exact match or an existing conflicting year remain for review.

You can also upload a JSON array of `{ "artist": "…", "title": "…", "year": 1960 }`.
Progress is saved on this browser after each song. Reopen the playlist to resume
after pausing, a reload, or an API error. Export includes the pending review queue.
The bundled import button reopens the same playlist without resetting progress.

## Not built

The UI has no server integration yet. Everything in the UI is `localStorage` on one phone, with JSON export/import
(`DeckCard[]`, `Playlist[]`) as the migration path. A real version needs a shared
backend so a deck is captured once for everyone who owns it and playlists can be
authored on a laptop. Also missing: players, scoring, timeline placement.

Prisma and the Neon database schema are now set up, with the captured deck and
accepted Belgian list imported. See [database setup](prisma/README.md) for the
model, migrations, and seed commands. Connecting the UI and adding authentication
are the next steps; TanStack Start is configured for client-side rendering.
