# Database

Prisma 7 + PostgreSQL on Neon. The app is still a React/Vite browser app;
database tooling is ready, but the UI still reads and writes localStorage.

| Model | Purpose |
| --- | --- |
| User | Person who owns lists and chooses active lists |
| List | Named list in the shared library, with an owner |
| Song | `id`, `listId`, `year`, `title`, `artist`, `spotifyId` |
| ListActivation | A person's active list; composite key `(userId, listId)` |
| DeckCard | Existing QR code → printed year mapping in `deck_cards` |

`spotifyId` is deliberately **not unique**, even within a list. Game years
belong to song entries, so two lists can disagree. A song ID identifies an
entry, not a globally canonical Spotify recording. Deleting a list cascades
to its songs and activations. Deleting an owner with lists is restricted.
Deactivating a list deletes only its activation row.

The imported list uses the temporary owner ID `personal-import`. This is a
data owner, not an authenticated account. When adding authentication, map it
to the real account. Server functions must derive the user from the session,
allow signed-in users to browse the library, and check ownership for edits.
Do not trust a client-supplied user ID for these checks.

## Commands

Put `DATABASE_URL` in `.env.local` (server-only, never `VITE_DATABASE_URL`).
An optional `DIRECT_URL` takes precedence for Prisma CLI migrations. Keep
Neon's supplied SSL parameters. Node 22.18+ is needed by the seed runner.

```sh
npm run db:validate
npm run db:generate
npm run db:deploy
npm run db:seed
```

For future schema changes, use `npm run db:migrate -- --name descriptive_name`
against a development database, then commit the migration and deploy it.

The first migration records the existing `deck_cards` table. It was marked
applied on the original Neon database; a fresh database runs both migrations.

The seed contains 82 supplied cards and the complete 194-track accepted list.
The pasted list's trailing import history was truncated and is intentionally
not included. Supplied game years are preserved; Spotify URIs are converted
to bare track IDs. Seed rows have stable IDs so reruns do not duplicate entries
or overwrite edits. The seed activates the imported list for its owner.

## Server integration

`server/db.mjs` provides a Prisma client for Node server/CLI code. It is not
imported by the browser. TanStack Start runs in SPA mode. Future shared-data
fetches and writes belong in authenticated Start server functions; the UI and
game logic remain client-side. The generated client is ignored
by Git and must be regenerated during server build setup.

Installation audit reports advisories in Prisma CLI development dependencies
(`deepmerge-ts` and `mysql2`). The latter is not used by this PostgreSQL app.
No forced major downgrade or unverified transitive override has been applied.
