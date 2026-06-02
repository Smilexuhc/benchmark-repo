// Entry point. Wires real Postgres connections to the pure migrate()/verify() core.
//
// Usage:
//   node --experimental-strip-types src/cli.ts --dry-run   (read + report, no writes)
//   node --experimental-strip-types src/cli.ts --apply     (idempotent load)
//   node --experimental-strip-types src/cli.ts --verify     (count reconciliation only)
//
// Env (see README):
//   LEGACY_DATABASE_URL  source DSN — opened read-only (transaction held READ ONLY)
//   DATABASE_URL         target benchmark-admin DSN
//   TOS_BUCKET           target bucket; must equal LEGACY_TOS_BUCKET (object_keys are
//                        bucket-relative, so the rows only make sense in the same bucket)
//   LEGACY_TOS_BUCKET    source bucket
//   MIGRATION_REPORT_PATH optional output path (default ./migration-report.json)

import { Pool } from 'pg';
import { type MigrateResult, type QueryClient, migrate, verify } from './migrate.ts';
import { type VerifyResult, buildReport, writeReport } from './report.ts';

type Mode = 'dry-run' | 'apply' | 'verify';

function parseMode(argv: string[]): Mode {
  const flags = argv.filter((a) => a.startsWith('--'));
  const modes = flags.filter((f) => f === '--dry-run' || f === '--apply' || f === '--verify');
  if (modes.length !== 1) {
    throw new Error('Specify exactly one of --dry-run | --apply | --verify');
  }
  return modes[0]?.slice(2) as Mode;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`Missing required env var: ${name}`);
  return v;
}

// Wrap a pg Pool as the read-only source: every statement runs inside a single
// READ ONLY transaction so an accidental write to the legacy DB is impossible.
async function withReadOnlySource<T>(dsn: string, fn: (c: QueryClient) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: dsn, max: 4 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const ro: QueryClient = { query: (text, params) => client.query(text, params) };
    const result = await fn(ro);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function withTarget<T>(dsn: string, fn: (c: QueryClient) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: dsn, max: 4 });
  try {
    return await fn({ query: (text, params) => pool.query(text, params) });
  } finally {
    await pool.end();
  }
}

function assertBucketParity(): void {
  const target = requireEnv('TOS_BUCKET');
  const legacy = requireEnv('LEGACY_TOS_BUCKET');
  if (target !== legacy) {
    throw new Error(
      `TOS bucket mismatch: source=${legacy} target=${target}. object_keys are bucket-relative; migrating rows across buckets would leave media pointing at an unreadable bucket. Point both at the same bucket (decision D3) and re-run.`,
    );
  }
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const reportPath = process.env.MIGRATION_REPORT_PATH ?? './migration-report.json';
  const startedAt = new Date().toISOString();

  const legacyDsn = requireEnv('LEGACY_DATABASE_URL');
  const targetDsn = requireEnv('DATABASE_URL');

  let result: MigrateResult | null = null;
  let verifyResult: VerifyResult | undefined;
  let error: unknown = null;

  try {
    if (mode === 'verify') {
      const checks = await withReadOnlySource(legacyDsn, (source) =>
        withTarget(targetDsn, (target) => verify(source, target)),
      );
      verifyResult = { ok: checks.every((c) => c.ok), checks };
    } else {
      assertBucketParity();
      result = await withReadOnlySource(legacyDsn, (source) =>
        withTarget(targetDsn, (target) =>
          migrate(source, target, { mode: mode === 'apply' ? 'apply' : 'dry-run' }),
        ),
      );
    }
  } catch (err) {
    error = err;
  }

  const report = buildReport({
    startedAt,
    mode,
    result,
    error,
    ...(verifyResult ? { verify: verifyResult } : {}),
  });
  writeReport(reportPath, report);

  // Human-readable summary to stderr (the report file is the machine record).
  process.stderr.write(`\n[migrate-from-legacy] mode=${mode} ok=${report.ok}\n`);
  if (report.counts) {
    process.stderr.write(`  counts: ${JSON.stringify(report.counts)}\n`);
  }
  if (verifyResult) {
    for (const c of verifyResult.checks) {
      process.stderr.write(
        `  ${c.ok ? 'OK ' : 'BAD'} ${c.name}: expected=${c.expected} actual=${c.actual}\n`,
      );
    }
  }
  for (const note of report.notes) process.stderr.write(`  note: ${note}\n`);
  if (report.anomalies.length > 0) {
    process.stderr.write(`  anomalies: ${JSON.stringify(report.anomalySummary)}\n`);
  }
  process.stderr.write(`  report written to ${reportPath}\n`);
  if (error) process.stderr.write(`  error: ${report.error}\n`);

  process.exit(report.ok ? 0 : 1);
}

main();
