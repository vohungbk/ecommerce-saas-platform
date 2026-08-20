---
name: db-migration
description: Guidance for creating safe Prisma migrations against PostgreSQL — edit schema.prisma, generate the migration, check it for safety/rollback risk, regenerate the Prisma client, and update dependent code. Use when the user asks to add/change a database column, model, index, or relation, or requests a "migration" or "schema change".
---

Follow this sequence for any change to `prisma/schema.prisma`. Never
hand-edit an already-applied migration file — see root `CLAUDE.md`.

## Steps

1. **Edit `prisma/schema.prisma`** with the model/field/index change.
   - New required column on an existing table with rows: add it as optional
     (`String?`) or with a `@default(...)`, never as a bare required column —
     Postgres will reject the migration against non-empty tables otherwise.
   - Renames: Prisma sees a rename as drop + add by default, which loses
     data. Generate the migration, then hand-edit the **new, not-yet-applied**
     SQL file to use `ALTER TABLE ... RENAME COLUMN` instead, before running
     `migrate dev`.

2. **Generate the migration:**
   ```bash
   pnpm prisma:migrate --name <short_description>
   ```
   This creates `prisma/migrations/<timestamp>_<name>/migration.sql` and
   applies it to the local dev database.

3. **Read the generated SQL before moving on.** Check specifically for:
   - `DROP COLUMN` / `DROP TABLE` on anything that might still have
     consumers — confirm the code no longer reads it first.
   - A new `NOT NULL` column without a `DEFAULT` on a non-empty table.
   - A new unique constraint that could fail against existing duplicate data.

4. **Test the rollback.** Prisma has no built-in "down" migration, so verify
   manually:
   - On a disposable local DB (`pnpm docker:down && pnpm docker:up` for a
     clean volume, or a scratch database), apply the migration, confirm the
     app boots and the affected endpoints work.
   - Confirm you can restore prior behavior by reverting the schema change
     and either applying a hand-written down SQL script or restoring from a
     pre-migration snapshot — for a destructive change (dropped column/table),
     write and keep that down-SQL alongside the migration until the change
     has been live for a full deploy cycle.
   - Never test a rollback against a shared/staging database with real data.

5. **Regenerate the Prisma client:**
   ```bash
   pnpm prisma:generate
   ```
   This is the equivalent of a Supabase `types.ts` regen for this stack —
   it updates `@prisma/client`'s generated types so TypeScript catches every
   call site that needs updating.

6. **Update dependent code.** Run `pnpm typecheck` across touched packages —
   a schema change surfaces as type errors everywhere the old shape was
   assumed (DTOs, services, seed script, frontend types if duplicated).

7. **Update `prisma/seed.ts` if the change affects seeded models** — keep
   seed writes idempotent (`upsert`, not `create`), per root `CLAUDE.md`.

8. **Run** `pnpm lint && pnpm typecheck && pnpm test` before declaring the
   migration done.

## Example

**Input (user request):**
> "Add a `status` field to the `Order` model (`pending`, `paid`, `cancelled`),
> defaulting to `pending`."

**Output:**

`prisma/schema.prisma` (excerpt):

```prisma
enum OrderStatus {
  pending
  paid
  cancelled
}

model Order {
  id     String      @id @default(uuid())
  status OrderStatus @default(pending)
  // ...existing fields
}
```

Generated file: `prisma/migrations/20260819120000_add_order_status/migration.sql`

```sql
-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'paid', 'cancelled');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "status" "OrderStatus" NOT NULL DEFAULT 'pending';
```

Safety check: `NOT NULL` is fine here only because `DEFAULT 'pending'` is
present — confirmed safe against existing rows. Rollback tested by dropping
the column and enum on a scratch DB, confirming the app still boots with the
prior schema.
