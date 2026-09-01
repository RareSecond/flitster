import { useCallback, useRef, useState } from 'react'

/** 50ms of 8-bit silence. Played inside a tap to satisfy iOS' activation rule. */
const SILENCE = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA'

export type UnlockState = 'untried' | 'unlocked' | 'blocked'

/**
 * In-app 30s preview playback.
 *
 * iOS only lets an <audio> element start from a real user gesture, and our
 * playback trigger is a devicemotion event, which is not one. The escape hatch
 * is that the restriction is per-element and sticky: play a silent clip on the
 * scan tap, and the same element can then be given a new src and played
 * programmatically later in the round.
 */
export function useAudioPreview() {
  const elRef = useRef<HTMLAudioElement | null>(null)
  const [unlock, setUnlock] = useState<UnlockState>('untried')
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const element = () => {
    if (!elRef.current) {
      const el = new Audio()
      el.preload = 'auto'
      el.addEventListener('ended', () => setPlaying(false))
      elRef.current = el
    }
    return elRef.current
  }

  /** Call this synchronously from a tap handler. */
  const primeFromGesture = useCallback(async () => {
    const el = element()
    try {
      el.src = SILENCE
      await el.play()
      el.pause()
      el.currentTime = 0
      setUnlock('unlocked')
      return true
    } catch {
      setUnlock('blocked')
      return false
    }
  }, [])

  const play = useCallback(async (url: string, meta?: { title: string; artist: string }) => {
    const el = element()
    setError(null)
    try {
      el.src = url
      el.currentTime = 0
      await el.play()
      setPlaying(true)
      if ('mediaSession' in navigator && meta) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: meta.title,
          artist: meta.artist,
          album: 'Flitster',
        })
      }
      return true
    } catch (e) {
      // NotAllowedError here is the interesting failure: it means the unlock
      // did not survive from the tap to the flip.
      setError(`${(e as DOMException).name}: ${(e as DOMException).message}`)
      setPlaying(false)
      return false
    }
  }, [])

  const stop = useCallback(() => {
    elRef.current?.pause()
    setPlaying(false)
  }, [])

  return { primeFromGesture, play, stop, unlock, playing, error }
}
