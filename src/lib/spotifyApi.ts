import { getAccessToken } from './spotifyAuth'

const API = 'https://api.spotify.com/v1'

export class NoActiveDeviceError extends Error {
  constructor() {
    super('No active Spotify device. Open the Spotify app and start any track once.')
  }
}

async function call(path: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  if (!token) throw new Error('Not logged in to Spotify')
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 204) return null
  // On the player endpoints a 404 means "nothing is playing anywhere", not
  // "missing resource" -- everywhere else it really is a missing resource.
  if (res.status === 404 && path.startsWith('/me/player')) throw new NoActiveDeviceError()
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${await res.text()}`)
  return res.headers.get('content-type')?.includes('json') ? res.json() : null
}

export type Device = { id: string; name: string; type: string; is_active: boolean }

export const getDevices = async (): Promise<Device[]> =>
  ((await call('/me/player/devices')) as { devices: Device[] } | null)?.devices ?? []

export async function playTrack(trackUri: string, opts: { deviceId?: string; positionMs?: number } = {}) {
  let deviceId = opts.deviceId
  if (!deviceId) {
    const devices = await getDevices()
    // Prefer whatever Spotify already considers active, else the first device.
    deviceId = (devices.find((d) => d.is_active) ?? devices[0])?.id
  }
  if (!deviceId) throw new NoActiveDeviceError()

  await call(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [trackUri], position_ms: opts.positionMs ?? 0 }),
  })
  return deviceId
}

export const pausePlayback = () => call('/me/player/pause', { method: 'PUT' }).catch(() => null)

/** Last resort when Connect has nothing to talk to: hand off to the native app. */
export const openInSpotifyApp = (trackUri: string) => {
  window.location.href = trackUri
}

export type TrackInfo = { id: string; name: string; artist: string; preview_url: string | null }

export const trackIdFromUri = (uri: string) =>
  uri.match(/(?:spotify:track:|track\/)([A-Za-z0-9]{22})/)?.[1] ?? uri

/**
 * Spotify removed `preview_url` on 2024-11-27 for apps without extended quota
 * mode. This asks the API directly rather than trusting the changelog: a null
 * here means the in-app <audio> route is closed for this client id.
 */
export async function getTrack(uriOrId: string): Promise<TrackInfo> {
  const id = trackIdFromUri(uriOrId)
  const t = (await call(`/tracks/${id}`)) as {
    id: string
    name: string
    artists: Array<{ name: string }>
    preview_url: string | null
  }
  return {
    id: t.id,
    name: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    preview_url: t.preview_url,
  }
}

export type TrackMatch = {
  uri: string
  title: string
  artist: string
  albumName: string
  albumType: string
  releaseDate: string
  year: number
}

type RawTrack = {
  uri: string
  name: string
  artists: Array<{ name: string }>
  album: { name: string; album_type: string; release_date: string }
}

const toMatch = (t: RawTrack): TrackMatch => ({
  uri: t.uri,
  title: t.name,
  artist: t.artists.map((a) => a.name).join(', '),
  albumName: t.album.name,
  albumType: t.album.album_type,
  releaseDate: t.album.release_date,
  // release_date is '1985', '1985-06' or '1985-06-25'.
  year: Number(t.album.release_date.slice(0, 4)) || 0,
})

export async function searchTracks(query: string, limit = 8): Promise<TrackMatch[]> {
  if (!query.trim()) return []
  const res = (await call(
    `/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`,
  )) as { tracks: { items: RawTrack[] } } | null
  return (res?.tracks.items ?? []).map(toMatch)
}

/** Lets you build the library by playing a song and scanning the card for it. */
export async function getCurrentlyPlaying(): Promise<TrackMatch | null> {
  const res = (await call('/me/player/currently-playing')) as { item: RawTrack | null } | null
  return res?.item ? toMatch(res.item) : null
}

export const playlistIdFromUrl = (input: string) =>
  input.match(/(?:spotify:playlist:|playlist\/)([A-Za-z0-9]{22})/)?.[1] ?? input.trim()

/**
 * Bulk-fills a pool from an existing Spotify playlist. Paged, because the API
 * caps each page at 100 and real playlists are longer than that.
 */
export async function getPlaylistTracks(input: string, max = 500): Promise<TrackMatch[]> {
  const id = playlistIdFromUrl(input)
  const out: TrackMatch[] = []
  let offset = 0
  while (out.length < max) {
    const page = (await call(
      `/playlists/${id}/tracks?limit=100&offset=${offset}&fields=items(track(uri,name,artists(name),album(name,album_type,release_date))),next`,
    )) as { items: Array<{ track: RawTrack | null }>; next: string | null } | null
    if (!page) break
    for (const item of page.items) if (item.track?.uri) out.push(toMatch(item.track))
    if (!page.next) break
    offset += 100
  }
  return out
}
