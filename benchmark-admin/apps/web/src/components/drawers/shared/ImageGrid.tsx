import { LazyImage } from '@/components/asset-library/LazyImage';
import { confirm } from '@/components/feedback/confirm';
import { Button } from '@/components/ui/button';

export type ImageGridImage = { id: number; url: string; source?: string };

export type ImageGridProps = {
  images: ImageGridImage[];
  coverImageId: number | null;
  onSetCover: (imageId: number) => void;
  onDelete: (imageId: number) => void;
  setCoverBusyId?: number | null;
  deleteBusyId?: number | null;
};

function sourceTagLabel(source: string | undefined): string {
  if (!source) return '';
  if (source === 'generated') return 'AI 生成';
  if (source === 'uploaded') return '上传';
  if (source === 'reverse') return '反向';
  if (source === 'multiview') return '四视图';
  return source;
}

export function ImageGrid({
  images,
  coverImageId,
  onSetCover,
  onDelete,
  setCoverBusyId,
  deleteBusyId,
}: ImageGridProps) {
  if (images.length === 0) {
    return <p className="text-xs text-[hsl(var(--muted-foreground))]">还没有任何图像。</p>;
  }

  async function handleDelete(imageId: number) {
    const ok = await confirm({
      title: '删除图像',
      body: '确定要删除该图像吗？此操作不可撤销。',
      danger: true,
      confirmText: '删除',
    });
    if (ok) onDelete(imageId);
  }

  return (
    <ul className="grid list-none grid-cols-2 gap-2 p-0" aria-label="图像列表">
      {images.map((img) => {
        const isCover = img.id === coverImageId;
        const tag = sourceTagLabel(img.source);
        return (
          <li
            key={img.id}
            className={`overflow-hidden rounded border ${isCover ? 'border-[hsl(var(--primary))]' : 'border-[hsl(var(--border))]'}`}
          >
            <div className="relative">
              <LazyImage
                src={img.url}
                alt={img.source ?? `image-${img.id}`}
                className="aspect-square w-full"
              />
              {tag ? (
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {tag}
                </span>
              ) : null}
              {isCover ? (
                <span className="absolute right-1 top-1 rounded bg-[hsl(var(--primary))] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--primary-foreground))]">
                  当前封面
                </span>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-1 px-1.5 py-1 text-xs">
              {!isCover ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={setCoverBusyId === img.id}
                  onClick={() => onSetCover(img.id)}
                >
                  设为封面
                </Button>
              ) : null}
              <a
                href={img.url}
                download={`image-${img.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center justify-center rounded-md border border-[hsl(var(--border))] bg-transparent px-3 text-xs font-medium hover:bg-[hsl(var(--muted))]"
                aria-label={`下载图像 ${img.id}`}
              >
                下载
              </a>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={deleteBusyId === img.id}
                onClick={() => handleDelete(img.id)}
                aria-label={`删除图像 ${img.id}`}
              >
                删除
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
