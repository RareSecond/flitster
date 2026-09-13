import { useEffect, useRef, useState } from 'react'
import { searchTracks, type TrackMatch } from '../lib/spotifyApi'
import { acceptImportMatches, loadPlaylists, resolveImportSong, type Playlist, type Playlists } from '../lib/playlists'
import { exactMatch } from '../lib/songImport'

export function SongImport({ playlist, onChange }: { playlist: Playlist; onChange: (p: Playlists) => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => { controller.current?.abort() }, [])
  const songs = playlist.importSongs ?? []
  const pending = songs.filter(s => s.status === 'pending').length
  const reviews = songs.filter(s => s.status === 'review').length
  const reviewIndex = songs.findIndex(s => s.status === 'review')
  const review = songs[reviewIndex]

  const run = async () => {
    if (controller.current) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    try {
      for (let i = 0; i < songs.length; i++) {
        const song = loadPlaylists()[playlist.id]?.importSongs?.[i]
        if (!song || abort.signal.aborted) break
        if (song.status !== 'pending') continue
        setMessage(`Matching ${i + 1}/${songs.length}: ${song.artist} — ${song.title}`)
        const candidates = await searchTracks(`${song.artist} ${song.title}`, 8, abort.signal)
        if (abort.signal.aborted) break
        const match = exactMatch(song, candidates)
        const conflict = match && loadPlaylists()[playlist.id]?.tracks.some(t => t.uri === match.uri && t.year !== song.year)
        onChange(resolveImportSong(playlist.id, i, match && !conflict ? 'added' : 'review',
          match && !conflict ? undefined : candidates, match && !conflict ? match : undefined))
        await new Promise(resolve => setTimeout(resolve, 400))
      }
      setMessage(abort.signal.aborted ? 'Paused. Your progress is saved.' : 'Matching finished. Review any remaining songs below.')
    } catch (e) {
      setMessage(abort.signal.aborted ? 'Paused. Your progress is saved.' : `${String(e)} Progress is saved; resume when ready.`)
    } finally {
      controller.current = null
      setBusy(false)
    }
  }

  const choose = (match?: TrackMatch) => {
    try {
      onChange(resolveImportSong(playlist.id, reviewIndex, match ? 'added' : 'skipped', undefined, match))
      setQuery('')
      setMessage(match ? 'Song added using the year from your file.' : 'Song skipped.')
    } catch (e) { setMessage(String(e)) }
  }

  const search = async () => {
    if (controller.current || !review) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    try {
      const candidates = await searchTracks(query || `${review.artist} ${review.title}`, 8, abort.signal)
      if (!abort.signal.aborted) onChange(resolveImportSong(playlist.id, reviewIndex, 'review', candidates))
    } catch (e) { if (!abort.signal.aborted) setMessage(String(e)) }
    finally { controller.current = null; setBusy(false) }
  }

  return <section>
    <h2>Song-list import</h2>
    <p className="hint">{songs.filter(s => s.status === 'added').length} of {songs.length} songs resolved · {pending} pending · {reviews} to review · {songs.filter(s => s.status === 'skipped').length} skipped</p>
    <p className="hint">Years from your file are preserved. When multiple recordings match the artist and title, the first Spotify match is used.</p>
    {reviews > 0 && <button className="primary" disabled={busy} onClick={() => {
      try {
        const result = acceptImportMatches(playlist.id)
        onChange(result.playlists)
        setQuery('')
        setMessage(`Accepted ${result.accepted} songs using your years. ${result.remaining} still need a recording match or have a year conflict.`)
      } catch (e) { setMessage(String(e)) }
    }}>Accept matching songs — keep our years</button>}
    {pending > 0 && <button className="primary" disabled={busy} onClick={run}>Match songs on Spotify</button>}
    {busy && <button className="ghost" onClick={() => controller.current?.abort()}>Pause import</button>}
    <p role="status" className="hint">{message}</p>
    {review && !busy && <>
      <h3>Review: {review.artist} — {review.title} ({review.year})</h3>
      <div className="row">
        <input aria-label="Search for import match" placeholder={`${review.artist} ${review.title}`} value={query} onChange={e => setQuery(e.target.value)} />
        <button className="ghost" onClick={search}>Find alternatives</button>
      </div>
      {!review.candidates?.length && <p className="hint">No matches found. Try another spelling or skip this song.</p>}
      <ul className="results">{review.candidates?.map(t => <li key={t.uri}>
        <button className="result" onClick={() => choose(t)}><span>{t.artist} — {t.title}</span><em>{t.albumName} · Spotify year {t.year} · use {review.year}</em></button>
      </li>)}</ul>
      <button className="ghost" onClick={() => choose()}>Skip this song</button>
    </>}
  </section>
}
