# E-Commerce & SaaS Platform

## Project Purpose

A production-quality platform combining e-learning, B2B subscriptions, digital
products, organization/team management, and billing. Built primarily as a
Fullstack engineering skills project — clean architecture, maintainability,
scalability, testing, and security are prioritized over speed of delivery.

Development proceeds phase by phase (see `docs` / project history for the phase
plan). Do not implement a future phase's features while working on the current one.

**Current phase: Phase 0 — project foundation.** Only the monorepo scaffold,
skeleton apps, database wiring, and tooling exist. No auth, courses, orders,
subscriptions, or admin features have been implemented yet.

## Rules

Detailed conventions live in separate rule files, loaded automatically when
relevant instead of being kept in this file:

- @rules/frontend.md — component conventions, styling, state management.
- @rules/backend.md — API route rules, Prisma/query rules.
- @rules/testing.md — unit vs. integration tests, minimum coverage.
- @rules/git-commit.md — Conventional Commits format.

## Architecture Overview

pnpm-workspace monorepo with two independently deployable apps:

- `apps/web` (Next.js) never talks to the database directly. It only calls
  `apps/api` over HTTP/REST.
- `apps/api` (NestJS) owns all database access via Prisma and is the only app
  with `@prisma/client` as a runtime dependency.
- A single PostgreSQL instance runs via `docker-compose` for local development.
- `prisma/` (schema, migrations, seed) lives at the repo root, shared as the
  single source of truth for the data model.

## Tech Stack

- **Frontend**: Next.js (App Router), TypeScript, Tailwind CSS v4, TanStack Query.
  React Hook Form / Zod / shadcn/ui are added when the first real form/entity
  needs them — not scaffolded speculatively.
- **Backend**: NestJS, TypeScript, REST, Prisma, PostgreSQL, Swagger/OpenAPI
  (`@nestjs/swagger`, served at `/api/docs`), `@nestjs/terminus` for health checks.
- **Database**: PostgreSQL 16, via Prisma. Prisma 7 requires a driver adapter
  (`@prisma/adapter-pg`) at runtime — the schema's `datasource` block no longer
  carries a connection `url`; that lives in `prisma.config.ts`.
- **Tooling**: pnpm workspaces, Docker Compose, ESLint, Prettier.

## Directory Structure

```
apps/
  web/            # Next.js frontend
  api/            # NestJS backend
    src/
      health/     # GET /health (Terminus + Prisma ping check)
      prisma/     # PrismaService / PrismaModule (@Global)
      auth/       # AdminGuard/AuthGuard (dev-only x-user-id shim), CurrentUser decorator
      courses/    # POST /courses (admin-only)
      categories/ # POST /categories (admin-only), GET /categories (any authenticated user)
      enrollments/ # POST /courses/:courseId/enroll, GET /enrollments (any authenticated user)
      progress/   # PUT /courses/:courseId/lessons/:lessonId/progress, GET /courses/:courseId/progress (any authenticated, enrolled user)
      reviews/    # POST/GET/PATCH/DELETE /courses/:courseId/reviews, GET /courses/:courseId/reviews/summary (any authenticated user; create requires enrollment)
      common/     # cross-cutting Nest pieces (e.g. global exception filter)
packages/         # Shared packages — created only when a genuine cross-app need exists
prisma/
  schema.prisma
  seed.ts
  migrations/
.claude/agents/    # planner, dev, qa, reviewer
docker-compose.yml # Postgres for local dev
prisma.config.ts   # Prisma 7 CLI config (schema path, migrations, datasource url)
```

## Coding Conventions

- TypeScript strict mode everywhere. No unexplained `any`.
- `apps/api`: one Nest module per bounded context (mirrors the future domain
  list: auth, users, organizations, courses, enrollments, products, orders,
  subscriptions, billing, coupons, admin, analytics). Don't create a module
  until its feature is being built.
- Don't add abstractions, config flags, or shared packages "for later." Add them
  when a second real consumer exists.
- See @rules/frontend.md and @rules/backend.md for component/route-level
  conventions.

## Naming Conventions

- Files: kebab-case (`health-check-widget.tsx`, `prisma.service.ts`).
- Classes/Components: PascalCase.
- Nest files: `*.controller.ts`, `*.service.ts`, `*.module.ts` suffixes.
- Prisma models: PascalCase (`User`), fields camelCase, mapped to snake_case
  tables/columns via `@@map` / `@map` where it reads more naturally in SQL.

## API Conventions

- REST, resource-oriented routes (see the endpoint list in the project spec).
- All endpoints documented in Swagger (`/api/docs`).
- DTOs validated at the boundary (`class-validator`).
- `GET /health` is intentionally unprefixed and unauthenticated — infrastructure
  endpoints stay outside future API versioning/auth.
- Versioning strategy (e.g. `/api/v1`) is not yet decided — do not invent one
  ad hoc; raise it when the first breaking API change is needed.

## Database Conventions

- `prisma/schema.prisma` is the single source of truth for the schema.
- All schema changes go through `prisma migrate dev` — never hand-edit an
  already-applied migration file.
- Seed data (`prisma/seed.ts`) must be idempotent (`upsert`, not `create`).
- Runtime `PrismaClient` instances require a driver adapter
  (`new PrismaPg({ connectionString: process.env.DATABASE_URL })`) — see
  `apps/api/src/prisma/prisma.service.ts` for the pattern.
- Design multi-tenant (organization) data access to filter by organization
  membership at the query layer — never trust a client-supplied org ID alone.

## Testing Requirements

- Before declaring any task complete: `pnpm lint && pnpm typecheck && pnpm test`
  must pass for every package touched.
- Priority areas once built: authentication, authorization, tenant isolation,
  order creation, subscription logic, coupon validation, enrollment, progress
  tracking.
- See @rules/testing.md for what to test, unit vs. integration, and minimum
  coverage expectations.

## Security Requirements

- Never commit secrets. `.env*` (except `.env.example`) is gitignored.
- Keep `.env.example` in sync with every env var actually read by the apps.
- Authorization is enforced server-side only, never trust client-side checks.
- Validate and sanitize all external input at the API boundary.
- Tenant boundaries (organization isolation) are security-critical — a bug that
  leaks data across organizations is treated as a security incident, not a
  regular bug.

## Git Conventions

See @rules/git-commit.md for commit message format and commit hygiene.

## Definition of Done (per phase/feature)

- [ ] Implementation matches the approved plan's acceptance criteria.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass.
- [ ] Tests added/updated for the behavior change.
- [ ] Manually verified end-to-end where automated coverage can't reach
      (e.g. an actual browser check for anything CORS- or UI-related).
- [ ] No unrelated files touched.
- [ ] Docs (this file, README) updated if conventions or setup steps changed.

## AI Usage Rules

1. Never invent APIs or library behavior — verify against the actual installed
   package (types, `node_modules`, or official docs) before writing code
   against it. Assume nothing about "the version you remember."
2. Verify uncertain framework/library behavior against official documentation
   or the installed package's own type definitions, especially for
   fast-moving majors (Next, Prisma, NestJS in this project have all had
   breaking changes across recent majors).
3. Do not modify unrelated files.
4. Prefer existing patterns over introducing new abstractions.
5. Add tests for every meaningful behavior change.
6. Run typecheck/lint/tests before declaring any task complete.
7. Never claim something works without having actually run it and observed
   the output.
8. Never expose secrets in code, logs, or API responses.
9. Never bypass authorization checks, even temporarily "to test something."
10. Keep tenant (organization) boundaries secure — treat any cross-tenant data
    leak as critical.
