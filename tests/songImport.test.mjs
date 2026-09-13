import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { stripTypeScriptTypes } from 'node:module'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const folder = await mkdtemp(join(tmpdir(), 'flitster-import-test-'))
after(() => rm(folder, { recursive: true, force: true }))
for (const name of ['songImport', 'deck', 'playlists']) {
  const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8')
  const js = stripTypeScriptTypes(source).replace(/from '(\.\/\w+)'/g, "from '$1.mjs'")
  await writeFile(join(folder, `${name}.mjs`), js)
}
const { parseSongs, exactMatch, importedTrack } = await import(pathToFileURL(join(folder, 'songImport.mjs')))
const { acceptImportMatches, createSongPlaylist, loadPlaylists, resolveImportSong } = await import(pathToFileURL(join(folder, 'playlists.mjs')))
const source = JSON.parse(await readFile(new URL('../src/lib/belgianSongs.json', import.meta.url), 'utf8'))
const song = { artist: 'Rocco Granata', title: 'Marina', year: 1960 }
const match = { artist: song.artist, title: song.title, year: 2015, uri: 'spotify:track:example', albumName: 'Collection' }

test('validates the supplied 194 songs and rejects malformed imports', () => {
  assert.equal(parseSongs(source).length, 194)
  for (const value of [null, [], [{}], [{ ...song, year: '1960' }], [{ ...song, title: ' ' }]]) {
    assert.throws(() => parseSongs(value))
  }
})

test('chooses first exact match regardless of year; variants and wrong artists need review', () => {
  assert.equal(exactMatch(song, [match]), match)
  assert.equal(exactMatch(song, [{ ...match, title: 'Marina - Live' }]), undefined)
  assert.equal(exactMatch(song, [{ ...match, artist: 'Cover band' }]), undefined)
  assert.equal(exactMatch(song, [match, { ...match, uri: 'other' }]), match)
  assert.equal(importedTrack(song, match).year, 1960)
  assert.equal(importedTrack(song, match).spotifyYear, 2015)
})

test('persists progress, resumes without duplication, and protects year conflicts', () => {
  const storage = new Map()
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  const id = createSongPlaylist('Test', parseSongs([song, { ...song, year: 1961 }]), 'test')
  resolveImportSong(id, 0, 'added', undefined, match)
  createSongPlaylist('Test', parseSongs([song]), 'test')
  assert.equal(loadPlaylists()[id].importSongs.length, 2)
  assert.equal(loadPlaylists()[id].importSongs[0].status, 'added')
  resolveImportSong(id, 0, 'added', undefined, match)
  assert.equal(loadPlaylists()[id].tracks.length, 1)
  assert.throws(() => resolveImportSong(id, 1, 'added', undefined, match), /another year/)
  assert.equal(loadPlaylists()[id].importSongs[1].status, 'pending')
  resolveImportSong(id, 1, 'review', [match])
  assert.equal(loadPlaylists()[id].importSongs[1].candidates.length, 1)
  resolveImportSong(id, 1, 'skipped')
  assert.equal(loadPlaylists()[id].importSongs[1].status, 'skipped')
})

test('bulk acceptance preserves supplied years, unresolved songs, and existing tracks', () => {
  const storage = new Map()
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  const id = createSongPlaylist('Bulk', parseSongs([song, { ...song, year: 1961 }, { ...song, title: 'Unknown' }]))
  resolveImportSong(id, 0, 'review', [match, { ...match, uri: 'other' }])
  resolveImportSong(id, 1, 'review', [match])
  resolveImportSong(id, 2, 'review', [match])
  const result = acceptImportMatches(id)
  assert.equal(result.accepted, 1)
  assert.equal(result.remaining, 2)
  assert.equal(result.playlists[id].tracks[0].year, 1960)
  assert.equal(result.playlists[id].tracks[0].spotifyYear, 2015)
  assert.equal(acceptImportMatches(id).accepted, 0)
  assert.equal(loadPlaylists()[id].tracks.length, 1)
})
