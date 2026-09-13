import type { Library } from '../src/lib/library'
import type { Prisma } from './generated/prisma/client'
export function readLibrary(tx: Prisma.TransactionClient): Promise<Library>
export function writeLibrary(tx: Prisma.TransactionClient, before: Library, after: Library): Promise<Library>
export function validateLibrary(value: unknown): Library
