import { useEffect, useState } from 'react';
import { LazyImage } from '@/components/asset-library/LazyImage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { type RouterOutputs, trpc } from '@/lib/trpc';

type MediaItem = RouterOutputs['mediaAssets']['list']['items'][number];

export type MediaKind = 'image' | 'audio' | 'video';
type AssetKind = 'character' | 'scene' | 'prop';

export type MediaPickerProps = {
  label: string;
  mediaType: MediaKind;
  assetKind?: AssetKind;
  multi?: boolean;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
};

export function MediaPicker({
  label,
  mediaType,
  assetKind,
  multi = false,
  selectedIds,
  onChange,
}: MediaPickerProps) {
  const [open, setOpen] = useState(false);

  const list = trpc.mediaAssets.list.useInfiniteQuery(
    {
      mediaType,
      ...(assetKind ? { kind: assetKind } : {}),
      dedup: false,
    },
    {
      enabled: open,
      getNextPageParam: (lastPage: { nextCursor: number | null }) =>
        lastPage.nextCursor ?? undefined,
      staleTime: 30 * 60_000,
    },
  );

  const items: MediaItem[] =
    list.data?.pages.flatMap((p: { items: MediaItem[] }) => p.items) ?? [];
  const selected = items.filter((i: MediaItem) => selectedIds.includes(i.id));

  // Reconcile after the drawer opens and the list has loaded — if a previously
  // selected id is no longer present (deleted out-of-band elsewhere), drop it
  // from the picker's selection so we don't keep submitting a stale id.
  // onChange is intentionally omitted from deps: parents inline a fresh closure
  // each render, so depending on it would re-fire the effect and loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see note above
  useEffect(() => {
    if (!open || list.isPending || items.length === 0) return;
    const known = new Set(items.map((i: MediaItem) => i.id));
    const surviving = selectedIds.filter((id) => known.has(id));
    if (surviving.length !== selectedIds.length) onChange(surviving);
  }, [open, list.isPending, items, selectedIds]);

  function toggle(id: number) {
    if (multi) {
      onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
    } else {
      onChange(selectedIds.includes(id) ? [] : [id]);
      setOpen(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          {label}
          {multi ? ' (可多选)' : ''}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          选择 ({selectedIds.length})
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {selected.map((it: MediaItem) => (
          <div key={it.id} className="flex items-center gap-1 rounded border border-[hsl(var(--border))] p-1">
            <LazyImage src={it.url} alt={`media-${it.id}`} className="h-10 w-10 rounded" />
            <button
              type="button"
              className="px-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
              onClick={() => toggle(it.id)}
              aria-label={`移除 media-${it.id}`}
            >
              ×
            </button>
          </div>
        ))}
        {selectedIds
          .filter((id) => !selected.some((s: MediaItem) => s.id === id))
          .map((id) => (
            <Badge key={id} variant="outline">
              #{id}
            </Badge>
          ))}
      </div>

      {open ? (
        <Drawer open onClose={() => setOpen(false)} title={label} widthClassName="w-[640px] max-w-full">
          {list.isPending ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">加载中…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">没有可用的 {mediaType} 媒体。</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {items.map((it: MediaItem) => {
                const active = selectedIds.includes(it.id);
                return (
                  <button
                    key={it.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggle(it.id)}
                    className={`overflow-hidden rounded border text-left ${active ? 'border-[hsl(var(--primary))] ring-2 ring-[hsl(var(--ring))]' : 'border-[hsl(var(--border))]'}`}
                  >
                    <LazyImage src={it.url} alt={`media-${it.id}`} className="aspect-square w-full" />
                    <div className="px-1.5 py-1 text-xs">
                      <div className="truncate">#{it.id}</div>
                      <div className="truncate text-[hsl(var(--muted-foreground))]">{it.source}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {list.hasNextPage ? (
            <div className="mt-3 flex justify-center">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
              >
                {list.isFetchingNextPage ? '加载中…' : '加载更多'}
              </Button>
            </div>
          ) : null}
          <footer className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              完成
            </Button>
          </footer>
        </Drawer>
      ) : null}
    </div>
  );
}
