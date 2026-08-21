# Testing Rules

## Unit Tests vs. Integration Tests

- **Unit test** a function/method when it has real logic to get wrong in
  isolation: a service method's business rules, a validation function, a
  Zod schema, a pure utility, a custom React hook's derived state. Mock its
  direct dependencies (e.g. mock `PrismaService` in a service unit test).
- **Integration test** (`apps/api` `test/*.e2e-spec.ts`) a route when the
  thing worth verifying is how pieces connect: the full request → DTO
  validation → guard/auth → service → Prisma → response shape, or a
  multi-tenant isolation check (org A can never read org B's data). Use a
  real (test) database for these — do not mock Prisma in a test that exists
  specifically to prove the query layer is correct.
- Prefer one solid integration test over several shallow unit tests when the
  behavior under test is "does this endpoint work end-to-end," especially
  for the priority areas called out in root `CLAUDE.md` (auth, authorization,
  tenant isolation, orders, subscriptions, coupons, enrollment, progress).
- Don't unit-test framework wiring (a controller that only delegates to a
  service, a trivial getter). Test the logic, not the plumbing.

## Minimum Coverage

- Every meaningful behavior change ships with at least one test that fails
  without the change and passes with it (root `CLAUDE.md` requirement — not
  optional).
- New service methods with branching logic (validation, calculations,
  authorization checks): cover the happy path **and** every distinct branch
  (e.g. valid input, invalid input, unauthorized, not-found).
- New API endpoints: at least one integration test for the success case and
  one for the primary failure case (validation error or auth failure).
- Tenant-isolation-sensitive code (anything filtering by `organizationId`):
  always include a test asserting cross-tenant access is rejected — treat a
  missing test here the same as a missing security check.
- Never lower an assertion, delete a failing test, or add `.skip`/`.only`
  to force a green run — a failing test is reported, not silenced (root
  `CLAUDE.md`).
- This also covers the quieter version of the same cheat: never change a
  test's expected value to match whatever the current (possibly buggy)
  code actually outputs. An expected value must come from the spec/
  acceptance criteria — what the behavior *should* be — never from
  observing actual output and copying it back in to force a pass. If the
  actual output doesn't match the spec, that is a failing test to report,
  not a test to "correct."
