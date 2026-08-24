# E-Commerce & SaaS Platform

Fullstack platform combining e-learning, B2B subscriptions, digital products,
organization/team management, and billing. See `CLAUDE.md` for architecture,
conventions, and the definition of done.

**Status: Phase 0 — project foundation.** Only the monorepo scaffold, skeleton
apps, database wiring, and health-check plumbing exist so far.

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io) 10+ (`corepack enable` or `npm i -g pnpm`)
- Docker (for local PostgreSQL)

## Setup

```bash
# 1. Install dependencies (also runs `prisma generate` via postinstall)
pnpm install

# 2. Copy env files
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
# edit .env if you need non-default Postgres credentials/ports

# 3. Start PostgreSQL
pnpm docker:up

# 4. Apply the database schema
pnpm prisma:migrate

# 5. (optional) seed the database
pnpm prisma:seed
```

## Running the apps

```bash
pnpm dev          # runs both apps/web (:3000) and apps/api (:4000) in parallel
pnpm dev:web      # apps/web only
pnpm dev:api      # apps/api only
```

- Frontend: http://localhost:3000
- API health check: http://localhost:4000/health
- API docs (Swagger): http://localhost:4000/api/docs

## Verifying it works

```bash
curl http://localhost:4000/health
# {"status":"ok","info":{"database":{"status":"up"}},...}
```

Open http://localhost:3000 — the homepage renders a widget that fetches
`/health` from `apps/api` in the browser, proving both networking and CORS are
wired correctly (a server-only fetch wouldn't prove CORS works).

## Quality checks

```bash
pnpm lint         # eslint for apps/web and apps/api
pnpm typecheck    # tsc --noEmit for both apps (apps/web runs `next typegen` first)
pnpm test         # unit tests for both apps
```

### e2e tests

`apps/api`'s e2e suite (`pnpm --filter api test:e2e`) hits a real database and
resets tables between specs, so it must never run against your dev database.
One-time setup:

```bash
# add DATABASE_URL_TEST to .env (see .env.example) — must be a different
# database name than DATABASE_URL
pnpm db:test:setup   # creates the test database and applies migrations to it
```

`test/jest-e2e.setup.ts` refuses to run if `DATABASE_URL_TEST` is missing or
equal to `DATABASE_URL`, to prevent accidentally wiping dev data.

## Database

- Schema: `prisma/schema.prisma`
- Migrations: `prisma/migrations/`
- Seed script: `prisma/seed.ts`
- Prisma CLI config (connection URL, migration path): `prisma.config.ts`

```bash
pnpm prisma:generate   # regenerate the Prisma client
pnpm prisma:migrate    # create/apply a migration (prompts for a name)
pnpm prisma:studio     # open Prisma Studio
pnpm prisma:seed       # run prisma/seed.ts
```

Prisma 7 requires a driver adapter (`@prisma/adapter-pg`) at runtime — see
`apps/api/src/prisma/prisma.service.ts` for the pattern used across this repo.

## Stopping

```bash
pnpm docker:down   # stops and removes the Postgres container (data volume persists)
```

## Project structure

```
apps/
  web/    # Next.js frontend (App Router)
  api/    # NestJS backend (REST + Swagger)
prisma/   # Shared schema, migrations, seed script
.claude/agents/   # planner, dev, qa, reviewer — see CLAUDE.md for the workflow
docker-compose.yml
```
