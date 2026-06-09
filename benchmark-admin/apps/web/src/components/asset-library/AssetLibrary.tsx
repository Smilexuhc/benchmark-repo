import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { toast } from '@/components/feedback/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc';
import { AssetCard } from './AssetCard';
import type { AssetCardData, AssetCardRenderExtra, AssetCardRenderInfo } from './AssetCard.types';
import { BatchToolbar } from './BatchToolbar';
import { FilterPanel } from './FilterPanel';
import { type AssetKind, buildServerFilters, useFilterFields, useFilters } from './useFilters';

// Vertical list — each row is one full-width AssetCard. Estimate keeps the
// virtualizer's initial scroll height close enough; measured heights adjust on
// mount so the scroll-anchor + load-more wiring keeps working unchanged.
const ROW_ESTIMATE_PX = 232;
const ROW_GAP_PX = 12;
const NEAR_BOTTOM_PX = 360;

const KIND_LABEL: Record<AssetKind, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
};

// Per-kind search placeholders mirror legacy `frontend/src/App.tsx`:
//   character → 搜索人设 / 特征 / 提示词
//   scene     → 搜索场景名 / 关键元素 / 提示词
//   prop      → 搜索名称 / 提示词 / 描述
const SEARCH_PLACEHOLDER: Record<AssetKind, string> = {
  character: '搜索人设 / 特征 / 提示词',
  scene: '搜索场景名 / 关键元素 / 提示词',
  prop: '搜索名称 / 提示词 / 描述',
};

type VRow = { key: React.Key; index: number; start: number };

export type { AssetKind };

export type AssetLibraryProps = {
  kind: AssetKind;
  renderDrawer?: (props: {
    id: number;
    onClose: () => void;
    onCreated: (newId: number) => void;
  }) => React.ReactNode;
  // Per-kind info column override; defaults to the kind-aware renderer in
  // AssetCard.helpers. Pages may pass a custom one for kind-specific layouts.
  renderInfo?: AssetCardRenderInfo;
  // Optional 4th column (scenes use this for the multi-view picker).
  renderExtra?: AssetCardRenderExtra;
};

export function AssetLibrary({ kind, renderDrawer, renderInfo, renderExtra }: AssetLibraryProps) {
  const filterState = useFilters();
  const filterFields = useFilterFields(kind, filterState.deletedOnly);
  const [debouncedSearch] = useDebounce(filterState.search, 300);
  const [drawerId, setDrawerId] = useState<number | 'new' | null>(null);
  const [generatingIds, setGeneratingIds] = useState<Set<number>>(new Set());
  // Batch mode is toggled by the BatchToolbar's "批量生成" button. Selection
  // lives next to it so leaving batch mode resets to a clean slate (handled by
  // the toolbar's exit flow), and the AssetCards see both via props below.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const serverFilters = useMemo(
    () => buildServerFilters(filterState.filters),
    [filterState.filters],
  );

  const list = trpc.assets.list.useInfiniteQuery(
    {
      kind,
      deletedOnly: filterState.deletedOnly,
      search: debouncedSearch || undefined,
      filters: serverFilters,
    },
    {
      getNextPageParam: (lastPage: { nextCursor: number | null }) =>
        lastPage.nextCursor ?? undefined,
      // 1 min — short enough that transient empty/stale responses don't
      // linger; presigned image URLs are valid for ~1h so the re-sign cost
      // when refetching is acceptable.
      staleTime: 60_000,
    },
  );

  const exportUrl = trpc.exports.getDownloadUrl.useQuery({
    kind,
    search: debouncedSearch || undefined,
    deletedOnly: filterState.deletedOnly || undefined,
    filters: serverFilters,
  });

  const setCoverMutation = trpc.assets.setCover.useMutation();
  const generateImageMutation = trpc.ai.generateImage.useMutation();

  const utils = trpc.useUtils();

  function refetch() {
    utils.assets.list.invalidate({ kind });
  }

  function markGenerating(id: number, on: boolean) {
    setGeneratingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleSetCover(assetId: number, imageId: number) {
    try {
      await setCoverMutation.mutateAsync({ id: assetId, imageId });
      toast.success('已设为默认展示图');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '设为默认图失败');
    }
  }

  async function handleRegenerate(asset: AssetCardData) {
    const prompt = asset.data.prompt;
    if (!prompt) {
      toast.warning('还没有提示词,请先点「编辑」生成');
      return;
    }
    markGenerating(asset.id, true);
    try {
      await generateImageMutation.mutateAsync({
        kind: asset.kind,
        id: asset.id,
        prompt,
      });
      toast.success('图片已生成');
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '生成失败');
    } finally {
      markGenerating(asset.id, false);
    }
  }

  function handleDownload(image: { id: number; url: string }) {
    // The presigned URL is the canonical original — open in a new tab so the
    // browser's Save-As / Content-Disposition takes over. Same pattern used by
    // the lightbox's fallback download path (ui/lightbox.tsx:134).
    if (!image.url) {
      toast.error('图片地址无效,稍后重试');
      return;
    }
    window.open(image.url, '_blank', 'noopener,noreferrer');
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const items = (list.data?.pages.flatMap((p: { items: unknown[] }) => p.items) ??
    []) as AssetCardData[];

  // Total count of rows matching the filter, server-side. While the first
  // page is still in flight we surface `null` so the FilterPanel can render
  // "命中 … 个" — flashing "命中 0 个" on slow networks looks like the page
  // hit empty (BEN-5 round 9 user-reported).
  const total: number | null =
    (list.data?.pages[0] as { total?: number } | undefined)?.total ?? null;

  const activeFilterCount = Object.values(filterState.filters).reduce(
    (sum, v) => sum + (Array.isArray(v) ? v.length : 0),
    0,
  );
  const kindLabel = KIND_LABEL[kind];

  return (
    <div className="grid h-full min-h-0 grid-cols-[220px_1fr] gap-4">
      <FilterPanel
        fields={filterFields}
        filters={filterState.filters}
        deletedOnly={filterState.deletedOnly}
        hitCount={total}
        activeFilterCount={activeFilterCount}
        onFilterChange={filterState.setFilter}
        onDeletedOnlyChange={filterState.setDeletedOnly}
        onReset={filterState.reset}
      />

      <div className="flex h-full min-h-0 flex-col">
        <div className="-mx-5 mb-3 flex shrink-0 items-center gap-3 border-b border-[hsl(var(--border))] px-5 py-2.5">
          <div className="flex-1" />
          <Input
            value={filterState.search}
            onChange={(e) => filterState.setSearch(e.target.value)}
            placeholder={SEARCH_PLACEHOLDER[kind]}
            aria-label="搜索"
            className="w-72"
          />
          <BatchToolbar
            kind={kind}
            items={items}
            selectMode={selectMode}
            onEnterSelectMode={() => setSelectMode(true)}
            onExitSelectMode={() => setSelectMode(false)}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            exportHref={exportUrl.data?.url}
            onNewClick={renderDrawer ? () => setDrawerId('new') : undefined}
            newLabel={`新建${kindLabel}`}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {list.isError ? (
            <p role="alert" className="text-sm text-[hsl(var(--destructive))]">
              加载失败：{list.error.message}
            </p>
          ) : null}

          {items.length === 0 && !list.isPending ? (
            <div className="rounded-lg border border-dashed border-[hsl(var(--border))] py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
              暂无结果
            </div>
          ) : (
            <VirtualizedCardList
              items={items}
              selectedIds={selectedIds}
              selectMode={selectMode}
              generatingIds={generatingIds}
              renderInfo={renderInfo}
              renderExtra={renderExtra}
              onEdit={(id) => setDrawerId(id)}
              onToggleSelect={toggleSelect}
              onSetCover={handleSetCover}
              onRegenerate={(asset) => handleRegenerate(asset)}
              onDownload={handleDownload}
              hasNextPage={list.hasNextPage ?? false}
              isFetchingNextPage={list.isFetchingNextPage}
              fetchNextPage={list.fetchNextPage}
            />
          )}
        </div>
      </div>

      {drawerId !== null && renderDrawer ? (
        <DrawerHost
          id={drawerId === 'new' ? 0 : drawerId}
          onClose={() => setDrawerId(null)}
          onCreated={(newId) => {
            // Keep the drawer open after create + flip it to edit mode for the
            // new asset; legacy parity (U6). The drawer's create handler also
            // refreshes the list-cache before calling onCreated.
            refetch();
            setDrawerId(newId);
          }}
          render={renderDrawer}
        />
      ) : null}
    </div>
  );
}

function DrawerHost({
  id,
  onClose,
  onCreated,
  render,
}: {
  id: number;
  onClose: () => void;
  onCreated: (newId: number) => void;
  render: NonNullable<AssetLibraryProps['renderDrawer']>;
}) {
  return <>{render({ id, onClose, onCreated })}</>;
}

type VirtualizedCardListProps = {
  items: AssetCardData[];
  selectedIds: number[];
  selectMode: boolean;
  generatingIds: Set<number>;
  renderInfo?: AssetCardRenderInfo | undefined;
  renderExtra?: AssetCardRenderExtra | undefined;
  onEdit: (id: number) => void;
  onToggleSelect: (id: number) => void;
  onSetCover: (assetId: number, imageId: number) => void;
  onRegenerate: (asset: AssetCardData) => void;
  onDownload: (image: { id: number; url: string }) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
};

function VirtualizedCardList({
  items,
  selectedIds,
  selectMode,
  generatingIds,
  renderInfo,
  renderExtra,
  onEdit,
  onToggleSelect,
  onSetCover,
  onRegenerate,
  onDownload,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: VirtualizedCardListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX + ROW_GAP_PX,
    overscan: 3,
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasNextPage) return;
    function onScroll() {
      if (!el || isFetchingNextPage || !hasNextPage) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) {
        fetchNextPage();
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto pr-1">
      <div
        // biome-ignore lint/a11y/useSemanticElements: virtualizer needs an absolutely-positioned div; role conveys list semantics
        role="list"
        aria-label="资源卡片"
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow: VRow) => {
          const asset = items[virtualRow.index];
          if (!asset) return null;
          return (
            <div
              key={String(virtualRow.key)}
              // biome-ignore lint/a11y/useSemanticElements: virtualizer-positioned div inside a role="list"
              role="listitem"
              className="absolute left-0 right-0"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <AssetCard
                asset={asset}
                selected={selectedIds.includes(asset.id)}
                selectMode={selectMode}
                generating={generatingIds.has(asset.id)}
                renderInfo={renderInfo}
                renderExtra={renderExtra}
                onEdit={onEdit}
                onToggleSelect={onToggleSelect}
                onSetCover={(imageId) => onSetCover(asset.id, imageId)}
                onRegenerate={() => onRegenerate(asset)}
                onDownload={onDownload}
              />
            </div>
          );
        })}
      </div>
      {hasNextPage ? (
        <div className="mt-4 flex justify-center pb-2">
          <Button
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
