import { resolve } from 'node:path';
import * as dotenv from 'dotenv';

// e2e tests bypass main.ts's bootstrap, so DATABASE_URL (and other env vars)
// need to be loaded here the same way main.ts loads them, before any module
// that reads process.env (e.g. PrismaService) is imported.
dotenv.config({ path: resolve(process.cwd(), '../../.env') });
