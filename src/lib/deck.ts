import { databaseLibrary, persistLibrary } from './library'
/**
 * The deck is the physical truth: every card carries a QR code and a printed
 * year, and nothing else. You capture it once, and it never changes. Which song
 * belongs on a card is a *playlist* concern -- see `playlists.ts`.
 */
export type DeckCard = {
  /** Raw QR payload, verbatim. The stable identity of a physical card. */
  code: string
  year: number
  addedAt: string
}

export type Deck = Record<string, DeckCard>

export const loadDeck = (): Deck => structuredClone(databaseLibrary().deck)

const persist = async (deck: Deck): Promise<Deck> =>
  (await persistLibrary({ ...databaseLibrary(), deck })).deck

export const addCard = (code: string, year: number): Promise<Deck> =>
  persist({ ...loadDeck(), [code]: { code, year, addedAt: new Date().toISOString() } })

export const removeCard = (code: string): Promise<Deck> => {
  const deck = loadDeck()
  delete deck[code]
  return persist(deck)
}

export const exportDeck = () => JSON.stringify(Object.values(loadDeck()), null, 2)

export async function importDeck(text: string): Promise<number> {
  const rows = JSON.parse(text) as DeckCard[]
  if (!Array.isArray(rows)) throw new Error('Expected a JSON array of cards')
  const deck = loadDeck()
  for (const c of rows) {
    if (!c?.code || !c?.year) throw new Error('Invalid deck card')
    deck[c.code] = c
  }
  await persist(deck)
  return rows.length
}

/**
 * Years repeat: a deck can hold several cards for 1985, and each one needs its
 * own song. Grouping by year is therefore the natural unit of work everywhere.
 */
export function byYear(deck: Deck): Array<{ year: number; cards: DeckCard[] }> {
  const groups = new Map<number, DeckCard[]>()
  for (const card of Object.values(deck)) {
    const list = groups.get(card.year) ?? []
    list.push(card)
    groups.set(card.year, list)
  }
  return [...groups.entries()]
    .map(([year, cards]) => ({ year, cards: cards.sort((a, b) => a.code.localeCompare(b.code)) }))
    .sort((a, b) => a.year - b.year)
}

/** A short, readable handle for a QR payload that is usually a long URL. */
export const shortCode = (code: string) => {
  const tail = code.split(/[/?#]/).filter(Boolean).pop() ?? code
  return tail.length > 16 ? `${tail.slice(0, 16)}…` : tail
}
