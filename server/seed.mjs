import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { db } from './db.mjs'

try {
  const cards = JSON.parse(await readFile(new URL('./data/deck.json', import.meta.url), 'utf8'))
  const lists = JSON.parse(await readFile(new URL('./data/lists.json', import.meta.url), 'utf8'))
  for (const card of cards) {
    if (typeof card.code !== 'string' || !card.code || !Number.isInteger(card.year) ||
      !Number.isFinite(Date.parse(card.addedAt))) throw new Error('Invalid deck card in seed data.')
  }
  for (const list of lists) {
    if (!list.id || !list.name || !Array.isArray(list.songs)) throw new Error('Invalid list in seed data.')
    for (const song of list.songs) {
      if (!song.title || !song.artist || !Number.isInteger(song.year) ||
        !/^[A-Za-z0-9]{22}$/.test(song.spotifyId)) throw new Error('Invalid song in seed data.')
    }
  }
  const ownerId = process.env.SEED_OWNER_ID || 'personal-import'
  const result = await db.$transaction(async tx => {
    // Existing cards must agree; never silently replace captured physical years.
    const existing = await tx.deckCard.findMany({ where: { code: { in: cards.map(c => c.code) } } })
    if (existing.some(c => cards.find(row => row.code === c.code).year !== c.year)) {
      throw new Error('Existing deck years conflict with the supplied import.')
    }
    const deck = await tx.deckCard.createMany({
      data: cards.map(c => ({ ...c, addedAt: new Date(c.addedAt) })), skipDuplicates: true,
    })
    await tx.user.upsert({ where: { id: ownerId }, update: {}, create: { id: ownerId, name: 'Personal library' } })
    let songsAdded = 0
    for (const list of lists) {
      const existingList = await tx.list.findUnique({ where: { id: list.id } })
      if (existingList && existingList.ownerId !== ownerId) throw new Error('List belongs to a different owner.')
      await tx.list.upsert({ where: { id: list.id }, update: {}, create: { id: list.id, name: list.name, ownerId } })
      const added = await tx.song.createMany({
        data: list.songs.map((song, index) => ({
          ...song, listId: list.id,
          // Stable snapshot row IDs make reruns safe without constraining spotifyId.
          id: `import-${createHash('sha256').update(`${list.id}:${index}`).digest('hex')}`,
        })), skipDuplicates: true,
      })
      songsAdded += added.count
      await tx.listActivation.upsert({
        where: { userId_listId: { userId: ownerId, listId: list.id } }, update: {},
        create: { userId: ownerId, listId: list.id },
      })
    }
    return { cardsAdded: deck.count, songsAdded, lists: lists.length, ownerId }
  }, { timeout: 60000 })
  console.log(JSON.stringify(result))
} finally {
  await db.$disconnect()
}
