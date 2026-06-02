// migration-report.json: the durable record of a run. Always written (success or
// failure) so a human can audit what moved, what fell back to a generated name, and
// what could not be migrated yet (e.g. difficulty before ben5 migration 0004 lands).

import { writeFileSync } from 'node:fs';
import type { Anomaly } from './mappers.ts';
import type { MigrateResult, Mode, VerifyCheck } from './migrate.ts';

export interface MigrationReport {
  startedAt: string;
  finishedAt: string;
  mode: Mode | 'verify';
  ok: boolean;
  difficultyMigrated: boolean;
  categoriesMigrated: boolean;
  counts: MigrateResult['counts'] | null;
  anomalies: Anomaly[];
  anomalySummary: Record<Anomaly['type'], number>;
  notes: string[];
  error: string | null;
  verify?: VerifyResult;
}

export interface VerifyResult {
  ok: boolean;
  checks: VerifyCheck[];
}

function summarize(anomalies: Anomaly[]): Record<Anomaly['type'], number> {
  const summary: Record<Anomaly['type'], number> = {
    name_fallback: 0,
    difficulty_out_of_range: 0,
    fk_without_link: 0,
  };
  for (const a of anomalies) summary[a.type] += 1;
  return summary;
}

export function buildReport(args: {
  startedAt: string;
  mode: Mode | 'verify';
  result: MigrateResult | null;
  error: unknown;
  verify?: VerifyResult;
}): MigrationReport {
  const { startedAt, mode, result, error, verify } = args;
  const anomalies = result?.anomalies ?? [];
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    mode,
    ok: error == null && (verify ? verify.ok : true),
    difficultyMigrated: result?.difficultyMigrated ?? false,
    categoriesMigrated: result?.categoriesMigrated ?? false,
    counts: result?.counts ?? null,
    anomalies,
    anomalySummary: summarize(anomalies),
    notes: result?.notes ?? [],
    error: error == null ? null : error instanceof Error ? error.message : String(error),
    ...(verify ? { verify } : {}),
  };
}

export function writeReport(path: string, report: MigrationReport): void {
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
}
