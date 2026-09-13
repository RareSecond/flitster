import { useLibrary } from '../hooks/useLibrary'
import { useEffect, useMemo, useState } from 'react'
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
  setTrackPreview,
  toggleActive,
  yearWarning,
  type Playlists,
} from '../lib/playlists'

const MAX_ROWS = 150

export function PlaylistScreen({ onBack }: { onBack: () => void }) {
  const library = useLibrary()
  const [lists, setLists] = useState<Playlists>(loadPlaylists)
  const [active, setActive] = useState<string[]>(activeIds)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => { setLists(loadPlaylists()); setActive(activeIds()) }, [library])
  const deck = useMemo(loadDeck, [library])
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
              disabled={busy} onClick={() => guard(async () => { setActive(await toggleActive(p.id)) })}
            >
              <span>
                {active.includes(p.id) ? '● ' : '○ '}
                {p.name}
              </span>
              <em>{p.tracks.length} tracks</em>
            </button>
            <button className="ghost small" onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}>
              {p.id === selectedId ? 'done' : p.readOnly ? 'view' : 'edit'}
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
          disabled={busy} onClick={() => guard(async () => {
            setLists(await createPlaylist(newName))
            setNewName('')
          })}
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
          <h2>{selected.readOnly ? 'Viewing' : 'Editing'} “{selected.name}”</h2>
          {selected.readOnly && <p className="hint">Shared database playlist. This playlist belongs to another owner.</p>}
          {!selected.readOnly && <form onSubmit={e => {
            e.preventDefault()
            const form = e.currentTarget
            const data = new FormData(form)
            const trackId = String(data.get('spotifyId')).trim().replace(/^spotify:track:/, '')
            void guard(async () => {
              if (!/^[A-Za-z0-9]{22}$/.test(trackId)) throw new Error('Enter a valid Spotify track ID or URI.')
              const year = Number(data.get('year'))
              setLists(await addTracks(selected.id, [{
                uri: `spotify:track:${trackId}`, title: String(data.get('title')).trim(),
                artist: String(data.get('artist')).trim(), year, spotifyYear: year, albumName: '',
                previewUrl: String(data.get('previewUrl')).trim() || null,
              }]))
              form.reset()
            })
          }}>
            <fieldset disabled={busy} style={{ border: 0, padding: 0, display: 'grid', gap: 8 }}>
              <legend>Add track</legend>
              <input name="spotifyId" aria-label="Spotify track ID" placeholder="Spotify track ID or URI" required />
              <input name="title" aria-label="Song title" placeholder="Song title" required />
              <input name="artist" aria-label="Artist" placeholder="Artist" required />
              <input name="year" aria-label="Year" placeholder="Year" type="number" min="1000" max="9999" required />
              <input name="previewUrl" aria-label="Preview URL" placeholder="Preview audio URL (optional)" type="url" />
              <button className="ghost" type="submit">Add track</button>
            </fieldset>
            <p className="hint">Provide the track details directly. A preview URL is needed for in-app playback.</p>
          </form>}
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
                <li key={t.id ?? t.uri}>
                  <div className="result static">
                    <span>
                      {t.artist} — {t.title}
                    </span>
                    <em className={warn ? 'warn-text' : ''}>
                      {t.albumName}
                      {t.year !== t.spotifyYear ? ` · was ${t.spotifyYear}` : ''}
                      {warn ? ` · ${warn}` : ''}
                      {!t.previewUrl ? ' · No preview URL' : ''}
                    </em>
                  </div>
                  <input
                    aria-label={`Preview URL for ${t.title}`}
                    key={`preview:${t.id ?? t.uri}:${t.previewUrl ?? ''}`}
                    type="url"
                    placeholder="Preview URL"
                    defaultValue={t.previewUrl ?? ''}
                    disabled={selected.readOnly || busy}
                    onBlur={e => {
                      const input = e.currentTarget
                      if (input.value.trim() === (t.previewUrl ?? '')) return
                      void guard(async () => {
                        try { setLists(await setTrackPreview(selected.id, t.id ?? t.uri, input.value)) }
                        catch (error) { input.value = t.previewUrl ?? ''; throw error }
                      })
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  />
                  <input
                    key={`${t.id ?? t.uri}:${t.year}`}
                    className="yearInput"
                    disabled={selected.readOnly || busy}
                    defaultValue={String(t.year || '')}
                    inputMode="numeric"
                    onBlur={(e) => {
                      const input = e.currentTarget
                      const value = Number(input.value)
                      if (value === t.year) return
                      if (!Number.isInteger(value) || value < 1000 || value > 9999) {
                        input.value = String(t.year)
                        setMessage('Enter a four-digit year.')
                        return
                      }
                      void guard(async () => {
                        try { setLists(await setTrackYear(selected.id, t.id ?? t.uri, value)) }
                        catch (error) { input.value = String(t.year); throw error }
                      })
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  />
                  <button disabled={selected.readOnly || busy} className="ghost small" onClick={() => guard(async () => { setLists(await removeTrack(selected.id, t.id ?? t.uri)) })}>
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
            disabled={selected.readOnly || busy}
            onClick={() => guard(async () => {
              setLists(await deletePlaylist(selected.id))
              setActive(activeIds())
              setSelectedId(null)
            })}
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
              const n = await importPlaylists(await navigator.clipboard.readText())
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
