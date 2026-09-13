import type { Deck } from './deck'
import type { Playlists } from './playlists'

export type Library = { deck: Deck; playlists: Playlists; activeIds: string[] }
let library: Library = { deck: {}, playlists: {}, activeIds: [] }
export const databaseLibrary = () => library
const listeners = new Set<() => void>()
export function subscribeLibrary(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function setDatabaseLibrary(value: Library) {
  library = value
  for (const listener of listeners) listener()
}
let saving = false

export async function persistLibrary(after: Library): Promise<Library> {
  if (saving) throw new Error('A change is still being saved. Please try again in a moment.')
  saving = true
  try {
    const before = library
    const { saveLibrary } = await import('./library.functions')
    const saved = await saveLibrary({ data: { before, after } })
    setDatabaseLibrary(saved)
    return saved
  } finally {
    saving = false
  }
}
