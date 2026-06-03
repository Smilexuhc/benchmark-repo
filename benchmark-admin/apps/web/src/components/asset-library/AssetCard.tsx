import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/feedback/toast';
import { useLightbox } from '@/lib/lightbox-context';
import { cn } from '@/lib/utils';
import { LazyImage } from './LazyImage';
import { renderInfoForKind } from './AssetCard.helpers';
import type { AssetCardData, AssetCardRenderExtra, AssetCardRenderInfo } from './AssetCard.types';

// Re-exported so existing consumers (BatchToolbar, AssetLibrary tests) that
// import `AssetCardData` from `./AssetCard` keep compiling after the U5 type
// split into AssetCard.types.
export type { AssetCardData } from './AssetCard.types';

export type AssetCardProps = {
  asset: AssetCardData;
  onEdit: (id: number) => void;
  onSetCover: (imageId: number) => void | Promise<void>;
  onRegenerate: (id: number) => void | Promise<void>;
  onDownload: (image: { id: number; url: string }) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: ((id: number) => void) | undefined;
  generating?: boolean;
  renderInfo?: AssetCardRenderInfo | undefined;
  renderExtra?: AssetCardRenderExtra | undefined;
};

function promptOf(asset: AssetCardData): string {
  // `prompt` lives inside the JSONB `data` per kind. Centralized here so the
  // card body and the Copy button agree on what "the prompt" is.
  return asset.data.prompt ?? '';
}

export function AssetCard({
  asset,
  onEdit,
  onSetCover,
  onRegenerate,
  onDownload,
  selectMode = false,
  selected = false,
  onToggleSelect,
  generating = false,
  renderInfo,
  renderExtra,
}: AssetCardProps) {
  const lightbox = useLightbox();
  const imageColRef = useRef<HTMLDivElement>(null);

  const prompt = promptOf(asset);
  const isDeleted = !!asset.deletedAt;
  const cover =
    asset.images.find((img) => img.id === asset.coverImageId) ?? asset.images[0] ?? null;
  const coverIdx = cover ? asset.images.findIndex((img) => img.id === cover.id) : 0;
  const lightboxImages = asset.images.map((img) => ({
    id: img.id,
    url: img.url,
    isCover: img.id === asset.coverImageId,
  }));

  function copyPrompt() {
    if (!prompt) return;
    navigator.clipboard.writeText(prompt);
    toast.success('提示词已复制');
  }

  function openLightbox() {
    if (lightboxImages.length === 0) return;
    lightbox.open({
      images: lightboxImages,
      initialIndex: Math.max(0, coverIdx),
      onSetCover: (imageId) => {
        // imageId arrives as LightboxImageId (string|number); list payload only
        // produces numeric ids, so a non-number here is a contract bug — fall
        // through and let the mutation surface it rather than swallowing it.
        if (typeof imageId === 'number') onSetCover(imageId);
      },
      onDownload: (image) => {
        if (typeof image.id === 'number') onDownload({ id: image.id, url: image.url });
      },
      triggerRef: imageColRef,
    });
  }

  return (
    <div
      className={cn(
        'relative flex min-h-[220px] overflow-hidden rounded-md border bg-[hsl(var(--background))]',
        selected ? 'border-[hsl(var(--ring))]' : 'border-[hsl(var(--border))]',
        isDeleted && 'opacity-60',
      )}
    >
      {isDeleted ? (
        <span className="pointer-events-none absolute right-2 top-2 z-10 rounded bg-[hsl(var(--destructive))] px-2 py-0.5 text-[11px] text-[hsl(var(--destructive-foreground))]">
          已删除
        </span>
      ) : null}

      {selectMode ? (
        <button
          type="button"
          onClick={() => onToggleSelect?.(asset.id)}
          aria-pressed={selected}
          aria-label={selected ? '取消选中' : '选中'}
          className={cn(
            'flex w-11 shrink-0 items-center justify-center border-r border-[hsl(var(--border))]',
            selected ? 'bg-[hsl(var(--muted))]' : 'bg-[hsl(var(--background))]',
          )}
        >
          <span
            className={cn(
              'inline-flex h-4 w-4 items-center justify-center rounded border',
              selected
                ? 'border-[hsl(var(--ring))] bg-[hsl(var(--ring))] text-[hsl(var(--primary-foreground))]'
                : 'border-[hsl(var(--border))]',
            )}
            aria-hidden="true"
          >
            {selected ? '✓' : ''}
          </span>
        </button>
      ) : null}

      <div className="flex w-[210px] shrink-0 flex-col border-r border-[hsl(var(--border))] p-4">
        <div className="flex-1">{(renderInfo ?? renderInfoForKind)(asset)}</div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onEdit(asset.id)}
          className="mt-3 self-start"
        >
          编辑
        </Button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col border-r border-[hsl(var(--border))] p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold">提示词</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!prompt}
            onClick={copyPrompt}
            className="h-auto px-1 py-0 text-xs"
          >
            复制
          </Button>
        </div>
        {prompt ? (
          <div className="prompt-box max-h-[168px] flex-1">{prompt}</div>
        ) : (
          <div className="pt-2 text-xs text-[hsl(var(--muted-foreground))]">
            暂无提示词,点「编辑」生成
          </div>
        )}
      </div>

      <div
        ref={imageColRef}
        className="flex w-[380px] shrink-0 flex-col items-center justify-center bg-[hsl(var(--muted))] p-3"
      >
        {generating ? (
          <div className="flex flex-col items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
            <span
              role="status"
              aria-label="生成中"
              className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[hsl(var(--muted-foreground))] border-t-transparent"
            />
            <span>生成中,约 1 分钟…</span>
          </div>
        ) : cover ? (
          <>
            <button
              type="button"
              onClick={openLightbox}
              aria-label="查看大图"
              className="block max-h-[196px] w-full focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
            >
              <LazyImage
                src={cover.url}
                alt={asset.name || '资产图片'}
                className="mx-auto max-h-[196px] w-auto rounded"
              />
            </button>
            <div className="mt-1.5 flex items-center gap-3 text-xs">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onRegenerate(asset.id)}
                className="h-auto p-0 text-xs"
              >
                重新生成
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onDownload({ id: cover.id, url: cover.url })}
                className="h-auto p-0 text-xs"
              >
                下载原图
              </Button>
              {asset.images.length > 1 ? (
                <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  共 {asset.images.length} 张 · 点图放大左右翻看
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center text-xs text-[hsl(var(--muted-foreground))]">
            <span>暂无图片</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onRegenerate(asset.id)}
            >
              生成图片
            </Button>
          </div>
        )}
      </div>

      {renderExtra ? (
        <div className="w-[212px] shrink-0 border-l border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3">
          {renderExtra(asset)}
        </div>
      ) : null}
    </div>
  );
}
