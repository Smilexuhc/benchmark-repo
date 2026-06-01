import { PGlite } from '@electric-sql/pglite';
import * as schema from '@benchmark-admin/shared/db/schema';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Apply migrations in journal order so the test schema matches production.
const MIGRATIONS_DIR = join(__dirname, '../../../../../drizzle/migrations');
const MIGRATION_FILES = [
  '0000_same_ma_gnuci.sql',
  '0001_add_comment_index.sql',
  '0002_decouple_media.sql',
];

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let _db: TestDb | null = null;

export async function getTestDb(): Promise<TestDb> {
  if (_db) return _db;

  const pglite = new PGlite();

  for (const file of MIGRATION_FILES) {
    const fileSql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const stmts = fileSql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of stmts) {
      await pglite.exec(stmt);
    }
  }

  _db = drizzle(pglite, { schema });
  return _db;
}

// Truncates all tables in FK-safe order, resetting identity sequences.
// Call in beforeEach to ensure count-based assertions are order-independent.
export async function resetTestDb(): Promise<void> {
  const db = await getTestDb();
  await db.execute(sql`
    TRUNCATE
      video_benchmark_media_links,
      benchmark_item_comments,
      video_benchmark_items,
      media,
      assets
    RESTART IDENTITY CASCADE
  `);
}
