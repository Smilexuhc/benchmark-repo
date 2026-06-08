import { LazyImage } from '@/components/asset-library/LazyImage';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';

// Legacy SceneViewColumn shape: header "多视角", two side-by-side tiles labelled
// "正反打" and "4视图", each with a 96px-tall preview slot. We keep admin's
// mutation wiring and presigned URL contract.
type Mode = 'reverse' | 'multiview';
const VIEWS: { mode: Mode; label: string }[] = [
  { mode: 'reverse', label: '正反打' },
  { mode: 'multiview', label: '4视图' },
];

export type SceneViewColumnProps = {
  sceneId: number;
  images: { id: number; url: string; source?: string }[];
  // Whether the scene has a base cover image. Without one, reverse/multiview
  // generation has no source to work from — legacy SceneViewColumn:99,111,123
  // disables the buttons and surfaces a hint. We mirror that here so users
  // don't click into a backend error.
  hasCover: boolean;
  onAfter: () => void;
};

export function SceneViewColumn({ sceneId, images, hasCover, onAfter }: SceneViewColumnProps) {
  const generate = trpc.scenes.generateView.useMutation();
  const [busyMode, setBusyMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(mode: Mode) {
    setError(null);
    setBusyMode(mode);
    try {
      await generate.mutateAsync({ id: sceneId, mode });
      onAfter();
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成视角失败');
    } finally {
      setBusyMode(null);
    }
  }

  function imageFor(mode: Mode) {
    return images.find((i) => i.source === mode) ?? null;
  }

  return (
    <section aria-label="多视角" className="space-y-2.5">
      <div className="text-[13px] font-semibold">多视角</div>

      {error ? (
        <p role="alert" className="text-xs text-[hsl(var(--destructive))]">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        {VIEWS.map(({ mode, label }) => {
          const img = imageFor(mode);
          const loading = busyMode === mode;
          return (
            <div key={mode} className="flex flex-col gap-1">
              <div className="text-xs text-[hsl(var(--muted-foreground))]">{label}</div>
              {loading ? (
                <div className="flex h-24 flex-col items-center justify-center rounded bg-[hsl(var(--muted))] text-[10px] text-[hsl(var(--muted-foreground))]">
                  <span
                    role="status"
                    aria-label="生成中"
                    className="mb-1 inline-block h-4 w-4 animate-spin rounded-full border-2 border-[hsl(var(--muted-foreground))] border-t-transparent"
                  />
                  <span>约 2 分钟…</span>
                </div>
              ) : img ? (
                <LazyImage
                  src={img.url}
                  alt={label}
                  className="h-24 w-full rounded bg-[hsl(var(--muted))] object-contain"
                />
              ) : (
                <div className="flex h-24 items-center justify-center rounded bg-[hsl(var(--muted))] text-[11px] text-[hsl(var(--muted-foreground))]">
                  无
                </div>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!hasCover || loading || generate.isPending}
                onClick={() => run(mode)}
                className="h-7 text-xs"
              >
                {img ? '重新生成' : '生成'}
              </Button>
            </div>
          );
        })}
      </div>

      {!hasCover ? (
        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
          需先有场景图，才能生成多视角
        </p>
      ) : null}
    </section>
  );
}
