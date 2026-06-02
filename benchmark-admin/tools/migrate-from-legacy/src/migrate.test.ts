import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { type QueryClient, migrate, verify } from './migrate.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../drizzle/migrations');
const ADMIN_MIGRATIONS = [
  '0000_same_ma_gnuci.sql',
  '0001_add_comment_index.sql',
  '0002_decouple_media.sql',
  '0003_soft_delete_indexes.sql',
];

// Mirrors ben5 migration 0004 — added separately so we can test both states.
const DIFFICULTY_MIGRATION = `
  ALTER TABLE video_benchmark_items ADD COLUMN difficulty text DEFAULT '' NOT NULL;
  ALTER TABLE video_benchmark_items ADD CONSTRAINT difficulty_allowed CHECK (difficulty IN ('', '易', '中', '难'));
`;

// Minimal legacy schema: only the columns the tool reads.
const LEGACY_SCHEMA = `
  CREATE TABLE assets (
    id bigint PRIMARY KEY,
    kind text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}',
    cover_image_id bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
  );
  CREATE TABLE asset_images (
    id bigint PRIMARY KEY,
    asset_id bigint NOT NULL,
    object_key text NOT NULL,
    source text NOT NULL DEFAULT 'upload',
    media_type text NOT NULL DEFAULT 'image',
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE video_benchmark_items (
    id bigint PRIMARY KEY,
    shot_type text NOT NULL DEFAULT '',
    task_type text NOT NULL DEFAULT '',
    question_type text NOT NULL DEFAULT '',
    manual_tag text NOT NULL DEFAULT '',
    difficulty text NOT NULL DEFAULT '',
    scene text NOT NULL DEFAULT '',
    screen_size text NOT NULL DEFAULT '',
    text_prompt text NOT NULL DEFAULT '',
    judging_criteria text NOT NULL DEFAULT '',
    score double precision,
    needs_revision boolean NOT NULL DEFAULT false,
    character_image_id bigint,
    scene_image_id bigint,
    prop_image_id bigint,
    audio_input_id bigint,
    video_input_id bigint,
    video_output_id bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
  );
  CREATE TABLE video_benchmark_media_links (
    id bigint PRIMARY KEY,
    item_id bigint NOT NULL,
    role text NOT NULL,
    media_id bigint NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE benchmark_item_comments (
    id bigint PRIMARY KEY,
    item_id bigint NOT NULL,
    author text NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
`;

function asClient(pg: PGlite): QueryClient {
  return {
    query: (text, params) => pg.query(text, params) as Promise<{ rows: Record<string, unknown>[] }>,
  };
}

async function exec(pg: PGlite, sql: string): Promise<void> {
  await pg.exec(sql);
}

async function seedLegacy(pg: PGlite): Promise<void> {
  await exec(pg, LEGACY_SCHEMA);
  await exec(
    pg,
    `
    -- character asset with a real name, cover image
    INSERT INTO assets (id, kind, data, cover_image_id) VALUES
      (1, 'character', '{"persona":"Hero","era":"Tang","genre":"epic","extra":"keep"}', 10),
      (2, 'scene', '{}', NULL),               -- no name → fallback to cover basename
      (3, 'audio', '{"title":"Song A"}', NULL), -- container → dropped, files standalone
      (4, 'prop', '{"title":"Sword"}', 40);
    INSERT INTO asset_images (id, asset_id, object_key, media_type) VALUES
      (10, 1, 'uploads/hero.png', 'image'),
      (20, 2, 'uploads/scene-bg.png', 'image'),
      (30, 3, 'uploads/song-a.mp3', 'audio'),  -- becomes standalone, title "Song A"
      (40, 4, 'uploads/sword.png', 'image');
    -- item 1 has a link row; item 2 only has FK columns (pre-0005 era)
    INSERT INTO video_benchmark_items (id, text_prompt, difficulty, character_image_id, scene_image_id) VALUES
      (1, 'prompt one', '易', NULL, NULL),
      (2, 'prompt two', '中', 10, 20);
    INSERT INTO video_benchmark_media_links (id, item_id, role, media_id, sort_order) VALUES
      (100, 1, 'character_image', 10, 0);
    INSERT INTO benchmark_item_comments (id, item_id, author, body) VALUES
      (1000, 1, 'alice', 'looks good');
  `,
  );
}

async function makeTarget(withDifficulty: boolean): Promise<PGlite> {
  const pg = new PGlite();
  for (const file of ADMIN_MIGRATIONS) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)) {
      await pg.exec(stmt);
    }
  }
  if (withDifficulty) await exec(pg, DIFFICULTY_MIGRATION);
  return pg;
}

async function tableCount(pg: PGlite, table: string): Promise<number> {
  const { rows } = await pg.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return rows[0]?.n ?? 0;
}

describe('migrate (integration)', () => {
  let sourcePg: PGlite;

  beforeEach(async () => {
    sourcePg = new PGlite();
    await seedLegacy(sourcePg);
  });

  it('migrates rows with container drop, name promotion, and FK reconciliation', async () => {
    const targetPg = await makeTarget(true);
    const result = await migrate(asClient(sourcePg), asClient(targetPg), { mode: 'apply' });

    expect(result.difficultyMigrated).toBe(true);
    expect(result.counts.droppedContainerAssets).toBe(1); // the audio container
    expect(result.counts.keptAssets).toBe(3);
    expect(await tableCount(targetPg, 'assets')).toBe(3);
    expect(await tableCount(targetPg, 'media')).toBe(4);

    // audio file detached to standalone with the container's title
    const standalone = await targetPg.query<{ asset_id: number | null; title: string }>(
      'SELECT asset_id, title FROM media WHERE id = 30',
    );
    expect(standalone.rows[0]).toEqual({ asset_id: null, title: 'Song A' });

    // name promotion: persona used, era/genre promoted, stripped from data
    const a1 = await targetPg.query<{
      name: string;
      era: string;
      genre: string;
      data: Record<string, unknown>;
    }>('SELECT name, era, genre, data FROM assets WHERE id = 1');
    expect(a1.rows[0]?.name).toBe('Hero');
    expect(a1.rows[0]?.era).toBe('Tang');
    // only title/era/genre are stripped; persona has no column so it stays in data
    expect(a1.rows[0]?.data).toEqual({ extra: 'keep', persona: 'Hero' });

    // name fallback to cover basename
    const a2 = await targetPg.query<{ name: string }>('SELECT name FROM assets WHERE id = 2');
    expect(a2.rows[0]?.name).toBe('scene-bg.png');
    expect(result.anomalies.some((x) => x.type === 'name_fallback')).toBe(true);

    // links: 1 legacy + 2 FK-derived (item 2 character + scene) = 3
    expect(await tableCount(targetPg, 'video_benchmark_media_links')).toBe(3);
    expect(result.counts.derivedLinks).toBe(2);
    expect(result.anomalies.filter((x) => x.type === 'fk_without_link')).toHaveLength(2);

    // difficulty carried through
    const d = await targetPg.query<{ difficulty: string }>(
      'SELECT difficulty FROM video_benchmark_items WHERE id = 2',
    );
    expect(d.rows[0]?.difficulty).toBe('中');
  });

  it('is idempotent: a second apply converges to the same row counts', async () => {
    const targetPg = await makeTarget(true);
    await migrate(asClient(sourcePg), asClient(targetPg), { mode: 'apply' });
    const after1 = {
      assets: await tableCount(targetPg, 'assets'),
      media: await tableCount(targetPg, 'media'),
      items: await tableCount(targetPg, 'video_benchmark_items'),
      links: await tableCount(targetPg, 'video_benchmark_media_links'),
      comments: await tableCount(targetPg, 'benchmark_item_comments'),
    };

    await migrate(asClient(sourcePg), asClient(targetPg), { mode: 'apply' });
    const after2 = {
      assets: await tableCount(targetPg, 'assets'),
      media: await tableCount(targetPg, 'media'),
      items: await tableCount(targetPg, 'video_benchmark_items'),
      links: await tableCount(targetPg, 'video_benchmark_media_links'),
      comments: await tableCount(targetPg, 'benchmark_item_comments'),
    };

    expect(after2).toEqual(after1);
  });

  it('skips difficulty and notes it when the target column is absent', async () => {
    const targetPg = await makeTarget(false);
    const result = await migrate(asClient(sourcePg), asClient(targetPg), { mode: 'apply' });

    expect(result.difficultyMigrated).toBe(false);
    expect(result.notes.join(' ')).toMatch(/difficulty/i);
    expect(await tableCount(targetPg, 'video_benchmark_items')).toBe(2);
    // column genuinely absent on target
    const col = await targetPg.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='video_benchmark_items' AND column_name='difficulty'`,
    );
    expect(col.rows).toHaveLength(0);
  });

  it('dry-run computes counts/anomalies without writing', async () => {
    const targetPg = await makeTarget(true);
    const result = await migrate(asClient(sourcePg), asClient(targetPg), { mode: 'dry-run' });

    expect(result.mode).toBe('dry-run');
    expect(result.counts.keptAssets).toBe(3);
    expect(await tableCount(targetPg, 'assets')).toBe(0);
    expect(await tableCount(targetPg, 'media')).toBe(0);
  });

  it('verify reports parity after apply', async () => {
    const targetPg = await makeTarget(true);
    await migrate(asClient(sourcePg), asClient(targetPg), { mode: 'apply' });

    const checks = await verify(asClient(sourcePg), asClient(targetPg));
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.find((c) => c.name === 'links')).toMatchObject({
      ok: true,
      expected: 3,
      actual: 3,
    });
  });
});
