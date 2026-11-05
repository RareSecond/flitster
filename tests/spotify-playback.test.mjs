import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'

const source = await readFile(new URL('../src/lib/spotifyPlayback.ts', import.meta.url), 'utf8')
const js = stripTypeScriptTypes(source).replace(
  "import { spotifyAccessToken } from './spotifyAuth'",
  "const spotifyAccessToken = async () => 'test-token'",
)
const { getSpotifyClip, randomSpotifyClip, startSpotifyClip } = await import(`data:text/javascript,${encodeURIComponent(js)}`)

test('Spotify plays the selected track and random offset on the web player', async t => {
  const calls = []
  t.mock.method(Math, 'random', () => 0.5)
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    return options.method === 'PUT'
      ? new Response(null, { status: 204 })
      : Response.json({ duration_ms: 180_250 })
  })
  const uri = 'spotify:track:4PTG3Z6ehGkBFwjybzWkR8'
  const { startMs, endMs } = await getSpotifyClip(uri, new AbortController().signal)
  await startSpotifyClip(uri, 'web-player', startMs)

  assert.equal(calls[0].url, 'https://api.spotify.com/v1/tracks/4PTG3Z6ehGkBFwjybzWkR8')
  assert.equal(startMs, 80_001)
  assert.equal(endMs - startMs, 20_000)
  assert.equal(calls[1].url, 'https://api.spotify.com/v1/me/player/play?device_id=web-player')
  assert.equal(calls[1].options.method, 'PUT')
  assert.deepEqual(JSON.parse(calls[1].options.body), { uris: [uri], position_ms: startMs })
})

test('random windows stay clear of the track end and handle short tracks', t => {
  t.mock.method(Math, 'random', () => 0.99999)
  assert.deepEqual(randomSpotifyClip(180_250), { startMs: 159_999, endMs: 179_999 })
  assert.deepEqual(randomSpotifyClip(10_000), { startMs: 0, endMs: 9_750 })
  assert.throws(() => randomSpotifyClip(undefined), /invalid track duration/)
})
