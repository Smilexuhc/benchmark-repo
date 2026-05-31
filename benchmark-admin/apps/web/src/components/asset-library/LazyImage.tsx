import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export type LazyImageProps = {
  src: string | null | undefined;
  alt: string;
  className?: string;
};

export function LazyImage({ src, alt, className }: LazyImageProps) {
  const [errored, setErrored] = useState(false);

  // Reset the error latch when src changes; otherwise a transient/expired-URL
  // failure pins "无图" forever even after a refetch hands us a fresh URL.
  // biome-ignore lint/correctness/useExhaustiveDependencies: src is the trigger
  useEffect(() => {
    setErrored(false);
  }, [src]);

  if (!src || errored) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={cn(
          'flex items-center justify-center bg-[hsl(var(--muted))] text-xs text-[hsl(var(--muted-foreground))]',
          className,
        )}
      >
        无图
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn('object-cover', className)}
      onError={() => setErrored(true)}
    />
  );
}
