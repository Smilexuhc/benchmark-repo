import { type RouterOutputs, trpc } from '@/lib/trpc';

type StatsOut = RouterOutputs['benchmark']['stats'];
type StatsGroup = StatsOut['groups'][number];

export function StatsDashboard() {
  const stats = trpc.benchmark.stats.useQuery();

  if (stats.isPending) {
    return <div className="text-sm text-[hsl(var(--muted-foreground))]">加载统计中…</div>;
  }
  const data = stats.data as StatsOut | undefined;
  if (!data) return null;
  const total = data.groups.reduce((sum: number, g: StatsGroup) => sum + g.count, 0);

  return (
    <section
      aria-label="统计"
      className="space-y-2 rounded-md border border-[hsl(var(--border))] p-3 text-sm"
    >
      <h3 className="text-sm font-semibold">统计</h3>
      <div className="grid grid-cols-3 gap-2 text-xs text-[hsl(var(--muted-foreground))]">
        <div>
          <div className="text-[hsl(var(--foreground))] text-base font-semibold">{total}</div>
          总条数
        </div>
        <div>
          <div className="text-[hsl(var(--foreground))] text-base font-semibold">
            {data.todayNew}
          </div>
          今日新增
        </div>
      </div>
      {data.groups.length === 0 ? (
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
    </section>
  );
}
