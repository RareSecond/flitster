import { spotifyAccessToken } from './spotifyAuth'

const API = 'https://api.spotify.com/v1'
export const SPOTIFY_CLIP_MS = 20_000

export function randomSpotifyClip(durationMs: number) {
  if (!Number.isInteger(durationMs) || durationMs < 1) throw new Error('Spotify returned an invalid track duration.')
  // Leave time to pause before Spotify advances to another song.
  const endLimit = Math.max(1, durationMs - 250)
  const lastStart = Math.max(0, endLimit - SPOTIFY_CLIP_MS)
  const startMs = lastStart > 0 ? 1 + Math.floor(Math.random() * lastStart) : 0
  return { startMs, endMs: Math.min(startMs + SPOTIFY_CLIP_MS, endLimit) }
}

async function spotifyRequest(path: string, init: RequestInit = {}) {
  const accessToken = await spotifyAccessToken()
  const timeout = AbortSignal.timeout(12_000)
  const response = await fetch(`${API}${path}`, {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    headers: { Authorization: `Bearer ${accessToken}`, ...init.headers },
  })
  if (response.status === 401) throw new Error('Spotify authorization expired. Disconnect and connect again.')
  if (response.status === 403) throw new Error('Spotify denied access. Check your Premium account and app access.')
  if (response.status === 429) throw new Error('Spotify is rate limiting requests. Try again in a moment.')
  if (!response.ok) throw new Error(`Spotify request failed (${response.status}).`)
  return response
}

export async function getSpotifyClip(uri: string, signal: AbortSignal) {
  const id = uri.slice('spotify:track:'.length)
  const response = await spotifyRequest(`/tracks/${encodeURIComponent(id)}`, { signal })
  const track: { duration_ms: number } = await response.json()
  return randomSpotifyClip(track.duration_ms)
}

export async function startSpotifyClip(uri: string, deviceId: string, startMs: number) {
  await spotifyRequest(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [uri], position_ms: startMs }),
  })
}

type PlayerState = {
  paused: boolean
  position: number
  track_window: { current_track: { uri: string } }
}
type PlayerEvents = {
  ready: { device_id: string }
  not_ready: { device_id: string }
  initialization_error: { message: string }
  authentication_error: { message: string }
  account_error: { message: string }
  playback_error: { message: string }
  autoplay_failed: undefined
}
export type SpotifyPlayer = {
  addListener<K extends keyof PlayerEvents>(event: K, listener: (data: PlayerEvents[K]) => void): boolean
  connect(): Promise<boolean>
  disconnect(): void
  activateElement(): Promise<void>
  getCurrentState(): Promise<PlayerState | null>
  pause(): Promise<void>
}
type SpotifySdk = {
  Player: new (options: { name: string; getOAuthToken: (callback: (token: string) => void) => void }) => SpotifyPlayer
}

let sdk: Promise<SpotifySdk> | undefined
export function loadSpotifySdk() {
  const browser = window as Window & {
    Spotify?: SpotifySdk
    onSpotifyWebPlaybackSDKReady?: () => void
  }
  if (browser.Spotify) return Promise.resolve(browser.Spotify)
  sdk ??= new Promise<SpotifySdk>((resolve, reject) => {
    const script = document.createElement('script')
    const fail = () => {
      clearTimeout(timeout)
      delete browser.onSpotifyWebPlaybackSDKReady
      script.remove()
      sdk = undefined
      reject(new Error('Could not load the Spotify Web Playback SDK.'))
    }
    const timeout = window.setTimeout(fail, 12_000)
    browser.onSpotifyWebPlaybackSDKReady = () => {
      if (!browser.Spotify) return fail()
      clearTimeout(timeout)
      delete browser.onSpotifyWebPlaybackSDKReady
      resolve(browser.Spotify)
    }
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.onerror = fail
    document.head.append(script)
  })
  return sdk
}
