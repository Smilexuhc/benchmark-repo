import { useState } from 'react';
import { type RouterOutputs, trpc } from '@/lib/trpc';

type StatsOut = RouterOutputs['benchmark']['stats'];
type StatsGroup = StatsOut['groups'][number];

// The card collapses by default so the reviewer drops straight into the list;
// click the chevron header to expand for the per-category breakdown.
export function StatsDashboard() {
  const [expanded, setExpanded] = useState(false);
  const stats = trpc.benchmark.stats.useQuery();

  const data = stats.data as StatsOut | undefined;
  const total = data?.groups.reduce((sum: number, g: StatsGroup) => sum + g.count, 0) ?? 0;

  return (
    <section aria-label="统计" className="rounded-md border border-[hsl(var(--border))] text-sm">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="stats-body"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden className="text-xs">
            {expanded ? '▾' : '▸'}
          </span>
          <span className="font-semibold">统计</span>
        </span>
        {stats.isPending ? (
          <span className="text-xs text-[hsl(var(--muted-foreground))]">加载中…</span>
        ) : data ? (
          <span className="flex gap-3 text-xs text-[hsl(var(--muted-foreground))]">
            <span>
              总条数 <strong className="text-[hsl(var(--foreground))]">{total}</strong>
            </span>
            <span>
              今日新增 <strong className="text-[hsl(var(--foreground))]">{data.todayNew}</strong>
            </span>
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div id="stats-body" className="border-t border-[hsl(var(--border))] p-3">
          {stats.isPending ? (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">加载统计中…</p>
          ) : !data || data.groups.length === 0 ? (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">暂无分组数据。</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th className="py-1">一级分类</th>
                  <th className="py-1">二级分类</th>
                  <th className="py-1">三级分类</th>
                  <th className="py-1 text-right">数量</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g: StatsGroup) => (
                  <tr
                    key={`${g.categoryL1}|${g.categoryL2}|${g.categoryL3}`}
                    className="border-t border-[hsl(var(--border))]"
                  >
                    <td className="py-1">{g.categoryL1 || '—'}</td>
                    <td className="py-1">{g.categoryL2 || '—'}</td>
                    <td className="py-1">{g.categoryL3 || '—'}</td>
                    <td className="py-1 text-right">{g.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </section>
  );
}
