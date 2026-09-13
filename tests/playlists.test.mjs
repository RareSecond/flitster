import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { stripTypeScriptTypes } from 'node:module'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateLibrary } from '../server/library.mjs'

const folder = await mkdtemp(join(tmpdir(), 'flitster-library-test-'))
after(() => rm(folder, { recursive: true, force: true }))
for (const name of ['library', 'deck', 'playlists']) {
  const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8')
  const js = stripTypeScriptTypes(source).replace(/from '(\.\/\w+)'/g, "from '$1.mjs'")
    .replace("import('./library.functions')", "import('./library.functions.mjs')")
  await writeFile(join(folder, `${name}.mjs`), js)
}
await writeFile(join(folder, 'library.functions.mjs'), 'export const saveLibrary = async ({ data }) => structuredClone(data.after)')
const { setDatabaseLibrary, databaseLibrary } = await import(pathToFileURL(join(folder, 'library.mjs')))
const { createPlaylist, addTracks, setActiveIds, pickTrack, setTrackPreview } = await import(pathToFileURL(join(folder, 'playlists.mjs')))
const track = { uri: 'spotify:track:4PTG3Z6ehGkBFwjybzWkR8', title: 'Test', artist: 'Artist', year: 1985, spotifyYear: 1985, albumName: '' }

test('supplied IDs persist without lookups; only saved previews are playable', async () => {
  setDatabaseLibrary({ deck: {}, playlists: {}, activeIds: [] })
  const lists = await createPlaylist('Test')
  const id = Object.keys(lists)[0]
  await addTracks(id, [track])
  await setActiveIds([id])
  assert.equal(pickTrack(1985, new Set()), null)
  await setTrackPreview(id, track.uri, 'https://example.com/preview.mp3')
  assert.equal(pickTrack(1985, new Set()).track.previewUrl, 'https://example.com/preview.mp3')
  assert.equal(pickTrack(1985, new Set([track.uri])).repeat, true)
  validateLibrary(databaseLibrary())
})

test('database rejects invalid IDs and unsafe preview URLs', () => {
  for (const previewUrl of ['javascript:alert(1)', 'http://example.com/a.mp3', 'https://user:password@example.com/a.mp3', 'invalid']) {
    const value = structuredClone(databaseLibrary())
    Object.values(value.playlists)[0].tracks[0].previewUrl = previewUrl
    assert.throws(() => validateLibrary(value), /preview URL/i)
  }
  const value = structuredClone(databaseLibrary())
  Object.values(value.playlists)[0].tracks[0].uri = 'invalid'
  assert.throws(() => validateLibrary(value), /Invalid track/)
})
