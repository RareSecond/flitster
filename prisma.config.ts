import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'

config({ path: '.env.local', quiet: true })
config({ path: '.env', quiet: true })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Neon direct connection for migrations; pooled URL can be used at runtime.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
  },
})
