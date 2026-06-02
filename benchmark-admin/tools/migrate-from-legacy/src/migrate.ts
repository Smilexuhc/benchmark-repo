// Orchestration: read legacy (read-only) → upsert into benchmark-admin (idempotent).
//
// Idempotency contract:
//   - Legacy primary keys are preserved; no ID remap table. Every cross-table reference
//     (media.asset_id, assets.cover_image_id, links.item_id/media_id, comments.item_id)
//     stays valid by reusing the source ids.
//   - Every write is an upsert (ON CONFLICT … DO UPDATE), so a re-run converges to the
//     same state instead of duplicating or erroring.
//   - Sequences are reset to MAX(id) after the explicit-id load so future app inserts
//     don't collide with migrated ids.
//   - The assets↔media circular FK is broken with a two-pass cover write.

import {
  FK_COLUMN_TO_ROLE,
  type LegacyAssetImageRow,
  type LegacyAssetRow,
  type LegacyCommentRow,
  type LegacyItemFkRow,
  type LegacyItemRow,
  type LegacyLinkRow,
} from './legacy.ts';
import {
  type Anomaly,
  MEDIA_CONTAINER_KINDS,
  type TargetLink,
  containerTitle,
  mapAsset,
  mapComment,
  mapItem,
  mapLink,
  mapMedia,
} from './mappers.ts';

export interface QueryClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export type Mode = 'dry-run' | 'apply';

export interface MigrateOptions {
  mode: Mode;
  chunkSize?: number;
}

export interface MigrateResult {
  mode: Mode;
  difficultyMigrated: boolean;
  counts: {
    sourceAssets: number;
    keptAssets: number;
    droppedContainerAssets: number;
    media: number;
    standaloneMedia: number;
    items: number;
    legacyLinks: number;
    derivedLinks: number;
    comments: number;
  };
  anomalies: Anomaly[];
  notes: string[];
}

type ColumnSpec = { name: string; cast?: string };

function placeholder(index: number, cast?: string): string {
  return cast ? `$${index}::${cast}` : `$${index}`;
}

async function upsert(
  client: QueryClient,
  table: string,
  columns: ColumnSpec[],
  conflictColumns: string[],
  updateColumns: string[],
  rows: Record<string, unknown>[],
  chunkSize: number,
): Promise<void> {
  if (rows.length === 0) return;
  const colNames = columns.map((c) => c.name).join(', ');
  const setClause =
    updateColumns.length > 0
      ? `DO UPDATE SET ${updateColumns.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`
      : 'DO NOTHING';

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values: unknown[] = [];
    const tuples = chunk.map((row) => {
      const cells = columns.map((c) => {
        values.push(row[c.name]);
        return placeholder(values.length, c.cast);
      });
      return `(${cells.join(', ')})`;
    });
    const text = `INSERT INTO ${table} (${colNames}) VALUES ${tuples.join(', ')} ON CONFLICT (${conflictColumns.join(', ')}) ${setClause}`;
    await client.query(text, values);
  }
}

async function targetHasDifficultyColumn(target: QueryClient): Promise<boolean> {
  const { rows } = await target.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'video_benchmark_items' AND column_name = 'difficulty'`,
  );
  return rows.length > 0;
}

async function resetSequence(target: QueryClient, table: string): Promise<void> {
  await target.query(
    `SELECT setval(pg_get_serial_sequence($1, 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${table}), (SELECT COUNT(*) > 0 FROM ${table}))`,
    [table],
  );
}

export async function migrate(
  source: QueryClient,
  target: QueryClient,
  opts: MigrateOptions,
): Promise<MigrateResult> {
  const chunkSize = opts.chunkSize ?? 500;
  const anomalies: Anomaly[] = [];
  const notes: string[] = [];

  // ── Read legacy (read-only) ────────────────────────────────────────────────
  const assetRows = (await source.query('SELECT * FROM assets')).rows as LegacyAssetRow[];
  const imageRows = (await source.query('SELECT * FROM asset_images'))
    .rows as LegacyAssetImageRow[];
  const itemRows = (
    await source.query(
      `SELECT id, shot_type, task_type, question_type, manual_tag, difficulty, scene,
              screen_size, text_prompt, judging_criteria, score, needs_revision,
              created_at, updated_at, deleted_at
         FROM video_benchmark_items`,
    )
  ).rows as LegacyItemRow[];
  const fkRows = (
    await source.query(
      `SELECT id, created_at, character_image_id, scene_image_id, prop_image_id,
              audio_input_id, video_input_id, video_output_id
         FROM video_benchmark_items`,
    )
  ).rows as LegacyItemFkRow[];
  const linkRows = (await source.query('SELECT * FROM video_benchmark_media_links'))
    .rows as LegacyLinkRow[];
  const commentRows = (await source.query('SELECT * FROM benchmark_item_comments'))
    .rows as LegacyCommentRow[];

  // ── Index helpers ────────────────────────────────────────────────────────────
  const assetById = new Map<number, LegacyAssetRow>();
  for (const a of assetRows) assetById.set(a.id, a);

  // cover object_key per asset (cover image, else lowest-id image) for name fallback
  const imagesByAsset = new Map<number, LegacyAssetImageRow[]>();
  for (const img of imageRows) {
    const list = imagesByAsset.get(img.asset_id) ?? [];
    list.push(img);
    imagesByAsset.set(img.asset_id, list);
  }
  function coverObjectKey(asset: LegacyAssetRow): string | null {
    const imgs = imagesByAsset.get(asset.id) ?? [];
    if (imgs.length === 0) return null;
    const cover =
      asset.cover_image_id != null ? imgs.find((i) => i.id === asset.cover_image_id) : undefined;
    const chosen = cover ?? imgs.reduce((lo, i) => (i.id < lo.id ? i : lo));
    return chosen.object_key;
  }

  // ── Map ────────────────────────────────────────────────────────────────────
  const targetAssets = [];
  let droppedContainerAssets = 0;
  for (const a of assetRows) {
    if (MEDIA_CONTAINER_KINDS.has(a.kind)) {
      droppedContainerAssets += 1;
      continue;
    }
    const { asset, anomaly } = mapAsset(a, coverObjectKey(a));
    if (anomaly) anomalies.push(anomaly);
    targetAssets.push(asset);
  }

  const targetMedia = imageRows.map((img) => {
    const parentAsset = assetById.get(img.asset_id);
    const parent = parentAsset
      ? { kind: parentAsset.kind, title: containerTitle(parentAsset.data ?? {}) }
      : undefined;
    return mapMedia(img, parent);
  });
  const standaloneMedia = targetMedia.filter((m) => m.asset_id === null).length;

  const targetItems = [];
  for (const it of itemRows) {
    const { item, anomaly } = mapItem(it);
    if (anomaly) anomalies.push(anomaly);
    targetItems.push(item);
  }

  // Links = legacy link rows ∪ FK-derived links missing from the link table.
  const legacyLinks: TargetLink[] = linkRows.map(mapLink);
  const seen = new Set<string>();
  for (const l of legacyLinks) seen.add(`${l.item_id}|${l.role}|${l.media_id}`);
  const derivedLinks: TargetLink[] = [];
  for (const fk of fkRows) {
    for (const [col, role] of Object.entries(FK_COLUMN_TO_ROLE)) {
      const mediaId = fk[col as keyof LegacyItemFkRow] as number | null;
      if (mediaId == null) continue;
      const key = `${fk.id}|${role}|${mediaId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      anomalies.push({
        type: 'fk_without_link',
        table: 'video_benchmark_items',
        id: fk.id,
        role,
        mediaId,
      });
      derivedLinks.push({
        id: null,
        item_id: fk.id,
        role,
        media_id: mediaId,
        sort_order: 0,
        created_at: fk.created_at,
      });
    }
  }

  const targetComments = commentRows.map(mapComment);

  const difficultyMigrated = await targetHasDifficultyColumn(target);
  if (!difficultyMigrated) {
    const nonEmpty = targetItems.filter((i) => i.difficulty !== '').length;
    notes.push(
      `Target video_benchmark_items has no 'difficulty' column (depends on ben5 migration 0004). ${nonEmpty} item(s) carry a non-empty difficulty that will NOT be migrated until that column lands. Merge the difficulty migration first, then re-run.`,
    );
  }

  const counts: MigrateResult['counts'] = {
    sourceAssets: assetRows.length,
    keptAssets: targetAssets.length,
    droppedContainerAssets,
    media: targetMedia.length,
    standaloneMedia,
    items: targetItems.length,
    legacyLinks: legacyLinks.length,
    derivedLinks: derivedLinks.length,
    comments: targetComments.length,
  };

  if (opts.mode === 'dry-run') {
    return { mode: 'dry-run', difficultyMigrated, counts, anomalies, notes };
  }

  // ── Apply (FK-safe order, two-pass cover) ───────────────────────────────────
  // 1. assets with cover_image_id forced NULL (media not loaded yet)
  await upsert(
    target,
    'assets',
    [
      { name: 'id' },
      { name: 'kind' },
      { name: 'name' },
      { name: 'era' },
      { name: 'genre' },
      { name: 'data', cast: 'jsonb' },
      { name: 'cover_image_id' },
      { name: 'created_at' },
      { name: 'updated_at' },
      { name: 'deleted_at' },
    ],
    ['id'],
    [
      'kind',
      'name',
      'era',
      'genre',
      'data',
      'cover_image_id',
      'created_at',
      'updated_at',
      'deleted_at',
    ],
    targetAssets.map((a) => ({ ...a, cover_image_id: null, data: JSON.stringify(a.data) })),
    chunkSize,
  );

  // 2. media
  await upsert(
    target,
    'media',
    [
      { name: 'id' },
      { name: 'asset_id' },
      { name: 'title' },
      { name: 'object_key' },
      { name: 'source' },
      { name: 'media_type' },
      { name: 'created_at' },
      { name: 'deleted_at' },
    ],
    ['id'],
    ['asset_id', 'title', 'object_key', 'source', 'media_type', 'created_at', 'deleted_at'],
    targetMedia as unknown as Record<string, unknown>[],
    chunkSize,
  );

  // 3. cover pointers now that media exists
  const withCover = targetAssets.filter((a) => a.cover_image_id != null);
  for (let start = 0; start < withCover.length; start += chunkSize) {
    const chunk = withCover.slice(start, start + chunkSize);
    const values: unknown[] = [];
    const tuples = chunk.map((a) => {
      values.push(a.id, a.cover_image_id);
      return `($${values.length - 1}::bigint, $${values.length}::bigint)`;
    });
    await target.query(
      `UPDATE assets AS t SET cover_image_id = v.cover FROM (VALUES ${tuples.join(', ')}) AS v(id, cover) WHERE t.id = v.id`,
      values,
    );
  }

  // 4. items (difficulty only when the target column exists)
  const itemColumns: ColumnSpec[] = [
    { name: 'id' },
    { name: 'shot_type' },
    { name: 'task_type' },
    { name: 'question_type' },
    { name: 'manual_tag' },
    { name: 'scene' },
    { name: 'screen_size' },
    { name: 'text_prompt' },
    { name: 'judging_criteria' },
    { name: 'score' },
    { name: 'needs_revision' },
    { name: 'created_at' },
    { name: 'updated_at' },
    { name: 'deleted_at' },
  ];
  if (difficultyMigrated) itemColumns.push({ name: 'difficulty' });
  await upsert(
    target,
    'video_benchmark_items',
    itemColumns,
    ['id'],
    itemColumns.filter((c) => c.name !== 'id').map((c) => c.name),
    targetItems as unknown as Record<string, unknown>[],
    chunkSize,
  );

  // 5a. legacy links (explicit id)
  await upsert(
    target,
    'video_benchmark_media_links',
    [
      { name: 'id' },
      { name: 'item_id' },
      { name: 'role' },
      { name: 'media_id' },
      { name: 'sort_order' },
      { name: 'created_at' },
    ],
    ['item_id', 'role', 'media_id'],
    ['sort_order', 'created_at'],
    legacyLinks as unknown as Record<string, unknown>[],
    chunkSize,
  );

  // 6. comments
  await upsert(
    target,
    'benchmark_item_comments',
    [
      { name: 'id' },
      { name: 'item_id' },
      { name: 'author' },
      { name: 'body' },
      { name: 'created_at' },
      { name: 'deleted_at' },
    ],
    ['id'],
    ['item_id', 'author', 'body', 'created_at', 'deleted_at'],
    targetComments as unknown as Record<string, unknown>[],
    chunkSize,
  );

  // 7. reset sequences before any serial-default insert
  for (const table of [
    'assets',
    'media',
    'video_benchmark_items',
    'video_benchmark_media_links',
    'benchmark_item_comments',
  ]) {
    await resetSequence(target, table);
  }

  // 5b. FK-derived links (no explicit id → serial assigns, now past the reset sequence)
  await upsert(
    target,
    'video_benchmark_media_links',
    [
      { name: 'item_id' },
      { name: 'role' },
      { name: 'media_id' },
      { name: 'sort_order' },
      { name: 'created_at' },
    ],
    ['item_id', 'role', 'media_id'],
    [],
    derivedLinks.map(({ id: _id, ...rest }) => rest) as unknown as Record<string, unknown>[],
    chunkSize,
  );

  return { mode: 'apply', difficultyMigrated, counts, anomalies, notes };
}

export interface VerifyCheck {
  name: string;
  ok: boolean;
  expected: number;
  actual: number;
}

async function count(client: QueryClient, text: string, params?: unknown[]): Promise<number> {
  const { rows } = await client.query(text, params);
  return Number((rows[0] as { n: string | number } | undefined)?.n ?? 0);
}

// Post-apply reconciliation: re-derive what the source implies and compare to the target.
// Cheap count-based checks, not row-by-row — enough to catch a load that silently dropped
// a table. Mirrors the apply mapping (containers dropped, links unioned with FK-derived).
export async function verify(source: QueryClient, target: QueryClient): Promise<VerifyCheck[]> {
  const checks: VerifyCheck[] = [];
  const add = (name: string, expected: number, actual: number) =>
    checks.push({ name, ok: expected === actual, expected, actual });

  const srcKeptAssets = await count(
    source,
    `SELECT COUNT(*)::int AS n FROM assets WHERE kind NOT IN ('audio', 'video')`,
  );
  add('assets', srcKeptAssets, await count(target, 'SELECT COUNT(*)::int AS n FROM assets'));

  add(
    'media',
    await count(source, 'SELECT COUNT(*)::int AS n FROM asset_images'),
    await count(target, 'SELECT COUNT(*)::int AS n FROM media'),
  );

  add(
    'items',
    await count(source, 'SELECT COUNT(*)::int AS n FROM video_benchmark_items'),
    await count(target, 'SELECT COUNT(*)::int AS n FROM video_benchmark_items'),
  );

  add(
    'comments',
    await count(source, 'SELECT COUNT(*)::int AS n FROM benchmark_item_comments'),
    await count(target, 'SELECT COUNT(*)::int AS n FROM benchmark_item_comments'),
  );

  // Links: legacy link rows ∪ FK-derived links not already represented.
  const srcLinks = await count(
    source,
    `WITH derived AS (
       SELECT id AS item_id, 'character_image' AS role, character_image_id AS media_id FROM video_benchmark_items WHERE character_image_id IS NOT NULL
       UNION ALL SELECT id, 'scene_image', scene_image_id FROM video_benchmark_items WHERE scene_image_id IS NOT NULL
       UNION ALL SELECT id, 'prop_image', prop_image_id FROM video_benchmark_items WHERE prop_image_id IS NOT NULL
       UNION ALL SELECT id, 'audio_input', audio_input_id FROM video_benchmark_items WHERE audio_input_id IS NOT NULL
       UNION ALL SELECT id, 'video_input', video_input_id FROM video_benchmark_items WHERE video_input_id IS NOT NULL
       UNION ALL SELECT id, 'video_output', video_output_id FROM video_benchmark_items WHERE video_output_id IS NOT NULL
     ),
     unioned AS (
       SELECT item_id, role, media_id FROM video_benchmark_media_links
       UNION
       SELECT item_id, role, media_id FROM derived
     )
     SELECT COUNT(*)::int AS n FROM unioned`,
  );
  add(
    'links',
    srcLinks,
    await count(target, 'SELECT COUNT(*)::int AS n FROM video_benchmark_media_links'),
  );

  return checks;
}
