import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { LazyImage } from '@/components/asset-library/LazyImage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { useLightbox } from '@/lib/lightbox-context';
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
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search, 300);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const utils = trpc.useUtils();

  const getUploadUrl = trpc.mediaAssets.getUploadUrl.useMutation();
  const createMedia = trpc.mediaAssets.create.useMutation();

  const list = trpc.mediaAssets.list.useInfiniteQuery(
    {
      mediaType,
      ...(assetKind ? { kind: assetKind } : {}),
      search: debouncedSearch || undefined,
      dedup: false,
    },
    {
      enabled: open,
      getNextPageParam: (lastPage: { nextCursor: number | null }) =>
        lastPage.nextCursor ?? undefined,
      staleTime: 30 * 60_000,
    },
  );

  const items: MediaItem[] = list.data?.pages.flatMap((p: { items: MediaItem[] }) => p.items) ?? [];
  // Always fetch full media rows for the selected IDs so we can render
  // thumbnails + filenames OUTSIDE the picker drawer. Without this query the
  // selected strip only had data while `open=true`, so closed pickers fell back
  // to bare `#id` badges.
  const selectedQuery = trpc.mediaAssets.byIds.useQuery(
    { ids: selectedIds },
    { enabled: selectedIds.length > 0, staleTime: 5 * 60_000 },
  );
  const selected: MediaItem[] = (selectedQuery.data ?? []) as MediaItem[];
  const lightbox = useLightbox();

  // Reconcile after the drawer opens and the ENTIRE list has loaded — if a
  // previously selected id is no longer present (deleted out-of-band elsewhere),
  // drop it from the picker's selection so we don't keep submitting a stale id.
  // We only prune once there are no more pages (`hasNextPage` is false): `items`
  // is flatMapped from LOADED pages only, so pruning before the full set is
  // fetched would wrongly drop selections living on an unfetched page.
  // onChange is intentionally omitted from deps: parents inline a fresh closure
  // each render, so depending on it would re-fire the effect and loop.
  // An active search narrows `items` to matching rows only, so a selected id that
  // doesn't match the term would look "missing" and be wrongly pruned. Only
  // reconcile against the UNFILTERED list (no search term).
  // biome-ignore lint/correctness/useExhaustiveDependencies: see note above
  useEffect(() => {
    if (!open || debouncedSearch || list.isPending || list.hasNextPage || items.length === 0)
      return;
    const known = new Set(items.map((i: MediaItem) => i.id));
    const surviving = selectedIds.filter((id) => known.has(id));
    if (surviving.length !== selectedIds.length) onChange(surviving);
  }, [open, debouncedSearch, list.isPending, list.hasNextPage, items, selectedIds]);

  function toggle(id: number) {
    if (multi) {
      onChange(
        selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
      );
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
          const lastId = newIds[newIds.length - 1];
          if (lastId !== undefined) onChange([lastId]);
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
        <div className="text-sm font-medium">{label}</div>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            选择素材
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
      {/* Selected media tiles. Legacy shape (frontend/src/components/BenchmarkItemDrawer.tsx):
          126px-wide tile, 80×52 landscape thumbnail on top, filename below.
          Empty state shows "未选择". Click thumbnail → preview (lightbox /
          new-tab for audio/video). No × button — deselect happens via the
          picker modal (legacy doesn't render one either). */}
      <div className="flex flex-wrap gap-2">
        {selected.length === 0 && selectedIds.length === 0 ? (
          <span className="text-xs text-[hsl(var(--muted-foreground))]">未选择</span>
        ) : null}
        {selected.map((it: MediaItem) => {
          const fileName =
            it.title?.trim() || (it.objectKey?.split('/').pop() ?? `media-${it.id}`);
          const isImage = mediaType === 'image';
          const triggerRef: React.RefObject<HTMLElement | null> = { current: null };
          function preview() {
            if (isImage) {
              lightbox.open({
                images: [{ id: it.id, url: it.url }],
                triggerRef,
              });
            } else {
              // audio / video — open the presigned URL in a new tab; native
              // player handles playback. The lightbox is image-only today.
              window.open(it.url, '_blank', 'noopener,noreferrer');
            }
          }
          return (
            <div key={it.id} className="w-[126px]">
              <button
                type="button"
                ref={(el) => {
                  triggerRef.current = el;
                }}
                onClick={preview}
                aria-label={`预览 ${fileName}`}
                title={fileName}
                className="block h-[52px] w-[80px] overflow-hidden rounded bg-[hsl(var(--muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              >
                {isImage ? (
                  <LazyImage
                    src={it.url}
                    alt={fileName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[11px] text-[hsl(var(--muted-foreground))]">
                    {mediaType === 'audio' ? 'AUDIO' : 'VIDEO'}
                  </span>
                )}
              </button>
              <div
                className="mt-1 truncate text-xs text-[hsl(var(--foreground))]"
                title={fileName}
              >
                {fileName}
              </div>
            </div>
          );
        })}
        {selectedIds
          .filter((id) => !selected.some((s: MediaItem) => s.id === id))
          .map((id) => (
            <Badge key={id} variant="outline">
              #{id}
            </Badge>
          ))}
      </div>

      {open ? (
        <Drawer
          open
          onClose={() => setOpen(false)}
          title={label}
          widthClassName="w-[640px] max-w-full"
        >
          <Input
            aria-label="搜索素材"
            placeholder="搜索标题 / 文件名 / 来源…"
            className="mb-3"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {list.isPending ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">加载中…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              没有可用的 {mediaType} 媒体。
            </p>
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
      <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
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
                    <LazyImage
                      src={it.url}
                      alt={`media-${it.id}`}
                      className="aspect-square w-full"
                    />
                    <div className="px-1.5 py-1 text-xs">
                      <div className="truncate">#{it.id}</div>
                      <div className="truncate text-[hsl(var(--muted-foreground))]">
                        {it.source}
                      </div>
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
