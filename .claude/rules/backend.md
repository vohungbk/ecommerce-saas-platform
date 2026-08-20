# Backend Rules (apps/api)

## API Route Rules

- Every route accepting a body/query/params validates it with a DTO class
  decorated with `class-validator` decorators. Never read `req.body` or an
  unvalidated param directly in a controller or service.
- Controllers stay thin: parse/validate input, call one service method,
  return its result. No business logic, no direct Prisma calls in a
  controller.
- All responses that represent an error use the same shape, returned via a
  global Nest exception filter (not ad hoc `res.status(...).json(...)` in
  individual handlers):

  ```json
  {
    "statusCode": 400,
    "error": "Bad Request",
    "message": "email must be a valid email address",
    "path": "/users",
    "timestamp": "2026-08-19T12:00:00.000Z"
  }
  ```

  - `message` is a string for a single error, or a string array for
    multiple validation errors — never leak stack traces or internal error
    detail to the client.
- Every route is documented in Swagger (`@ApiOperation`, `@ApiResponse`,
  DTOs annotated with `@ApiProperty`) per `CLAUDE.md`.
- Authorization is checked server-side in a guard/service — never inferred
  from a client-supplied field (e.g. a body `organizationId` or `role`).

## Prisma / Query Rules

- No N+1 queries: when a request needs related rows, fetch them with
  Prisma's `include`/`select` in one query, not a loop issuing one query per
  parent row. If you find yourself calling `prisma.x.findUnique` inside a
  `.map()`/`for` loop, restructure into a single `findMany` with
  `include`/`where: { id: { in: [...] } }`.
- Select only the fields a handler actually needs (`select`) instead of
  fetching full rows by default, especially for list endpoints.
- Multi-tenant (organization-scoped) queries must filter by the
  authenticated user's organization membership at the query layer — always
  add `where: { organizationId: ... }` (or the join-table equivalent)
  derived from the authenticated session, never from a client-supplied ID
  alone. This project uses application-level tenant filtering in Prisma
  queries, not database-level Row Level Security — there is no Postgres RLS
  policy layer here, so the query-layer filter is the only enforcement
  point and must not be skipped.
- Wrap multi-step writes that must succeed or fail together in
  `prisma.$transaction(...)`.
- Schema changes always go through `prisma migrate dev` — never hand-edit an
  applied migration file (see root `CLAUDE.md`).
