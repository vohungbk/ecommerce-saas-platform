---
name: code-review-checklist
description: Checklist Claude applies when reviewing a PR or diff in this repo — naming conventions, error handling, security/tenant isolation, N+1 query performance, and test coverage. Use whenever the user asks to review a PR, review a diff, review recent changes, or "check this before I commit/push".
---

Apply this checklist to every changed file in the diff/PR. Report findings
grouped by category below; skip a category only if genuinely not applicable
(e.g. no DB queries changed → skip N+1).

## 1. Naming

- Files: kebab-case; Nest files use `*.controller.ts` / `*.service.ts` /
  `*.module.ts`; components/classes PascalCase (root `CLAUDE.md`).
- Names describe what the thing is/does — flag vague names (`data`, `temp`,
  `handleStuff`) and misleading names (a `get*` that mutates state).
- DTOs, hooks, and rule-file conventions in `@rules/frontend.md` /
  `@rules/backend.md` are followed (e.g. hooks as `use-*.ts`).

## 2. Error Handling

- API routes: errors thrown as Nest exceptions, not manual
  `res.status().json()` — response shape matches `@rules/backend.md`.
- No swallowed errors (`catch {}` with no rethrow/log).
- No leaking internal detail (stack traces, raw DB error messages, internal
  IDs) into a client-facing error message.
- Async code: every `await` that can reject is inside a function whose
  caller handles the rejection (Nest's exception filter, a `try/catch`, or a
  TanStack Query `onError`) — no unhandled promise rejections.

## 3. Security

- Authorization checked server-side — never inferred from a client-supplied
  field (`organizationId`, `role`, `userId` in the body).
- Tenant isolation: every organization-scoped Prisma query filters by the
  authenticated user's membership, not a raw client-supplied ID (per
  `@rules/backend.md`) — treat a miss here as a **blocking** finding, not a
  style note.
- No secrets, tokens, or connection strings introduced in code, logs, or
  committed `.env` files.
- All external input (body/query/params) validated at the boundary before
  use — flag anything read directly off `req` without a DTO.

## 4. Performance (N+1)

- Any loop (`for`, `.map()`, `.forEach()`) that issues a Prisma query per
  iteration — should be a single `findMany` with `include`/`where: { id: {
  in: [...] } }` instead (per `@rules/backend.md`).
- List endpoints select only the fields actually used (`select`) rather than
  full rows, especially when nesting relations.
- Multi-step writes that must be atomic use `prisma.$transaction`.

## 5. Test Coverage

- Every meaningful behavior change has an accompanying test (root
  `CLAUDE.md` — non-negotiable, not a suggestion).
- New branching logic (validation, auth checks, calculations): happy path +
  each distinct branch covered, per `@rules/testing.md`.
- New/changed tenant-scoped queries: a test asserting cross-tenant access is
  rejected.
- No assertion weakened, no test skipped/`.only`'d, to force a green run —
  flag this as a blocking finding if seen.

## Output Format

Report findings grouped by the category headers above, most severe first
within each group. For each finding: file:line, what's wrong, and the
concrete fix. If a category has no issues, state "No issues found" for it
rather than omitting it — this confirms the check actually ran.

## Example

**Input:** a diff adding `POST /orders/:id/apply-coupon`.

**Output (excerpt):**

```
## Security
- apps/api/src/orders/orders.service.ts:42 — applyCoupon() reads
  order.organizationId from the request DTO instead of the authenticated
  session, so a caller can apply a coupon to another org's order by
  passing a different id. Fix: derive organizationId from the authenticated
  user/session, not the DTO, and verify the order belongs to it before writing.

## Performance (N+1)
- apps/api/src/orders/orders.service.ts:58 — loops over `order.items` and
  calls `prisma.product.findUnique` per item. Fix: replace with one
  `prisma.product.findMany({ where: { id: { in: itemProductIds } } })`
  before the loop.

## Test Coverage
- No test added for the "coupon already applied" rejection branch in
  applyCoupon(). Add a case per @rules/testing.md.

## Naming
No issues found.

## Error Handling
No issues found.
```
