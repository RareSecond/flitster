import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { useQrScanner } from './hooks/useQrScanner'
import { useFlipDetector } from './hooks/useFlipDetector'
import { useAudioPreview } from './hooks/useAudioPreview'
import { probeCapabilities } from './lib/capabilities'
import { CLIENT_ID, handleRedirect, isLoggedIn, login, logout } from './lib/spotifyAuth'
import {
  NoActiveDeviceError,
  getTrack,
  openInSpotifyApp,
  pausePlayback,
  playTrack,
} from './lib/spotifyApi'
import { PROBE_TRACK_URI } from './lib/tracks'
import { loadDeck, shortCode } from './lib/deck'
import { activeIds, pickTrack, type PlaylistTrack } from './lib/playlists'

type Phase = 'idle' | 'scanning' | 'armed' | 'playing' | 'error'

/** 'preview' plays a 30s clip in-app; 'connect' remote-controls the Spotify app. */
type Mode = 'preview' | 'connect'

type PreviewProbe =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'done'; url: string | null }
  | { state: 'failed'; error: string }

/** One scanned card: the year comes from the deck, the track from the pools. */
type Round = { code: string; year: number; track: PlaylistTrack; repeat: boolean }

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle')
  const pathname = useLocation({ select: (location) => location.pathname })
  const navigate = useNavigate()
  const isPlayScreen = pathname === '/'
  const [round, setRound] = useState<Round | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [loggedIn, setLoggedIn] = useState(isLoggedIn)
  const [showDebug, setShowDebug] = useState(false)
  const [previewProbe, setPreviewProbe] = useState<PreviewProbe>({ state: 'idle' })
  const [mode, setMode] = useState<Mode>(
    () => (localStorage.getItem('flitster.mode') as Mode | null) ?? 'preview',
  )
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
  const modeRef = useRef<Mode>(mode)
  modeRef.current = mode

  useEffect(() => {
    localStorage.setItem('flitster.mode', mode)
  }, [mode])

  useEffect(() => {
    handleRedirect()
      .then((did) => did && setLoggedIn(true))
      .catch((e) => setMessage(String(e)))
  }, [])

  // Settles "can this client id still get 30s previews?" empirically, rather
  // than us guessing from Spotify's deprecation notes.
  useEffect(() => {
    if (!loggedIn) return
    let cancelled = false
    setPreviewProbe({ state: 'checking' })
    getTrack(PROBE_TRACK_URI)
      .then((t) => !cancelled && setPreviewProbe({ state: 'done', url: t.preview_url }))
      .catch((e) => !cancelled && setPreviewProbe({ state: 'failed', error: String(e) }))
    return () => {
      cancelled = true
    }
  }, [loggedIn])

  const startPlayback = useCallback(async () => {
    const current = roundRef.current
    if (!current) return
    setPhase('playing')

    if (modeRef.current === 'preview') {
      const url = previewUrlRef.current
      if (!url) {
        setPhase('error')
        setMessage('No preview available for this track — switch to Full track mode.')
        return
      }
      const ok = await audio.play(url, { title: current.track.title, artist: current.track.artist })
      if (!ok) {
        setPhase('error')
        setMessage('Preview blocked — the audio unlock did not survive to the flip.')
      }
      return
    }

    try {
      await playTrack(current.track.uri)
      setMessage(null)
    } catch (e) {
      if (e instanceof NoActiveDeviceError) {
        setMessage('No active Spotify device — handing off to the Spotify app.')
        openInSpotifyApp(current.track.uri)
      } else {
        setPhase('error')
        setMessage(String(e))
      }
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
        setMessage(`No track for ${card.year} in the active playlists.`)
        return
      }
      claimedRef.current = true
      stopRef.current?.()
      usedRef.current.add(drawn.track.uri)
      setMessage(null)
      setRound({ code, year: card.year, track: drawn.track, repeat: drawn.repeat })
      setPhase('armed')

      previewUrlRef.current = null
      if (modeRef.current === 'preview') {
        getTrack(drawn.track.uri)
          .then((t) => {
            previewUrlRef.current = t.preview_url
          })
          .catch(() => undefined)
      }
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
    if (mode === 'preview') await audio.primeFromGesture()
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
  }, [audio, flip, mode, scanner])

  const reset = useCallback(async () => {
    scanner.stop()
    audio.stop()
    if (mode === 'connect') await pausePlayback()
    await wakeLockRef.current?.release().catch(() => undefined)
    wakeLockRef.current = null
    claimedRef.current = false
    previewUrlRef.current = null
    setRound(null)
    setRevealed(false)
    setMessage(null)
    setPhase('idle')
  }, [audio, mode, scanner])

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

      {!CLIENT_ID && (
        <p className="banner warn">
          Set <code>VITE_SPOTIFY_CLIENT_ID</code> in <code>.env.local</code> to enable playback.
        </p>
      )}

      {CLIENT_ID && !loggedIn && (
        <button className="primary" onClick={() => login().catch((e) => setMessage(String(e)))}>
          Connect Spotify
        </button>
      )}

      {loggedIn && <Outlet />}

      {loggedIn && isPlayScreen && (
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

              <div className="modes">
                <button
                  className={mode === 'preview' ? 'seg on' : 'seg'}
                  onClick={() => setMode('preview')}
                >
                  30s preview
                </button>
                <button
                  className={mode === 'connect' ? 'seg on' : 'seg'}
                  onClick={() => setMode('connect')}
                >
                  Full track
                </button>
              </div>

              <p className="hint">Scan a card, then turn your phone face-down to hear the track.</p>
              <button className="primary" onClick={beginRound} disabled={deckSize === 0}>
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

          <h2>Spotify 30s preview</h2>
          <ul>
            <li>
              preview_url
              <em>
                {previewProbe.state === 'idle' && 'not logged in'}
                {previewProbe.state === 'checking' && 'checking…'}
                {previewProbe.state === 'failed' && previewProbe.error}
                {previewProbe.state === 'done' &&
                  (previewProbe.url ? 'available' : 'null — deprecated for this app')}
              </em>
            </li>
            {previewProbe.state === 'done' && (
              <li>
                verdict
                <em className={previewProbe.url ? 'ok' : 'no'}>
                  {previewProbe.url ? 'in-app <audio> works' : 'Connect remote-control only'}
                </em>
              </li>
            )}
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

          {loggedIn && (
            <button
              className="ghost wide"
              onClick={() => {
                logout()
                setLoggedIn(false)
              }}
            >
              Disconnect Spotify
            </button>
          )}
        </section>
      )}
    </div>
  )
}
