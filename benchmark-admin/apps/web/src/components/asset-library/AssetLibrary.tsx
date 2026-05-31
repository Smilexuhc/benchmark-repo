import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { AssetCard, type AssetCardData } from './AssetCard';
import { type FilterField, FilterPanel } from './FilterPanel';
import { buildServerFilters, useFilters } from './useFilters';

// Card aspect-ratio (square image) + name/meta + gap; tune-by-eye is fine —
// the virtualizer uses this as an estimate and adapts to measured heights.
const ROW_ESTIMATE_PX = 280;
const ROW_GAP_PX = 12;
const SCROLL_HEIGHT = 'calc(100vh - 220px)';
const NEAR_BOTTOM_PX = 360;

// @tanstack/react-virtual re-exports `VirtualItem` via `export *`, which our
// `verbatimModuleSyntax` setup doesn't surface for direct import. Mirror the
// fields we actually read so the `.map(...)` callback has a real param type.
type VRow = { key: string | number; index: number; start: number };

// Tailwind grid-cols breakpoints used in the markup: default 2, sm:3, lg:4.
// Match here so the virtualizer slices items into the right per-row count.
function useResponsiveColumnCount(ref: React.RefObject<HTMLElement | null>) {
  const [cols, setCols] = useState(4);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    function update() {
      const width = el?.clientWidth ?? 0;
      setCols(width >= 768 ? 4 : width >= 560 ? 3 : 2);
    }
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}

export type AssetKind = 'character' | 'scene' | 'prop';

export type AssetLibraryProps = {
  kind: AssetKind;
  filterFields: FilterField[];
  renderDrawer?: (props: { id: number; onClose: () => void; onCreated: () => void }) => React.ReactNode;
  selectionMode?: 'none' | 'multi';
  selectedIds?: number[];
  onSelectionChange?: (ids: number[]) => void;
  headerActions?: React.ReactNode;
};

export function AssetLibrary({
  kind,
  filterFields,
  renderDrawer,
  selectionMode = 'none',
  selectedIds = [],
  onSelectionChange,
  headerActions,
}: AssetLibraryProps) {
  const filterState = useFilters();
  const [debouncedSearch] = useDebounce(filterState.search, 300);
  const [drawerId, setDrawerId] = useState<number | 'new' | null>(null);

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
      // Server returns null when there is no next page.
      getNextPageParam: (lastPage: { nextCursor: number | null }) =>
        lastPage.nextCursor ?? undefined,
      // Presigned URLs are valid for ~1h (storage.getPresignedUrl default).
      // 30 min staleTime stops every refetch from re-signing the entire list
      // and re-downloading every cached image (P1: presigned URL cache busting).
      staleTime: 30 * 60_000,
    },
  );

  const utils = trpc.useUtils();

  function refetch() {
    utils.assets.list.invalidate({ kind });
  }

  function onCardClick(id: number) {
    if (selectionMode === 'multi' && onSelectionChange) {
      const has = selectedIds.includes(id);
      onSelectionChange(has ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
      return;
    }
    setDrawerId(id);
  }

  const items: AssetCardData[] =
    list.data?.pages.flatMap((p: { items: AssetCardData[] }) => p.items) ?? [];

  return (
    <div className="grid grid-cols-[240px_1fr] gap-6">
      <FilterPanel
        fields={filterFields}
        filters={filterState.filters}
        search={filterState.search}
        deletedOnly={filterState.deletedOnly}
        onFilterChange={filterState.setFilter}
        onSearchChange={filterState.setSearch}
        onDeletedOnlyChange={filterState.setDeletedOnly}
        onReset={filterState.reset}
      />

      <div>
        <header className="mb-4 flex items-center justify-between">
          <div className="text-sm text-[hsl(var(--muted-foreground))]">
            共 {items.length} 条{list.isFetching ? '（加载中…）' : ''}
          </div>
          <div className="flex items-center gap-2">
            {headerActions}
            {renderDrawer ? (
              <Button size="sm" onClick={() => setDrawerId('new')}>
                新建
              </Button>
            ) : null}
          </div>
        </header>

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
          <VirtualizedCardGrid
            items={items}
            selectedIds={selectedIds}
            onCardClick={onCardClick}
            hasNextPage={list.hasNextPage ?? false}
            isFetchingNextPage={list.isFetchingNextPage}
            fetchNextPage={list.fetchNextPage}
          />
        )}
      </div>

      {drawerId !== null && renderDrawer ? (
        <DrawerHost
          id={drawerId === 'new' ? 0 : drawerId}
          onClose={() => setDrawerId(null)}
          onCreated={() => {
            refetch();
            setDrawerId(null);
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
  onCreated: () => void;
  render: NonNullable<AssetLibraryProps['renderDrawer']>;
}) {
  return <>{render({ id, onClose, onCreated })}</>;
}

type VirtualizedCardGridProps = {
  items: AssetCardData[];
  selectedIds: number[];
  onCardClick: (id: number) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
};

function VirtualizedCardGrid({
  items,
  selectedIds,
  onCardClick,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: VirtualizedCardGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cols = useResponsiveColumnCount(scrollRef);
  const rowCount = Math.ceil(items.length / cols);

  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX + ROW_GAP_PX,
    overscan: 3,
  });

  // Auto-fetch next page as the user nears the bottom of the scroll container.
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
    <div ref={scrollRef} className="overflow-auto pr-1" style={{ height: SCROLL_HEIGHT }}>
      <div
        role="list"
        aria-label="资源卡片"
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow: VRow) => {
          const start = virtualRow.index * cols;
          const rowItems = items.slice(start, start + cols);
          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 right-0 grid gap-3"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              }}
            >
              {rowItems.map((asset) => (
                <div key={asset.id} role="listitem">
                  <AssetCard
                    asset={asset}
                    onClick={onCardClick}
                    selected={selectedIds.includes(asset.id)}
                  />
                </div>
              ))}
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
