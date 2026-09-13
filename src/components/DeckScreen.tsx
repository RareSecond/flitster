import { useLibrary } from '../hooks/useLibrary'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQrScanner } from '../hooks/useQrScanner'
import {
  addCard,
  byYear,
  exportDeck,
  importDeck,
  loadDeck,
  removeCard,
  shortCode,
  type Deck,
} from '../lib/deck'

/** Ignore re-decodes of the card you just entered while it is still in frame. */
const COOLDOWN_MS = 2500

export function DeckScreen({ onBack }: { onBack: () => void }) {
  const library = useLibrary()
  useEffect(() => { setDeck(loadDeck()) }, [library])
  const [busy, setBusy] = useState(false)
  const [deck, setDeck] = useState<Deck>(loadDeck)
  const [pending, setPending] = useState<string | null>(null)
  const [digits, setDigits] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const pendingRef = useRef<string | null>(null)
  const cooldownRef = useRef<{ code: string; until: number } | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  const scanner = useQrScanner(
    useCallback((value: string) => {
      const code = value.trim()
      // One card at a time: hold the camera's output until this one is entered.
      if (pendingRef.current) return
      const cd = cooldownRef.current
      if (cd && cd.code === code && Date.now() < cd.until) return
      pendingRef.current = code
      setPending(code)
      setDigits('')
    }, []),
  )
  stopRef.current = scanner.stop

  const groups = useMemo(() => byYear(deck), [deck])
  const total = Object.keys(deck).length

  const commit = useCallback(
    async (year: string) => {
      const code = pendingRef.current
      const parsed = Number(year)
      if (!code || parsed < 1000 || parsed > 9999 || busy) return
      setBusy(true)
      try { setDeck(await addCard(code, parsed)) } catch (e) { setMessage(String(e)); return } finally { setBusy(false) }
      setToast(`${parsed} · ${shortCode(code)}`)
      cooldownRef.current = { code, until: Date.now() + COOLDOWN_MS }
      pendingRef.current = null
      setPending(null)
      setDigits('')
    },
    [busy],
  )

  const press = (d: string) => {
    const next = (digits + d).slice(0, 4)
    setDigits(next)
    // Years are always four digits, so entry can commit itself -- that is the
    // difference between a 20-minute deck capture and an hour of tapping Save.
    if (next.length === 4) commit(next)
  }

  const skip = () => {
    const code = pendingRef.current
    if (code) cooldownRef.current = { code, until: Date.now() + COOLDOWN_MS }
    pendingRef.current = null
    setPending(null)
    setDigits('')
  }

  const doExport = async () => {
    try {
      await navigator.clipboard.writeText(exportDeck())
      setMessage(`Copied ${total} cards to the clipboard.`)
    } catch {
      setMessage(exportDeck())
    }
  }

  const doImport = async () => {
    setBusy(true)
    try {
      const n = await importDeck(await navigator.clipboard.readText())
      setDeck(loadDeck())
      setMessage(`Imported ${n} cards.`)
    } catch (e) {
      setMessage(`Import failed: ${e}`)
    } finally { setBusy(false) }
  }

  const existing = pending ? deck[pending] : undefined

  return (
    <div className="stage" style={{ alignItems: 'stretch' }}>
      <div className="modes">
        <button className="seg" onClick={onBack}>
          ← Play
        </button>
        <button className="seg on">Deck ({total})</button>
      </div>

      <p className="hint">
        Scan each card and type the year printed on it. This captures the physical deck once;
        which song plays is decided by your playlists. Cards and changes are saved in the shared database.
      </p>

      <div className={`camera ${scanner.active ? 'live' : ''}`}>
        <video ref={scanner.videoRef} playsInline muted />
        <canvas ref={scanner.canvasRef} hidden />
        {scanner.active && !pending && <div className="reticle" />}
        {toast && !pending && <div className="toast">{toast}</div>}
      </div>

      {!scanner.active && (
        <button className="primary" onClick={() => scanner.start()}>
          Start capturing
        </button>
      )}

      {scanner.active && !pending && <p className="hint">Point at the next card…</p>}

      {pending && (
        <>
          <div className="banner">
            <strong>{shortCode(pending)}</strong>
            <div className="hint mono">{pending}</div>
            {existing && <div className="hint warn-text">Already captured as {existing.year}.</div>}
          </div>

          <div className="yearDisplay">{digits.padEnd(4, '·')}</div>

          <fieldset className="pad" disabled={busy} style={{ border: 0, padding: 0 }}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} className="key" onClick={() => press(d)}>
                {d}
              </button>
            ))}
            <button className="key ghost" onClick={skip}>
              skip
            </button>
            <button className="key" onClick={() => press('0')}>
              0
            </button>
            <button className="key ghost" onClick={() => setDigits(digits.slice(0, -1))}>
              ⌫
            </button>
          </fieldset>
        </>
      )}

      {message && <p className="banner">{message}</p>}
      {scanner.error && <p className="banner warn">{scanner.error}</p>}

      {total > 0 && (
        <>
          <h2>
            {total} cards · {groups.length} years
          </h2>
          <ul className="results">
            {groups.map(({ year, cards }) => (
              <li key={year}>
                <div className="result static">
                  <span>
                    <strong>{year}</strong>
                    {cards.length > 1 ? ` · ${cards.length} cards` : ''}
                  </span>
                  <em>{cards.map((c) => shortCode(c.code)).join(', ')}</em>
                </div>
                <button disabled={busy} className="ghost small" onClick={async () => {
                  setBusy(true)
                  try { setDeck(await removeCard(cards[0].code)) } catch (e) { setMessage(String(e)) } finally { setBusy(false) }
                }}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="row">
            <button className="ghost wide" onClick={doExport}>
              Export deck
            </button>
            <button className="ghost wide" disabled={busy} onClick={doImport}>
              Import
            </button>
          </div>
        </>
      )}
    </div>
  )
}
