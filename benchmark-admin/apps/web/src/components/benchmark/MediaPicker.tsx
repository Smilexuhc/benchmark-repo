import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import { LazyImage } from '@/components/asset-library/LazyImage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { type RouterOutputs, trpc } from '@/lib/trpc';

type MediaItem = RouterOutputs['mediaAssets']['list']['items'][number];

const PICKER_COLS = 3;
const PICKER_ROW_PX = 160;
const PICKER_SCROLL_HEIGHT = 'calc(100vh - 260px)';
const PICKER_NEAR_BOTTOM_PX = 320;

const MEDIA_TYPE_ACCEPT: Record<string, string> = {
  image: 'image/*',
  audio: 'audio/*',
  video: 'video/*',
};

type VRow = { key: string | number; index: number; start: number };

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
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const utils = trpc.useUtils();

  const getUploadUrl = trpc.mediaAssets.getUploadUrl.useMutation();
  const createMedia = trpc.mediaAssets.create.useMutation();

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

  // Reconcile after the drawer opens and the ENTIRE list has loaded — if a
  // previously selected id is no longer present (deleted out-of-band elsewhere),
  // drop it from the picker's selection so we don't keep submitting a stale id.
  // We only prune once there are no more pages (`hasNextPage` is false): `items`
  // is flatMapped from LOADED pages only, so pruning before the full set is
  // fetched would wrongly drop selections living on an unfetched page.
  // onChange is intentionally omitted from deps: parents inline a fresh closure
  // each render, so depending on it would re-fire the effect and loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see note above
  useEffect(() => {
    if (!open || list.isPending || list.hasNextPage || items.length === 0) return;
    const known = new Set(items.map((i: MediaItem) => i.id));
    const surviving = selectedIds.filter((id) => known.has(id));
    if (surviving.length !== selectedIds.length) onChange(surviving);
  }, [open, list.isPending, list.hasNextPage, items, selectedIds]);

  function toggle(id: number) {
    if (multi) {
      onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
    } else {
      onChange(selectedIds.includes(id) ? [] : [id]);
      setOpen(false);
    }
  }

  async function handleUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    const newIds: number[] = [];
    try {
      for (const file of Array.from(files)) {
        const { uploadUrl, objectKey } = await getUploadUrl.mutateAsync({
          mediaType,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
        });
        await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
        const created = await createMedia.mutateAsync({
          objectKey,
          mediaType,
          assetKind: assetKind ?? 'character',
          filename: file.name,
        });
        newIds.push(created.id);
      }
      await utils.mediaAssets.list.invalidate();
      if (newIds.length > 0) {
        if (multi) {
          onChange([...selectedIds, ...newIds]);
        } else {
          onChange([newIds[newIds.length - 1]!]);
        }
      }
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          {label}
          {multi ? ' (可多选)' : ''}
        </div>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            选择素材 ({selectedIds.length})
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => uploadInputRef.current?.click()}
          >
            {uploading ? '上传中…' : '上传素材'}
          </Button>
          <input
            ref={uploadInputRef}
            type="file"
            className="hidden"
            accept={MEDIA_TYPE_ACCEPT[mediaType]}
            multiple={multi}
            onChange={(e) => handleUploadFiles(e.target.files)}
          />
        </div>
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
            <VirtualizedMediaGrid
              items={items}
              selectedIds={selectedIds}
              onToggle={toggle}
              hasNextPage={list.hasNextPage ?? false}
              isFetchingNextPage={list.isFetchingNextPage}
              fetchNextPage={list.fetchNextPage}
            />
          )}
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

type VirtualizedMediaGridProps = {
  items: MediaItem[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
};

function VirtualizedMediaGrid({
  items,
  selectedIds,
  onToggle,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: VirtualizedMediaGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowCount = Math.ceil(items.length / PICKER_COLS);

  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => PICKER_ROW_PX,
    overscan: 3,
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasNextPage) return;
    function onScroll() {
      if (!el || isFetchingNextPage || !hasNextPage) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < PICKER_NEAR_BOTTOM_PX) {
        fetchNextPage();
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div ref={scrollRef} className="overflow-auto" style={{ height: PICKER_SCROLL_HEIGHT }}>
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow: VRow) => {
          const start = virtualRow.index * PICKER_COLS;
          const rowItems = items.slice(start, start + PICKER_COLS);
          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 right-0 grid grid-cols-3 gap-2"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {rowItems.map((it) => {
                const active = selectedIds.includes(it.id);
                return (
                  <button
                    key={it.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onToggle(it.id)}
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
          );
        })}
      </div>
      {hasNextPage ? (
        <div className="mt-3 flex justify-center pb-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? '加载中…' : '加载更多'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
