import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/(assets)/characters')({
  component: CharactersPlaceholder,
});

function CharactersPlaceholder() {
  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">角色</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        角色资源库将在后续增量（U16/U17）接入。
      </p>
    </section>
  );
}
