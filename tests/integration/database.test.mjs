import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readLibrary, writeLibrary, validateLibrary } from '../../server/library.mjs'

// Opt in explicitly: all mutations stay inside a transaction that is rolled back.
test('database library round-trips cards, songs, activation, progress and conflicts', { skip: !process.env.TEST_DATABASE }, async () => {
  const { db } = await import('../../server/db.mjs')
  const rollback = new Error('Intentional test rollback')
  try {
    await assert.rejects(db.$transaction(async tx => {
      const before = await readLibrary(tx)
      assert.ok(Object.keys(before.deck).length > 0)
      assert.ok(Object.values(before.playlists).some(list => list.tracks.length > 0))
      validateLibrary(before)
      const id = `test-${crypto.randomUUID()}`
      const after = structuredClone(before)
      const sample = Object.values(before.playlists).flatMap(list => list.tracks)[0]
      after.deck[id] = { code: id, year: 1985, addedAt: new Date().toISOString() }
      after.playlists[id] = { id, name: 'Temporary verification', createdAt: new Date().toISOString(),
        tracks: [{ ...sample, id: undefined, year: 1985, spotifyYear: 2000, albumName: 'Test reissue', previewUrl: 'https://example.com/test-preview.mp3' }],
        importSongs: [{ title: sample.title, artist: sample.artist, year: 1985, status: 'added' }],
      }
      after.activeIds.push(id)
      const saved = await writeLibrary(tx, before, after)
      assert.equal(saved.deck[id].year, 1985)
      assert.ok(saved.playlists[id].tracks[0].id)
      assert.equal(saved.playlists[id].tracks[0].previewUrl, 'https://example.com/test-preview.mp3')
      assert.equal(saved.playlists[id].tracks[0].spotifyYear, 2000)
      assert.equal(saved.playlists[id].importSongs[0].status, 'added')
      assert.ok(saved.activeIds.includes(id))
      const edited = structuredClone(saved)
      edited.playlists[id].tracks[0].year = 1986
      const updated = await writeLibrary(tx, saved, edited)
      assert.equal(updated.playlists[id].tracks[0].year, 1986)
      assert.equal(updated.playlists[id].tracks[0].id, saved.playlists[id].tracks[0].id)
      await assert.rejects(writeLibrary(tx, saved, edited), /another device/)
      const removed = structuredClone(updated)
      delete removed.deck[id]
      delete removed.playlists[id]
      removed.activeIds = removed.activeIds.filter(value => value !== id)
      const final = await writeLibrary(tx, updated, removed)
      assert.deepEqual(final, before)
      throw rollback
    }, { timeout: 60000, isolationLevel: 'Serializable' }), error => error === rollback)
  } finally { await db.$disconnect() }
})
