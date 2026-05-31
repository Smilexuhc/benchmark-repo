import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/(assets)/scenes')({
  component: ScenesPlaceholder,
});

function ScenesPlaceholder() {
  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">场景</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        场景资源库将在后续增量（U16/U17）接入。
      </p>
    </section>
  );
}
