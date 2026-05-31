import { useState } from 'react';
import { LazyImage } from '@/components/asset-library/LazyImage';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';

export type SceneViewColumnProps = {
  sceneId: number;
  images: { id: number; url: string; source?: string }[];
  onAfter: () => void;
};

export function SceneViewColumn({ sceneId, images, onAfter }: SceneViewColumnProps) {
  const generate = trpc.scenes.generateView.useMutation();
  const [error, setError] = useState<string | null>(null);

  async function run(mode: 'reverse' | 'multiview') {
    setError(null);
    try {
      await generate.mutateAsync({ id: sceneId, mode });
      onAfter();
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成视角失败');
    }
  }

  const reverseImages = images.filter((i) => i.source === 'reverse');
  const multiviewImages = images.filter((i) => i.source === 'multiview');

  return (
    <section aria-label="场景视角" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">视角生成</h3>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={generate.isPending}
            onClick={() => run('reverse')}
          >
            反向镜头
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={generate.isPending}
            onClick={() => run('multiview')}
          >
            四视图
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-[hsl(var(--destructive))]">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="mb-1 text-[hsl(var(--muted-foreground))]">反向镜头</div>
          {reverseImages.length === 0 ? (
            <p className="text-[hsl(var(--muted-foreground))]">无</p>
          ) : (
            reverseImages.map((img) => (
              <LazyImage
                key={img.id}
                src={img.url}
                alt={`reverse-${img.id}`}
                className="mb-1 aspect-square w-full rounded"
              />
            ))
          )}
        </div>
        <div>
          <div className="mb-1 text-[hsl(var(--muted-foreground))]">四视图</div>
          {multiviewImages.length === 0 ? (
            <p className="text-[hsl(var(--muted-foreground))]">无</p>
          ) : (
            multiviewImages.map((img) => (
              <LazyImage
                key={img.id}
                src={img.url}
                alt={`multiview-${img.id}`}
                className="mb-1 aspect-square w-full rounded"
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
