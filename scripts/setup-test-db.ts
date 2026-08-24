// Creates the isolated e2e test database (if it doesn't exist yet) and
// applies all Prisma migrations to it. Safe to re-run any time — database
// creation is idempotent and `prisma migrate deploy` only applies pending
// migrations.
//
// Deliberately never touches DATABASE_URL (the dev database) — this script
// only ever connects using DATABASE_URL_TEST.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  console.error(
    "DATABASE_URL_TEST is not set. Add it to .env (see .env.example) " +
      "before running this script.",
  );
  process.exit(1);
}

if (testUrl === process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL_TEST must not be the same as DATABASE_URL — e2e tests " +
      "reset tables freely and would wipe your dev database.",
  );
  process.exit(1);
}

async function createDatabaseIfMissing(connectionString: string) {
  const url = new URL(connectionString);
  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName) {
    throw new Error(`DATABASE_URL_TEST has no database name: ${connectionString}`);
  }

  const adminUrl = new URL(connectionString);
  adminUrl.pathname = "/postgres";

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (rowCount === 0) {
      // Database identifiers cannot be parameterized; dbName comes from our
      // own DATABASE_URL_TEST env var, not external input.
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Created database "${dbName}".`);
    } else {
      console.log(`Database "${dbName}" already exists.`);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  await createDatabaseIfMissing(testUrl!);

  console.log("Applying migrations to the test database...");
  execFileSync("pnpm", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
