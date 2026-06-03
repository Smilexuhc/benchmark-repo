import { createFileRoute } from '@tanstack/react-router';
import { BenchmarkList } from '@/components/benchmark/BenchmarkList';
import { StatsDashboard } from '@/components/benchmark/StatsDashboard';
import { AssetsLayout } from './(assets)/__layout';

export const Route = createFileRoute('/benchmark')({
  component: BenchmarkPage,
});

function BenchmarkPage() {
  return (
    <AssetsLayout>
      <div className="grid grid-cols-[1fr_280px] gap-6">
        <BenchmarkList />
        <aside>
          <StatsDashboard />
        </aside>
      </div>
    </AssetsLayout>
  );
}
