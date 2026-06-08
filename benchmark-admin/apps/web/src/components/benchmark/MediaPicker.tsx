import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { LazyImage } from '@/components/asset-library/LazyImage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useLightbox } from '@/lib/lightbox-context';
import { type RouterOutputs, trpc } from '@/lib/trpc';

type MediaItem = RouterOutputs['mediaAssets']['list']['items'][number];

// Legacy parity (frontend/src/components/BenchmarkItemDrawer.tsx:318-456):
// 920px modal, single-column table with [checkbox][preview thumb][title + meta].
// Each row is a single virtualized row so the height accommodates the 64px
// landscape thumbnail.
const PICKER_ROW_PX = 84;
const PICKER_SCROLL_HEIGHT = 'calc(100vh - 280px)';
const PICKER_NEAR_BOTTOM_PX = 320;

const MEDIA_TYPE_ACCEPT: Record<string, string> = {
  image: 'image/*',
  audio: 'audio/*',
  video: 'video/*',
};

type VRow = { key: string | number; index: number; start: number };

export type MediaKind = 'image' | 'audio' | 'video';
type AssetKind = 'character' | 'scene' | 'prop';

// Filter fields per asset kind. Mirrors legacy
// frontend/src/components/BenchmarkItemDrawer.tsx FILTER_FIELDS_BY_KIND so
// pickers in this app expose the same tag dimensions when creating a question.
// `prop` is intentionally absent — legacy doesn't filter prop in the picker.
type FilterField = {
  key: 'era' | 'genre' | 'type' | 'gender' | 'age' | 'scene_type' | 'mood';
  label: string;
};

const FILTER_FIELDS_BY_KIND: Record<'character' | 'scene', FilterField[]> = {
  character: [
    { key: 'era', label: '时代' },
    { key: 'type', label: '类型' },
    { key: 'gender', label: '性别' },
    { key: 'age', label: '年龄段' },
    { key: 'genre', label: '常见题材' },
  ],
  scene: [
    { key: 'era', label: '时代' },
    { key: 'scene_type', label: '场景类型' },
    { key: 'genre', label: '常见题材' },
    { key: 'mood', label: '氛围时段' },
  ],
};

type FilterState = Partial<Record<FilterField['key'], string>>;

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
  const [filterValues, setFilterValues] = useState<FilterState>({});
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const utils = trpc.useUtils();

  const getUploadUrl = trpc.mediaAssets.getUploadUrl.useMutation();
  const createMedia = trpc.mediaAssets.create.useMutation();

  const filterFields: FilterField[] =
    assetKind === 'character' || assetKind === 'scene' ? FILTER_FIELDS_BY_KIND[assetKind] : [];

  // Distinct filter values per kind. `assets.options` only knows about asset
  // taxonomies; only call it when we actually render filters.
  const optionsQuery = trpc.assets.options.useQuery(
    { kind: (assetKind ?? 'character') as AssetKind, deletedOnly: false },
    { enabled: open && filterFields.length > 0, staleTime: 10 * 60_000 },
  );
  const filterOptions = (optionsQuery.data ?? {}) as Partial<
    Record<FilterField['key'], readonly string[]>
  >;

  // Wrap each single-value selection into a `[v]` array for the backend, which
  // expects arrays (matching `assets.list`'s filter shape).
  const serverFilters = useMemo(() => {
    const out: Partial<Record<FilterField['key'], string[]>> = {};
    for (const f of filterFields) {
      const v = filterValues[f.key];
      if (v) out[f.key] = [v];
    }
    return out;
  }, [filterFields, filterValues]);

  const hasActiveFilter = Object.keys(serverFilters).length > 0;

  const list = trpc.mediaAssets.list.useInfiniteQuery(
    {
      mediaType,
      ...(assetKind ? { kind: assetKind } : {}),
      search: debouncedSearch || undefined,
      ...(hasActiveFilter ? { filters: serverFilters } : {}),
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
  // An active search OR active tag filter narrows `items` to matching rows
  // only, so a selected id that doesn't match would look "missing" and be
  // wrongly pruned. Only reconcile against the UNFILTERED list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see note above
  useEffect(() => {
    if (
      !open ||
      debouncedSearch ||
      hasActiveFilter ||
      list.isPending ||
      list.hasNextPage ||
      items.length === 0
    )
      return;
    const known = new Set(items.map((i: MediaItem) => i.id));
    const surviving = selectedIds.filter((id) => known.has(id));
    if (surviving.length !== selectedIds.length) onChange(surviving);
  }, [
    open,
    debouncedSearch,
    hasActiveFilter,
    list.isPending,
    list.hasNextPage,
    items,
    selectedIds,
  ]);

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
          title={`选择${label}`}
          widthClassName="w-[920px] max-w-full"
        >
          {filterFields.length > 0 ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {filterFields.map((field) => (
                <Select
                  key={field.key}
                  aria-label={field.label}
                  className="h-8 w-[140px] text-xs"
                  value={filterValues[field.key] ?? ''}
                  onChange={(e) =>
                    setFilterValues((prev) => ({
                      ...prev,
                      [field.key]: e.target.value || undefined,
                    }))
                  }
                >
                  <option value="">{field.label}</option>
                  {(filterOptions[field.key] ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </Select>
              ))}
              {hasActiveFilter ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setFilterValues({})}
                >
                  重置筛选
                </Button>
              ) : null}
            </div>
          ) : null}
          <Input
            aria-label="搜索素材"
            placeholder={`搜索${label}`}
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
            <VirtualizedMediaTable
              items={items}
              mediaType={mediaType}
              selectedIds={selectedIds}
              onToggle={toggle}
              hasNextPage={list.hasNextPage ?? false}
              isFetchingNextPage={list.isFetchingNextPage}
              fetchNextPage={list.fetchNextPage}
            />
          )}
          <footer className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              关闭
            </Button>
            <Button type="button" onClick={() => setOpen(false)}>
              完成
            </Button>
          </footer>
        </Drawer>
      ) : null}
    </div>
  );
}

type VirtualizedMediaTableProps = {
  items: MediaItem[];
  mediaType: MediaKind;
  selectedIds: number[];
  onToggle: (id: number) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
};

function filenameOf(item: MediaItem): string {
  return item.title?.trim() || (item.objectKey?.split('/').pop() ?? `media-${item.id}`);
}

// Legacy parity (BenchmarkItemDrawer.tsx:325-334 `mediaMeta`): one line below the
// title combining source · #id · filename — drop the title-derived filename if it
// already equals the title to avoid duplication.
function metaOf(item: MediaItem): string {
  const filename = item.objectKey?.split('/').pop() ?? '';
  const label = filenameOf(item);
  const parts = [item.source, `#${item.id}`];
  if (filename && filename !== label) parts.push(filename);
  return parts.filter(Boolean).join(' · ');
}

function VirtualizedMediaTable({
  items,
  mediaType,
  selectedIds,
  onToggle,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: VirtualizedMediaTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => PICKER_ROW_PX,
    overscan: 6,
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
    <div className="overflow-hidden rounded border border-[hsl(var(--border))]">
      {/* Header row — matches legacy AntD Table columns 预览 / 素材. */}
      <div className="flex items-center gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">
        <span className="w-4" aria-hidden="true" />
        <span className="w-[88px]">预览</span>
        <span className="flex-1">素材</span>
      </div>
      <div ref={scrollRef} className="overflow-auto" style={{ height: PICKER_SCROLL_HEIGHT }}>
        <div
          className="relative w-full"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow: VRow) => {
            const item = items[virtualRow.index];
            if (!item) return null;
            const active = selectedIds.includes(item.id);
            const isImage = mediaType === 'image';
            const label = filenameOf(item);
            return (
              <button
                key={virtualRow.key}
                type="button"
                aria-pressed={active}
                onClick={() => onToggle(item.id)}
                className={`absolute left-0 right-0 flex w-full items-center gap-3 border-b border-[hsl(var(--border))] px-3 text-left transition-colors hover:bg-[hsl(var(--muted))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${active ? 'bg-[hsl(var(--accent))]' : ''}`}
                style={{ transform: `translateY(${virtualRow.start}px)`, height: PICKER_ROW_PX }}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                    active
                      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                      : 'border-[hsl(var(--border))] bg-[hsl(var(--background))]'
                  }`}
                >
                  {active ? '✓' : ''}
                </span>
                <span className="block h-[58px] w-[88px] shrink-0 overflow-hidden rounded bg-[hsl(var(--muted))]">
                  {isImage ? (
                    <LazyImage
                      src={item.url}
                      alt={label}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[11px] text-[hsl(var(--muted-foreground))]">
                      {mediaType === 'audio' ? 'AUDIO' : 'VIDEO'}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                    {label}
                  </span>
                  <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">
                    {metaOf(item)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {hasNextPage ? (
          <div className="flex justify-center py-2">
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
    </div>
  );
}
