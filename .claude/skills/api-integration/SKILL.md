---
name: api-integration
description: Step-by-step guidance for creating a new API route in apps/api (NestJS) — DTO validation, Prisma service logic, standardized error responses, Swagger docs, and tests, following rules/backend.md. Use when adding a new endpoint/controller method, wiring a new resource to the API, or when the user asks to "add an API for X", "create a new route", or "expose an endpoint".
---

Follow this sequence when adding a new API route. Each step maps to a rule in
`@rules/backend.md` — don't skip one to save time.

## Steps

1. **Confirm the module exists** (or create it). One Nest module per bounded
   context — see root `CLAUDE.md`. Don't create a module before its feature
   is actually being built.

2. **Define the DTO(s)** in `<module>/dto/`, one class per request shape
   (`create-x.dto.ts`, `update-x.dto.ts`). Every field gets a
   `class-validator` decorator (`@IsString()`, `@IsUUID()`, `@IsOptional()`,
   etc.) and an `@ApiProperty()` for Swagger. Never accept an unvalidated
   `any` body.

3. **Write the controller method.** Thin: parse route/query params, call one
   service method, return its result. No Prisma calls and no business logic
   in the controller. Add `@ApiOperation` + `@ApiResponse` decorators.

4. **Write the service method** in `<module>/<module>.service.ts`. Business
   logic and all Prisma access live here.
   - Scope every query by the authenticated user's organization (never trust
     a client-supplied `organizationId`) — see the tenant-isolation rule in
     `@rules/backend.md`.
   - Avoid N+1s: use `include`/`select` for related data instead of looping
     queries.
   - Multi-step writes that must succeed/fail together go in
     `prisma.$transaction(...)`.

5. **Verify error responses match the standard shape.** Don't
   `res.status(...).json(...)` by hand — throw a Nest exception
   (`NotFoundException`, `BadRequestException`, etc.) and let the global
   exception filter format it. See the response shape in
   `@rules/backend.md`.

6. **Write tests** per `@rules/testing.md`:
   - Unit test the service method's branching logic (mock `PrismaService`).
   - Add an e2e/integration test (`test/*.e2e-spec.ts`) covering the success
     case and the primary failure case (validation error or auth failure).
   - If the route is tenant-scoped, add a test asserting cross-tenant access
     is rejected.

7. **Run** `pnpm lint && pnpm typecheck && pnpm --filter api test` before
   declaring the route done.

## Example

**Input (user request):**
> "Add a `GET /organizations/:id/members` endpoint that lists members of an
> organization."

**Output (files touched):**

```
apps/api/src/organizations/
  dto/list-members-query.dto.ts   # pagination query params, validated
  organizations.controller.ts     # + getMembers() method
  organizations.service.ts        # + listMembers() method
  organizations.controller.spec.ts (or .e2e-spec.ts)
```

`organizations.service.ts` (excerpt):

```ts
async listMembers(organizationId: string, requesterId: string) {
  await this.assertMembership(organizationId, requesterId); // tenant check first

  return this.prisma.organizationMember.findMany({
    where: { organizationId },
    select: {
      id: true,
      role: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
}
```

Error response returned for an unauthorized requester:

```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "message": "You are not a member of this organization",
  "path": "/organizations/9f2b.../members",
  "timestamp": "2026-08-19T12:00:00.000Z"
}
```
