import { createFileRoute } from '@tanstack/react-router';
import { BenchmarkList } from '@/components/benchmark/BenchmarkList';
import { AssetsLayout } from './(assets)/__layout';

export const Route = createFileRoute('/benchmark')({
  component: BenchmarkPage,
});

function BenchmarkPage() {
  // No StatsDashboard sidebar — legacy doesn't have it (BEN-5 round 7 #4).
  return (
    <AssetsLayout>
      <BenchmarkList />
    </AssetsLayout>
  );
}
