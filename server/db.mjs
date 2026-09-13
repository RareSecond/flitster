// Server/CLI only. Do not import this module into the Vite browser application.
import { config } from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client.ts'

config({ path: '.env.local', quiet: true })
config({ path: '.env', quiet: true })
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required on the server.')

export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})
