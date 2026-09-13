import { useLibrary } from './hooks/useLibrary'
import { getLibrary } from './lib/library.functions'
import { setDatabaseLibrary } from './lib/library'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { useQrScanner } from './hooks/useQrScanner'
import { useFlipDetector } from './hooks/useFlipDetector'
import { useAudioPreview } from './hooks/useAudioPreview'
import { probeCapabilities } from './lib/capabilities'
import { loadDeck, shortCode } from './lib/deck'
import { activeIds, pickTrack, type PlaylistTrack } from './lib/playlists'

type Phase = 'idle' | 'scanning' | 'armed' | 'playing' | 'error'

/** One scanned card: the year comes from the deck, the track from the pools. */
type Round = { code: string; year: number; track: PlaylistTrack; repeat: boolean }

export default function App() {
  useLibrary()
  const [libraryState, setLibraryState] = useState<'loading' | 'ready' | 'error'>('loading')
  const loadLibrary = useCallback(async () => {
    setLibraryState('loading')
    try {
      setDatabaseLibrary(await getLibrary())
      setLibraryState('ready')
    } catch { setLibraryState('error') }
  }, [])
  useEffect(() => {
    // Retire the old app-owned data without touching unrelated origin keys.
    try {
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith('flitster.spotify.')) sessionStorage.removeItem(key)
      }
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('flitster.')) localStorage.removeItem(key)
      }
    } catch { /* Browser storage may be disabled. The database still works. */ }
    void loadLibrary()
  }, [loadLibrary])
  const [phase, setPhase] = useState<Phase>('idle')
  const pathname = useLocation({ select: (location) => location.pathname })
  const navigate = useNavigate()
  const isPlayScreen = pathname === '/'
  const [round, setRound] = useState<Round | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const capabilities = useMemo(probeCapabilities, [])
  const audio = useAudioPreview()

  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null)
  /** Tracks already drawn this game, so repeated years give different songs. */
  const usedRef = useRef<Set<string>>(new Set())
  const claimedRef = useRef(false)
  const stopRef = useRef<(() => void) | null>(null)
  const previewUrlRef = useRef<string | null>(null)

  // The flip fires from a sensor event that closed over an earlier render.
  const roundRef = useRef<Round | null>(null)
  roundRef.current = round
  const startPlayback = useCallback(async () => {
    const current = roundRef.current
    const url = previewUrlRef.current
    if (!current || !url) return
    setPhase('playing')
    const ok = await audio.play(url, { title: current.track.title, artist: current.track.artist })
    if (!ok) {
      setPhase('error')
      setMessage('Could not play this preview. Check the saved preview URL and try again.')
    }
  }, [audio])

  const flip = useFlipDetector({ armed: phase === 'armed', onFlip: startPlayback })

  const scanner = useQrScanner(
    useCallback((value: string) => {
      if (claimedRef.current) return
      const code = value.trim()
      const card = loadDeck()[code]
      if (!card) {
        // Not a hard failure: the deck is captured incrementally.
        setMessage(`Card ${shortCode(code)} is not in your deck yet.`)
        return
      }
      const drawn = pickTrack(card.year, usedRef.current)
      if (!drawn) {
        setMessage(`No playable preview for ${card.year}. Add a preview URL to a song in an active playlist.`)
        return
      }
      if (!drawn.track.previewUrl) {
        setMessage('This song has no preview URL. Add one in Playlists before playing.')
        return
      }
      claimedRef.current = true
      stopRef.current?.()
      usedRef.current.add(drawn.track.uri)
      setMessage(null)
      setRound({ code, year: card.year, track: drawn.track, repeat: drawn.repeat })
      setPhase('armed')

      previewUrlRef.current = drawn.track.previewUrl
    }, []),
  )
  stopRef.current = scanner.stop

  const beginRound = useCallback(async () => {
    setMessage(null)
    setRound(null)
    setRevealed(false)
    claimedRef.current = false
    previewUrlRef.current = null
    // Both must happen inside the tap: iOS gates audio playback and the motion
    // sensors on user activation.
    await audio.primeFromGesture()
    if (flip.permission === 'unknown') {
      const ok = await flip.requestPermission()
      if (!ok) setMessage('Motion permission denied — flip detection will not fire.')
    }
    try {
      wakeLockRef.current =
        (await (
          navigator as {
            wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> }
          }
        ).wakeLock?.request('screen')) ?? null
    } catch {
      /* wake lock is a nice-to-have */
    }
    setPhase('scanning')
    await scanner.start()
  }, [audio, flip, scanner])

  const reset = useCallback(async () => {
    scanner.stop()
    audio.stop()
    await wakeLockRef.current?.release().catch(() => undefined)
    wakeLockRef.current = null
    claimedRef.current = false
    previewUrlRef.current = null
    setRound(null)
    setRevealed(false)
    setMessage(null)
    setPhase('idle')
  }, [audio, scanner])

  const stopRoundOnNavigation = useEffectEvent(() => {
    if (phase !== 'idle') void reset()
  })
  useEffect(() => {
    // Browser back/forward can leave the play screen during an active round.
    if (!isPlayScreen) stopRoundOnNavigation()
  }, [isPlayScreen])

  const deckSize = Object.keys(loadDeck()).length
  const activeCount = activeIds().length

  return (
    <div className="app">
      <header>
        <h1>Flitster</h1>
        <button className="ghost" onClick={() => setShowDebug((v) => !v)}>
          {showDebug ? 'hide' : 'debug'}
        </button>
      </header>

      {libraryState === 'loading' && <p role="status" className="hint">Loading the library…</p>}
      {libraryState === 'error' && <div role="alert" className="banner warn">Could not load the database library. Check your connection and try again. <button onClick={loadLibrary}>Retry</button></div>}
      {libraryState === 'ready' && <Outlet />}

      {libraryState === 'ready' && isPlayScreen && (
        <>
          {phase === 'idle' && (
            <div className="stage">
              <div className="row">
                <button className="ghost wide" onClick={() => navigate({ to: '/deck' })}>
                  Deck ({deckSize})
                </button>
                <button className="ghost wide" onClick={() => navigate({ to: '/playlists' })}>
                  Playlists ({activeCount} on)
                </button>
              </div>

              <p className="hint">Scan a card, then turn your phone face-down to hear the track.</p>
              <button className="primary" onClick={beginRound} disabled={deckSize === 0 || activeCount === 0}>
                Scan a card
              </button>
              {deckSize === 0 && <p className="hint">Capture your deck first.</p>}
              {usedRef.current.size > 0 && (
                <button
                  className="ghost"
                  onClick={() => {
                    usedRef.current.clear()
                    setMessage('New game — all tracks available again.')
                  }}
                >
                  New game ({usedRef.current.size} played)
                </button>
              )}
            </div>
          )}

          <div className={`camera ${phase === 'scanning' ? 'live' : ''}`}>
            <video ref={scanner.videoRef} playsInline muted />
            <canvas ref={scanner.canvasRef} hidden />
            {phase === 'scanning' && <div className="reticle" />}
          </div>

          {phase === 'scanning' && <p className="hint">Point at a card…</p>}

          {phase === 'armed' && (
            <div className="stage">
              <p className="big">Turn your phone over</p>
              <p className="hint">Screen down to start the track.</p>
              <button className="ghost" onClick={startPlayback}>
                Play anyway
              </button>
            </div>
          )}

          {phase === 'playing' && round && (
            <div className="stage">
              {revealed ? (
                <>
                  <p className="big">{round.year}</p>
                  <p className="hint">
                    {round.track.artist} — {round.track.title}
                  </p>
                </>
              ) : (
                <>
                  <p className="big">Playing</p>
                  <button className="ghost" onClick={() => setRevealed(true)}>
                    Reveal answer
                  </button>
                </>
              )}
              {round.repeat && <p className="hint warn-text">Repeat — {round.year} is out of fresh tracks.</p>}
            </div>
          )}

          {scanner.error && <p className="banner warn">{scanner.error}</p>}
          {message && <p className="banner">{message}</p>}

          {phase !== 'idle' && (
            <button className="ghost wide" onClick={reset}>
              {phase === 'playing' ? 'Next card' : 'Cancel'}
            </button>
          )}
        </>
      )}

      {showDebug && (
        <section className="debug">
          <h2>Capabilities</h2>
          <ul>
            {capabilities.map((c) => (
              <li key={c.label}>
                <span className={c.ok ? 'ok' : 'no'}>{c.ok ? '✓' : '✗'}</span> {c.label}
                <em>{c.detail}</em>
              </li>
            ))}
          </ul>

          <h2>In-app audio</h2>
          <ul>
            <li>
              gesture unlock
              <em className={audio.unlock === 'unlocked' ? 'ok' : audio.unlock === 'blocked' ? 'no' : ''}>
                {audio.unlock}
              </em>
            </li>
            <li>
              playing<em>{String(audio.playing)}</em>
            </li>
            {audio.error && (
              <li>
                last error<em className="no">{audio.error}</em>
              </li>
            )}
          </ul>

          <h2>Sensors</h2>
          <ul>
            <li>permission<em>{flip.permission}</em></li>
            <li>source<em>{flip.source}</em></li>
            <li>gravity z<em>{flip.z?.toFixed(2) ?? '—'}</em></li>
            <li>beta<em>{flip.beta?.toFixed(1) ?? '—'}</em></li>
            <li>phase<em>{phase}</em></li>
          </ul>

        </section>
      )}
    </div>
  )
}
