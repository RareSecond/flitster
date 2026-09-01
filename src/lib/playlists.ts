import type { Deck } from './deck'
import { byYear } from './deck'

/**
 * A playlist is a *pool of tracks bucketed by year*, not a per-card mapping.
 * Scanning a card yields a year (from the deck); the track is then drawn at
 * play time from the union of whichever playlists are currently active. That is
 * what lets several playlists be combined, and the same deck to be replayed with
 * completely different music.
 */
const KEY = 'flitster.playlists'
const ACTIVE_KEY = 'flitster.activePlaylists'

export type PlaylistTrack = {
  uri: string
  title: string
  artist: string
  /** The year the game uses. Authoritative, and hand-correctable. */
  year: number
  /** What Spotify's release_date claimed, kept to show overrides. */
  spotifyYear: number
  albumName: string
}

export type Playlist = {
  id: string
  name: string
  tracks: PlaylistTrack[]
  createdAt: string
}

export type Playlists = Record<string, Playlist>

export function loadPlaylists(): Playlists {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Playlists
  } catch {
    return {}
  }
}

const persist = (p: Playlists) => {
  localStorage.setItem(KEY, JSON.stringify(p))
  return p
}

const newId = () => Math.random().toString(36).slice(2, 10)

export function createPlaylist(name: string): Playlists {
  const id = newId()
  return persist({
    ...loadPlaylists(),
    [id]: { id, name: name.trim() || 'Untitled', tracks: [], createdAt: new Date().toISOString() },
  })
}

export function deletePlaylist(id: string): Playlists {
  const all = loadPlaylists()
  delete all[id]
  setActiveIds(activeIds().filter((a) => a !== id))
  return persist(all)
}

export function renamePlaylist(id: string, name: string): Playlists {
  const all = loadPlaylists()
  if (all[id]) all[id] = { ...all[id], name }
  return persist(all)
}

export function addTracks(id: string, tracks: PlaylistTrack[]): Playlists {
  const all = loadPlaylists()
  const list = all[id]
  if (!list) return all
  const seen = new Set(list.tracks.map((t) => t.uri))
  all[id] = { ...list, tracks: [...list.tracks, ...tracks.filter((t) => !seen.has(t.uri))] }
  return persist(all)
}

export function removeTrack(id: string, uri: string): Playlists {
  const all = loadPlaylists()
  const list = all[id]
  if (list) all[id] = { ...list, tracks: list.tracks.filter((t) => t.uri !== uri) }
  return persist(all)
}

export function setTrackYear(id: string, uri: string, year: number): Playlists {
  const all = loadPlaylists()
  const list = all[id]
  if (list) {
    all[id] = {
      ...list,
      tracks: list.tracks.map((t) => (t.uri === uri ? { ...t, year } : t)),
    }
  }
  return persist(all)
}

// --- activation -----------------------------------------------------------

export function activeIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function setActiveIds(ids: string[]): string[] {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(ids))
  return ids
}

export const toggleActive = (id: string): string[] => {
  const current = activeIds()
  return setActiveIds(current.includes(id) ? current.filter((i) => i !== id) : [...current, id])
}

/** Union of the active pools, de-duplicated: pools are allowed to overlap. */
export function activeTracks(): PlaylistTrack[] {
  const all = loadPlaylists()
  const seen = new Set<string>()
  const out: PlaylistTrack[] = []
  for (const id of activeIds()) {
    for (const t of all[id]?.tracks ?? []) {
      if (!seen.has(t.uri)) {
        seen.add(t.uri)
        out.push(t)
      }
    }
  }
  return out
}

export const tracksForYear = (year: number) => activeTracks().filter((t) => t.year === year)

/**
 * Draw a track for a scanned card. Unplayed tracks win, so a deck holding three
 * 1985 cards yields three different songs; once a year is exhausted we repeat
 * rather than stall the game.
 */
export function pickTrack(
  year: number,
  used: Set<string>,
): { track: PlaylistTrack; repeat: boolean } | null {
  const candidates = tracksForYear(year)
  if (candidates.length === 0) return null
  const fresh = candidates.filter((t) => !used.has(t.uri))
  const pool = fresh.length > 0 ? fresh : candidates
  return { track: pool[Math.floor(Math.random() * pool.length)], repeat: fresh.length === 0 }
}

/**
 * Per-year reality check: a year with 3 cards needs 3 tracks in the active
 * pools, or the third card has nothing to play.
 */
export function coverage(deck: Deck) {
  const tracks = activeTracks()
  const perYear = new Map<number, number>()
  for (const t of tracks) perYear.set(t.year, (perYear.get(t.year) ?? 0) + 1)
  return byYear(deck).map(({ year, cards }) => {
    const available = perYear.get(year) ?? 0
    return { year, cards: cards.length, tracks: available, short: Math.max(0, cards.length - available) }
  })
}

const REISSUE =
  /remaster|greatest hits|best of|anthology|collection|deluxe|anniversary|essential|the hits|re-?record/i

/**
 * Spotify's release_date is the date of the *album that matched*, not of the
 * song. A 1985 single found on a 2015 reissue reports 2015 -- and the year is
 * the entire game, so these need a human.
 */
export function yearWarning(albumName: string, albumType: string, year: number): string | null {
  if (albumType === 'compilation') return 'Compilation — release date is probably not the original year.'
  if (REISSUE.test(albumName)) return 'Looks like a reissue — check the original year.'
  if (!year || year < 1900) return 'No usable year from Spotify.'
  if (year > new Date().getFullYear()) return 'Year is in the future.'
  return null
}

export const exportPlaylists = () => JSON.stringify(Object.values(loadPlaylists()), null, 2)

export function importPlaylists(text: string): number {
  const rows = JSON.parse(text) as Playlist[]
  if (!Array.isArray(rows)) throw new Error('Expected a JSON array of playlists')
  const all = loadPlaylists()
  for (const p of rows) if (p?.id && Array.isArray(p.tracks)) all[p.id] = p
  persist(all)
  return rows.length
}
