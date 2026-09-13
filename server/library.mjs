// This deployment is a shared personal library, not a multi-user login system.
// The shared library owner is configured only on the server.
export const ownerId = () => process.env.LIBRARY_OWNER_ID || process.env.SEED_OWNER_ID || 'personal-import'

export async function readLibrary(tx) {
  const [cards, lists, active] = await Promise.all([
    tx.deckCard.findMany({ orderBy: { year: 'asc' } }),
    tx.list.findMany({ include: { songs: { orderBy: [{ year: 'asc' }, { id: 'asc' }] } }, orderBy: { name: 'asc' } }),
    tx.listActivation.findMany({ where: { userId: ownerId() } }),
  ])
  return {
    deck: Object.fromEntries(cards.map(card => [card.code, { ...card, addedAt: card.addedAt.toISOString() }])),
    playlists: Object.fromEntries(lists.map(list => [list.id, {
      id: list.id, name: list.name, createdAt: list.createdAt.toISOString(), readOnly: list.ownerId !== ownerId(),
      ...(list.importSongs ? { importSongs: list.importSongs } : {}),
      tracks: list.songs.map(song => ({ id: song.id,
        previewUrl: song.previewUrl, uri: `spotify:track:${song.spotifyId}`, title: song.title, artist: song.artist,
        year: song.year, spotifyYear: song.spotifyYear ?? song.year, albumName: song.albumName,
      })),
    }])),
    activeIds: active.map(row => row.listId).sort(),
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const string = value => typeof value === 'string' && value.length > 0 && value.length <= 10000
const year = value => Number.isInteger(value) && value >= 1000 && value <= 9999
export function validateLibrary(value) {
  if (!record(value) || !record(value.deck) || !record(value.playlists) || !Array.isArray(value.activeIds)) throw new Error('Invalid library.')
  for (const [code, card] of Object.entries(value.deck)) {
    if (!record(card) || !string(code) || card.code !== code || !year(card.year) || !Number.isFinite(Date.parse(card.addedAt))) throw new Error('Invalid deck card.')
  }
  for (const [id, list] of Object.entries(value.playlists)) {
    if (!record(list) || !string(id) || list.id !== id || !string(list.name) || !Number.isFinite(Date.parse(list.createdAt)) || !Array.isArray(list.tracks)) throw new Error('Invalid playlist.')
    const ids = new Set()
    for (const track of list.tracks) {
      if (!record(track) || !string(track.title) || !string(track.artist) || !year(track.year) || !/^spotify:track:[A-Za-z0-9]{22}$/.test(track.uri) || (track.id && (!string(track.id) || ids.has(track.id)))) throw new Error('Invalid track.')
      if (track.previewUrl != null) {
        let url
        try { url = new URL(track.previewUrl) } catch { throw new Error('Invalid preview URL.') }
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Preview URL must use HTTPS without credentials.')
      }
      if (track.id) ids.add(track.id)
      if (typeof track.albumName !== 'string' || !Number.isInteger(track.spotifyYear)) throw new Error('Invalid Spotify metadata.')
    }
    if (list.importSongs !== undefined && (!Array.isArray(list.importSongs) || list.importSongs.some(song => !record(song) || !string(song.artist) || !string(song.title) || !year(song.year) || !['pending', 'review', 'added', 'skipped'].includes(song.status)))) throw new Error('Invalid import progress.')
  }
  if (value.activeIds.some(id => !string(id) || !Object.hasOwn(value.playlists, id)) || new Set(value.activeIds).size !== value.activeIds.length) throw new Error('Invalid active playlists.')
  return value
}

export async function writeLibrary(tx, before, after) {
  validateLibrary(before)
  validateLibrary(after)
  const current = await readLibrary(tx)
  const changed = key => [...new Set([...Object.keys(before[key]), ...Object.keys(after[key])])].filter(id => !same(before[key][id], after[key][id]))
  const deckIds = changed('deck')
  const listIds = changed('playlists')
  for (const [key, ids] of [['deck', deckIds], ['playlists', listIds]]) {
    for (const id of ids) {
      if (!same(before[key][id], current[key][id])) throw new Error('The library changed on another device. Reload before editing again.')
      if (key === 'playlists' && current.playlists[id]?.readOnly) throw new Error('This playlist belongs to another owner.')
    }
  }
  if (!same(before.activeIds, after.activeIds) && !same(before.activeIds, current.activeIds)) throw new Error('Active playlists changed on another device. Reload before editing again.')
  for (const code of deckIds) {
    const card = after.deck[code]
    if (!card) await tx.deckCard.delete({ where: { code } })
    else await tx.deckCard.upsert({ where: { code }, create: { code, year: card.year, addedAt: new Date(card.addedAt) }, update: { year: card.year } })
  }
  for (const id of listIds) {
    const list = after.playlists[id]
    if (!list) { await tx.list.delete({ where: { id } }); continue }
    const data = { name: list.name, ...(list.importSongs !== undefined ? { importSongs: list.importSongs } : before.playlists[id]?.importSongs ? { importSongs: [] } : {}) }
    await tx.list.upsert({ where: { id }, create: { id, ownerId: ownerId(), createdAt: new Date(list.createdAt), ...data }, update: data })
    await tx.song.deleteMany({ where: { listId: id } })
    if (list.tracks.length) await tx.song.createMany({ data: list.tracks.map(track => ({
      ...(track.id ? { id: track.id } : {}), listId: id, year: track.year, title: track.title,
      artist: track.artist, spotifyId: track.uri.slice('spotify:track:'.length),
      spotifyYear: track.spotifyYear, albumName: track.albumName, previewUrl: track.previewUrl ?? null,
    })) })
  }
  if (!same(before.activeIds, after.activeIds)) {
    await tx.listActivation.deleteMany({ where: { userId: ownerId() } })
    if (after.activeIds.length) await tx.listActivation.createMany({ data: after.activeIds.map(listId => ({ userId: ownerId(), listId })) })
  }
  return readLibrary(tx)
}
