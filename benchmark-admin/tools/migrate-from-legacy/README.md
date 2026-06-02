# migrate-from-legacy

One-shot, **idempotent** data migration from the legacy benchmark Postgres
(`backend/`, Python/FastAPI) into the benchmark-admin schema (Drizzle/Neon).
Migrates DB rows only — media bytes are left in place because both stacks point
at the **same TOS bucket** and `object_key` values are bucket-relative.

## What it does

- Preserves legacy primary keys (no ID remap), so every cross-table reference
  stays valid by reusing source ids.
- Every write is an upsert (`ON CONFLICT … DO UPDATE`); re-running converges to
  the same state instead of duplicating or erroring.
- Resets each table's id sequence to `MAX(id)` after the explicit-id load.
- Breaks the `assets ↔ media` circular FK with a two-pass cover write.
- Opens the source inside a `READ ONLY` transaction — it cannot write the legacy DB.
- Always writes `migration-report.json` (success or failure) with counts,
  anomalies, and notes.

### Mapping rules

| Legacy | Target | Notes |
|---|---|---|
| `assets` kind `character`/`scene`/`prop` | `assets` | `name` promoted from `data.title ?? data.persona ?? data.name ?? cover basename ?? untitled-<id>`; `era`/`genre` promoted out of `data` |
| `assets` kind `audio`/`video` | *(dropped)* | synthetic upload containers — their files become standalone media |
| `asset_images` | `media` | files under an audio/video container become standalone (`asset_id` NULL, `title` = container title) |
| `video_benchmark_items` | `video_benchmark_items` | `difficulty` migrated **only if the target column exists** (see below) |
| `video_benchmark_media_links` ∪ item FK columns | `video_benchmark_media_links` | items created before the legacy links table carry media refs in FK columns with no link row; these are unioned in (loss-free) and flagged |
| `benchmark_item_comments` | `benchmark_item_comments` | |

### Anomalies (flagged in the report, never fatal)

- `name_fallback` — an asset had no usable name in `data.*`; a basename or
  `untitled-<id>` was generated. Set a real name post-migration.
- `difficulty_out_of_range` — item difficulty outside `'' | 易 | 中 | 难`.
- `fk_without_link` — a media reference recovered from a legacy item FK column
  that had no matching link row.

## Usage

```bash
# from benchmark-admin/
LEGACY_DATABASE_URL=postgres://…  DATABASE_URL=postgres://…  \
LEGACY_TOS_BUCKET=mybucket  TOS_BUCKET=mybucket  \
  pnpm --filter @benchmark-admin/migrate-from-legacy migrate:legacy --dry-run
```

Modes (exactly one required):

- `--dry-run` — read source, compute everything, write the report. **No writes.**
- `--apply` — perform the idempotent load.
- `--verify` — count-based reconciliation of source vs target (no writes).

Exit code is `0` when `ok`, `1` otherwise. The report path defaults to
`./migration-report.json` (override with `MIGRATION_REPORT_PATH`).

### Environment

| Var | Required | Purpose |
|---|---|---|
| `LEGACY_DATABASE_URL` | yes | source DSN, opened read-only |
| `DATABASE_URL` | yes | target benchmark-admin DSN |
| `TOS_BUCKET` | apply/dry-run | target bucket |
| `LEGACY_TOS_BUCKET` | apply/dry-run | source bucket; must equal `TOS_BUCKET` |
| `MIGRATION_REPORT_PATH` | no | report output path |

## Recommended sequence

```bash
… migrate:legacy --dry-run   # inspect counts + anomalies in the report
… migrate:legacy --apply     # idempotent — safe to re-run
… migrate:legacy --verify    # confirm source/target parity
```

## ⚠️ Difficulty column coordination

The `difficulty` column on `video_benchmark_items` is added by **ben5 migration
0004** (branch `ben5-benchmark-ux-parity`), not by this tool. The tool detects
the column at runtime:

- column present → `difficulty` is migrated.
- column absent → `difficulty` is skipped and the report carries a note with the
  count of items whose non-empty difficulty was not migrated.

So `--apply` is safe to run before *or* after migration 0004 merges. If you run
it first, merge 0004 and re-run `--apply` — the upsert backfills `difficulty`
without touching anything else.
