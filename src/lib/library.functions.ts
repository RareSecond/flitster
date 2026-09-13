import { createServerFn } from '@tanstack/react-start'
import type { Library } from './library'

export const getLibrary = createServerFn({ method: 'GET' }).handler(async (): Promise<Library> => {
  const { db } = await import('../../server/db.mjs')
  const { readLibrary } = await import('../../server/library.mjs')
  return db.$transaction(tx => readLibrary(tx), { isolationLevel: 'RepeatableRead' })
})

export const saveLibrary = createServerFn({ method: 'POST' })
  .validator((value: { before: Library; after: Library }) => value)
  .handler(async ({ data }): Promise<Library> => {
    const { db } = await import('../../server/db.mjs')
    const { writeLibrary, validateLibrary } = await import('../../server/library.mjs')
    validateLibrary(data.before)
    validateLibrary(data.after)
    return db.$transaction(tx => writeLibrary(tx, data.before, data.after), { isolationLevel: 'Serializable', timeout: 30000 })
  })
