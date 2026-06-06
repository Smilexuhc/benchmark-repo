import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { type ChangeEvent, useRef } from 'react';
import { MAX_REF_IMAGES, type RefImage } from './types';

type Props = {
  value: RefImage[];
  onAdd: (file: File) => void;
  onRemove: (localId: string) => void;
  disabled?: boolean;
};

// Reference-image strip used at the top of the playground. Thumbnails of any
// added images (uploading / uploaded / failed) followed by a dashed upload
// slot for "click to add more images". Cap is MAX_REF_IMAGES.
export function RefImageList({ value, onAdd, onRemove, disabled }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const full = value.length >= MAX_REF_IMAGES;

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onAdd(file);
    e.target.value = '';
  }

  return (
    <div>
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 md:grid-cols-6">
        {value.map((ref) => (
          <div
            key={ref.localId}
            className={cn(
              'group relative aspect-square overflow-hidden rounded-md border',
              ref.status === 'failed'
                ? 'border-[hsl(var(--destructive))]'
                : 'border-[hsl(var(--border))]',
            )}
          >
            <img
              src={ref.previewUrl}
              alt=""
              className={cn(
                'h-full w-full object-cover',
                ref.status !== 'uploaded' && 'opacity-50',
              )}
            />
            {ref.status === 'uploading' ? (
              <div
                aria-label="上传中"
                className="absolute inset-0 flex items-center justify-center bg-black/30 text-[10px] text-white"
              >
                上传中…
              </div>
            ) : null}
            {ref.status === 'failed' ? (
              <div
                role="alert"
                className="absolute inset-0 flex items-center justify-center bg-black/30 px-1 text-center text-[10px] text-white"
              >
                上传失败
              </div>
            ) : null}
            <button
              type="button"
              aria-label="移除参考图"
              className="absolute top-1 right-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white group-hover:flex"
              onClick={() => onRemove(ref.localId)}
              disabled={disabled}
            >
              ×
            </button>
          </div>
        ))}
        {!full ? (
          <Button
            type="button"
            variant="outline"
            className={cn(
              'flex aspect-square h-auto w-full flex-col items-center justify-center gap-1 border-dashed text-xs text-[hsl(var(--muted-foreground))]',
            )}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            aria-label="添加参考图"
          >
            <span className="text-2xl leading-none">↑</span>
            <span>点击添加图像</span>
          </Button>
        ) : null}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
        ✦ 上传图像进行编辑或输入指令以生成新图像。最多 {MAX_REF_IMAGES} 张参考图。
      </p>
    </div>
  );
}
