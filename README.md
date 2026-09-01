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

## Running it

```bash
npm install
cp .env.example .env.local   # add a Spotify client id
npm run dev
```

Open `https://192.168.1.11:5173/` on the phone and accept the self-signed cert.
HTTPS is not optional — camera and motion sensors both need a secure context.
Register that exact URL as the redirect URI in the Spotify dashboard.

Tap **debug** for a live capability and sensor readout; that panel is how the PWA
question gets answered.

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

## Not built

Any server. Everything is `localStorage` on one phone, with JSON export/import
(`DeckCard[]`, `Playlist[]`) as the migration path. A real version needs a shared
backend so a deck is captured once for everyone who owns it and playlists can be
authored on a laptop. Also missing: players, scoring, timeline placement.
