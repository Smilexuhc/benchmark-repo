import { createFileRoute } from '@tanstack/react-router';
import { trpc } from '../lib/trpc.js';

function Home() {
  const health = trpc.health.useQuery();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Benchmark Admin</h1>
      {health.data && (
        <p className="mt-2 text-sm text-gray-500">Server time: {health.data.ts.toISOString()}</p>
      )}
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: Home,
});
