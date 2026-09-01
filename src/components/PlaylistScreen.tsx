import { useMemo, useState } from 'react'
import { getCurrentlyPlaying, getPlaylistTracks, searchTracks, type TrackMatch } from '../lib/spotifyApi'
import { loadDeck } from '../lib/deck'
import {
  activeIds,
  addTracks,
  coverage,
  createPlaylist,
  deletePlaylist,
  exportPlaylists,
  importPlaylists,
  loadPlaylists,
  removeTrack,
  setTrackYear,
  toggleActive,
  yearWarning,
  type PlaylistTrack,
  type Playlists,
} from '../lib/playlists'

const MAX_ROWS = 150

const toPlaylistTrack = (t: TrackMatch): PlaylistTrack => ({
  uri: t.uri,
  title: t.title,
  artist: t.artist,
  year: t.year,
  spotifyYear: t.year,
  albumName: t.albumName,
})

export function PlaylistScreen({ onBack }: { onBack: () => void }) {
  const [lists, setLists] = useState<Playlists>(loadPlaylists)
  const [active, setActive] = useState<string[]>(activeIds)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TrackMatch[]>([])
  const [importUrl, setImportUrl] = useState('')
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const deck = useMemo(loadDeck, [])
  // Recomputed against `active` so the shortfall reacts to what you switch on.
  const cover = useMemo(() => coverage(deck), [deck, active, lists])
  const gaps = cover.filter((c) => c.short > 0)

  const selected = selectedId ? lists[selectedId] : null

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    try {
      await fn()
    } catch (e) {
      setMessage(String(e))
    } finally {
      setBusy(false)
    }
  }

  const addFromCurrent = () =>
    guard(async () => {
      const t = await getCurrentlyPlaying()
      if (!t) return setMessage('Nothing is playing on Spotify right now.')
      if (selectedId) setLists(addTracks(selectedId, [toPlaylistTrack(t)]))
    })

  const runSearch = () =>
    guard(async () => {
      setResults(await searchTracks(query))
    })

  const importSpotify = () =>
    guard(async () => {
      if (!selectedId) return
      const tracks = await getPlaylistTracks(importUrl)
      setLists(addTracks(selectedId, tracks.map(toPlaylistTrack)))
      setMessage(`Added ${tracks.length} tracks. Check the flagged years.`)
      setImportUrl('')
    })

  const visible = useMemo(() => {
    if (!selected) return []
    const q = filter.trim().toLowerCase()
    const rows = q
      ? selected.tracks.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            String(t.year).includes(q),
        )
      : selected.tracks
    return rows.slice(0, MAX_ROWS)
  }, [selected, filter])

  return (
    <div className="stage" style={{ alignItems: 'stretch' }}>
      <div className="modes">
        <button className="seg" onClick={onBack}>
          ← Play
        </button>
        <button className="seg on">Playlists</button>
      </div>

      <p className="hint">
        Activate any number of playlists. Scanning a card reads its year and draws a track from
        the combined pool, preferring ones you have not heard yet this game.
      </p>

      <ul className="results">
        {Object.values(lists).map((p) => (
          <li key={p.id}>
            <button
              className={active.includes(p.id) ? 'result on' : 'result'}
              onClick={() => setActive(toggleActive(p.id))}
            >
              <span>
                {active.includes(p.id) ? '● ' : '○ '}
                {p.name}
              </span>
              <em>{p.tracks.length} tracks</em>
            </button>
            <button className="ghost small" onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}>
              {p.id === selectedId ? 'done' : 'edit'}
            </button>
          </li>
        ))}
      </ul>

      <div className="row">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New playlist name"
        />
        <button
          className="ghost"
          onClick={() => {
            setLists(createPlaylist(newName))
            setNewName('')
          }}
        >
          Create
        </button>
      </div>

      {Object.keys(deck).length > 0 && (
        <>
          <h2>Coverage</h2>
          {gaps.length === 0 ? (
            <p className="hint ok">Every year in the deck has enough tracks.</p>
          ) : (
            <ul className="results">
              {gaps.map((c) => (
                <li key={c.year}>
                  <div className="result static">
                    <span>
                      <strong>{c.year}</strong> · {c.cards} card{c.cards > 1 ? 's' : ''}, {c.tracks}{' '}
                      track{c.tracks === 1 ? '' : 's'}
                    </span>
                    <em className="warn-text">need {c.short} more</em>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {selected && (
        <>
          <h2>Editing “{selected.name}”</h2>

          <button className="ghost wide" onClick={addFromCurrent} disabled={busy}>
            Add what's playing on Spotify
          </button>

          <div className="row">
            <input
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="Paste a Spotify playlist link"
            />
            <button className="ghost" onClick={importSpotify} disabled={busy || !importUrl}>
              Import
            </button>
          </div>

          <div className="row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="Search artist / title"
            />
            <button className="ghost" onClick={runSearch} disabled={busy}>
              Search
            </button>
          </div>

          {results.length > 0 && (
            <ul className="results">
              {results.map((t) => (
                <li key={t.uri}>
                  <button
                    className="result"
                    onClick={() => {
                      setLists(addTracks(selected.id, [toPlaylistTrack(t)]))
                      setResults([])
                      setQuery('')
                    }}
                  >
                    <span>
                      {t.artist} — {t.title}
                    </span>
                    <em>
                      {t.year} · {t.albumName}
                    </em>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="row">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filter ${selected.tracks.length} tracks`}
            />
          </div>

          <ul className="results">
            {visible.map((t) => {
              const warn = yearWarning(t.albumName, '', t.year)
              return (
                <li key={t.uri}>
                  <div className="result static">
                    <span>
                      {t.artist} — {t.title}
                    </span>
                    <em className={warn ? 'warn-text' : ''}>
                      {t.albumName}
                      {t.year !== t.spotifyYear ? ` · was ${t.spotifyYear}` : ''}
                      {warn ? ` · ${warn}` : ''}
                    </em>
                  </div>
                  <input
                    className="yearInput"
                    value={String(t.year || '')}
                    inputMode="numeric"
                    onChange={(e) =>
                      setLists(
                        setTrackYear(selected.id, t.uri, Number(e.target.value.replace(/\D/g, '').slice(0, 4))),
                      )
                    }
                  />
                  <button className="ghost small" onClick={() => setLists(removeTrack(selected.id, t.uri))}>
                    ✕
                  </button>
                </li>
              )
            })}
          </ul>
          {selected.tracks.length > visible.length && (
            <p className="hint">
              Showing {visible.length} of {selected.tracks.length} — filter to see the rest.
            </p>
          )}

          <button
            className="ghost wide"
            onClick={() => {
              setLists(deletePlaylist(selected.id))
              setActive(activeIds())
              setSelectedId(null)
            }}
          >
            Delete “{selected.name}”
          </button>
        </>
      )}

      {message && <p className="banner">{message}</p>}

      <div className="row">
        <button
          className="ghost wide"
          onClick={async () => {
            await navigator.clipboard.writeText(exportPlaylists()).catch(() => undefined)
            setMessage('Playlists copied to the clipboard.')
          }}
        >
          Export
        </button>
        <button
          className="ghost wide"
          onClick={async () => {
            try {
              const n = importPlaylists(await navigator.clipboard.readText())
              setLists(loadPlaylists())
              setMessage(`Imported ${n} playlists.`)
            } catch (e) {
              setMessage(`Import failed: ${e}`)
            }
          }}
        >
          Import
        </button>
      </div>
    </div>
  )
}
