import { useCallback, useEffect, useRef, useState } from 'react'
import { disconnectSpotify, loginToSpotify, restoreSpotifySession, spotifyAccessToken, spotifyConfigured } from '../lib/spotifyAuth'
import { getSpotifyClip, loadSpotifySdk, startSpotifyClip, type SpotifyPlayer } from '../lib/spotifyPlayback'

type Clip = {
  controller: AbortController
  player: SpotifyPlayer
  timer?: number
  requested: boolean
  request: Promise<void>
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export function useSpotifyPlayback() {
  const [selected, setSelected] = useState<boolean | null>(spotifyConfigured ? null : false)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const playerRef = useRef<SpotifyPlayer | null>(null)
  const clipRef = useRef<Clip | null>(null)

  useEffect(() => {
    if (!spotifyConfigured) return
    let active = true
    void restoreSpotifySession().then(value => { if (active) setSelected(value) })
      .catch(error => {
        if (!active) return
        setSelected(false)
        setError(errorMessage(error))
      })
    return () => { active = false }
  }, [])

  const stop = useCallback(async () => {
    const clip = clipRef.current
    if (!clip) return
    clip.controller.abort()
    window.clearTimeout(clip.timer)
    // Let an in-flight start reach Spotify before pausing the local device.
    await clip.request.catch(() => undefined)
    if (clip.requested) await clip.player.pause().catch(() => undefined)
    if (clipRef.current === clip) clipRef.current = null
  }, [])

  useEffect(() => {
    if (!selected) return
    let active = true
    let player: SpotifyPlayer | undefined
    const fail = (message: string) => { if (active) setError(message) }
    const readyTimeout = window.setTimeout(() => fail('Spotify player did not become ready. Disconnect and connect again.'), 18_000)

    void loadSpotifySdk().then(async sdk => {
      if (!active) return
      player = new sdk.Player({
        name: 'Flitster',
        getOAuthToken: callback => {
          void spotifyAccessToken().then(token => { if (active) callback(token) })
            .catch(error => fail(errorMessage(error)))
        },
      })
      playerRef.current = player
      player.addListener('ready', ({ device_id }) => {
        window.clearTimeout(readyTimeout)
        if (!active) return
        setError(null)
        setDeviceId(device_id)
      })
      player.addListener('not_ready', () => { if (active) setDeviceId(null) })
      for (const event of ['initialization_error', 'authentication_error', 'account_error', 'playback_error'] as const) {
        player.addListener(event, ({ message }) => fail(message))
      }
      player.addListener('autoplay_failed', () => fail('Spotify playback was blocked by the browser. Try scanning again.'))
      if (!await player.connect()) fail('Could not connect the Spotify player.')
    }).catch(error => fail(errorMessage(error)))

    return () => {
      active = false
      window.clearTimeout(readyTimeout)
      playerRef.current = null
      void stop().finally(() => player?.disconnect())
    }
  }, [selected, stop])

  const connect = useCallback(() => {
    setError(null)
    void loginToSpotify().catch(error => setError(errorMessage(error)))
  }, [])

  const disconnect = useCallback(() => {
    disconnectSpotify()
    setDeviceId(null)
    setSelected(false)
    setError(null)
  }, [])

  const activate = useCallback(async () => {
    const player = playerRef.current
    if (!player) throw new Error('Wait for the Spotify player to connect.')
    await player.activateElement()
  }, [])

  const play = useCallback(async (uri: string) => {
    const player = playerRef.current
    if (!deviceId || !player) throw new Error('Spotify player is unavailable. Reconnect Spotify.')
    setError(null)
    const controller = new AbortController()
    const clip: Clip = { player, controller, requested: false, request: Promise.resolve() }
    clipRef.current = clip
    clip.request = (async () => {
      const { startMs, endMs } = await getSpotifyClip(uri, controller.signal)
      controller.signal.throwIfAborted()
      clip.requested = true
      await startSpotifyClip(uri, deviceId, startMs)
      if (controller.signal.aborted) return

      const deadline = Date.now() + 8_000
      let started = false
      const checkPosition = async () => {
        const state = await player.getCurrentState()
        if (controller.signal.aborted) return
        if (state?.track_window.current_track.uri === uri && !state.paused) {
          started = true
          if (state.position >= endMs) {
            await player.pause()
            return
          }
        }
        if (started && state && state.track_window.current_track.uri !== uri) return
        if (!started && Date.now() >= deadline) {
          throw new Error('Spotify did not start the selected track. Try the round again.')
        }
        clip.timer = window.setTimeout(check, 200)
      }
      const check = () => {
        void checkPosition().catch(error => {
          if (controller.signal.aborted) return
          setError(errorMessage(error))
          void stop()
        })
      }
      check()
    })()
    try {
      await clip.request
    } catch (error) {
      if (!controller.signal.aborted) await stop()
      throw error
    }
  }, [deviceId, stop])

  return {
    configured: spotifyConfigured,
    selected: selected === true,
    restoring: selected === null,
    ready: Boolean(deviceId),
    error, connect, disconnect, activate, play, stop,
  }
}
