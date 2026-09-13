import { useSyncExternalStore } from 'react'
import { databaseLibrary, subscribeLibrary } from '../lib/library'

export const useLibrary = () => useSyncExternalStore(subscribeLibrary, databaseLibrary, databaseLibrary)
