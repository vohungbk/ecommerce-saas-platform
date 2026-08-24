import { resolve } from 'node:path';
import * as dotenv from 'dotenv';

// e2e tests bypass main.ts's bootstrap, so DATABASE_URL (and other env vars)
// need to be loaded here the same way main.ts loads them, before any module
// that reads process.env (e.g. PrismaService) is imported.
dotenv.config({ path: resolve(process.cwd(), '../../.env') });

// e2e specs freely reset/delete rows (see courses.e2e-spec.ts /
// course-lessons.e2e-spec.ts). Running them against the dev DATABASE_URL
// would wipe local dev data, so this refuses to run unless a distinct
// DATABASE_URL_TEST is configured, and points Prisma at that instead. Run
// `pnpm db:test:setup` once to create/migrate it.
const devUrl = process.env.DATABASE_URL;
const testUrl = process.env.DATABASE_URL_TEST;

if (!testUrl) {
  throw new Error(
    'DATABASE_URL_TEST is not set. e2e tests must run against an isolated ' +
      'test database, never the dev database. Add DATABASE_URL_TEST to ' +
      '.env (see .env.example) and run `pnpm db:test:setup`.',
  );
}

if (testUrl === devUrl) {
  throw new Error(
    'DATABASE_URL_TEST must not equal DATABASE_URL — e2e tests reset ' +
      'tables freely and would wipe your dev database.',
  );
}

process.env.DATABASE_URL = testUrl;

// e2e spec files share this one database and several assume table
// ownership within their own beforeAll/afterAll (see courses.e2e-spec.ts's
// "GET /courses" block). jest-e2e.json sets maxWorkers: 1 so spec files run
// sequentially instead of racing each other's fixtures.
