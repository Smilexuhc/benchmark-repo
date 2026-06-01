import { createFileRoute } from '@tanstack/react-router';
import { BenchmarkList } from '@/components/benchmark/BenchmarkList';
import { StatsDashboard } from '@/components/benchmark/StatsDashboard';

export const Route = createFileRoute('/benchmark')({
  component: BenchmarkPage,
});

function BenchmarkPage() {
  return (
    <section className="grid grid-cols-[1fr_280px] gap-6">
      <div>
        <h1 className="mb-4 text-xl font-semibold tracking-tight">视频基准</h1>
        <BenchmarkList />
      </div>
      <aside>
        <StatsDashboard />
      </aside>
    </section>
  );
}
