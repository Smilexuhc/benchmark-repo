import { Button } from '@/components/ui/button';
import { LazyImage } from '@/components/asset-library/LazyImage';

export type ImageGridImage = { id: number; url: string; source?: string };

export type ImageGridProps = {
  images: ImageGridImage[];
  coverImageId: number | null;
  onSetCover: (imageId: number) => void;
  onDelete: (imageId: number) => void;
  setCoverBusyId?: number | null;
  deleteBusyId?: number | null;
};

export function ImageGrid({
  images,
  coverImageId,
  onSetCover,
  onDelete,
  setCoverBusyId,
  deleteBusyId,
}: ImageGridProps) {
  if (images.length === 0) {
    return (
      <p className="text-xs text-[hsl(var(--muted-foreground))]">还没有任何图像。</p>
    );
  }

  return (
    <ul
      className="grid list-none grid-cols-2 gap-2 p-0"
      aria-label="图像列表"
    >
      {images.map((img) => {
        const isCover = img.id === coverImageId;
        return (
          <li
            key={img.id}
            className={`overflow-hidden rounded border ${isCover ? 'border-[hsl(var(--primary))]' : 'border-[hsl(var(--border))]'}`}
          >
            <LazyImage src={img.url} alt={img.source ?? `image-${img.id}`} className="aspect-square w-full" />
            <div className="flex items-center justify-between gap-1 px-1.5 py-1 text-xs">
              <span className="truncate text-[hsl(var(--muted-foreground))]">
                {img.source ?? ''}
              </span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={isCover ? 'default' : 'outline'}
                  disabled={isCover || setCoverBusyId === img.id}
                  onClick={() => onSetCover(img.id)}
                >
                  {isCover ? '封面' : '设为封面'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={deleteBusyId === img.id}
                  onClick={() => onDelete(img.id)}
                  aria-label={`删除图像 ${img.id}`}
                >
                  删
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
