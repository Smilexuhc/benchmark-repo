import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/benchmark')({
  component: BenchmarkPlaceholder,
});

function BenchmarkPlaceholder() {
  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">视频基准</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        视频基准评测页面将在后续增量（U18）接入。
      </p>
    </section>
  );
}
