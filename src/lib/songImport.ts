import type { TrackMatch } from './spotifyApi'
import type { PlaylistTrack } from './playlists'

export type Song = { artist: string; title: string; year: number }
export type ImportSong = Song & {
  status: 'pending' | 'review' | 'added' | 'skipped'
  candidates?: TrackMatch[]
}

export function parseSongs(value: unknown): ImportSong[] {
  if (!Array.isArray(value) || !value.length) throw new Error('Expected a non-empty song array.')
  return value.map((row, i) => {
    if (!row || typeof row.artist !== 'string' || !row.artist.trim() ||
      typeof row.title !== 'string' || !row.title.trim() ||
      !Number.isInteger(row.year) || row.year < 1900 || row.year > 2100) {
      throw new Error(`Song ${i + 1} needs an artist, title, and valid year.`)
    }
    return { artist: row.artist.trim(), title: row.title.trim(), year: row.year, status: 'pending' }
  })
}

const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** Prefer Spotify's first exact artist/title result, regardless of album year. */
export function exactMatch(song: Song, candidates: TrackMatch[]): TrackMatch | undefined {
  const matches = [...new Map(candidates.filter(t =>
    normalize(t.title) === normalize(song.title) && normalize(t.artist) === normalize(song.artist)
  ).map(t => [t.uri, t])).values()]
  return matches[0]
}

export function importedTrack(song: Song, match: TrackMatch): PlaylistTrack {
  return { uri: match.uri, title: match.title, artist: match.artist,
    year: song.year, spotifyYear: match.year, albumName: match.albumName }
}
