import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { AssetCard, type AssetCardData } from './AssetCard';
import { type FilterField, FilterPanel } from './FilterPanel';
import { buildServerFilters, useFilters } from './useFilters';

const SCROLL_HEIGHT = 'calc(100vh - 220px)';
const NEAR_BOTTOM_PX = 360;

export type AssetKind = 'character' | 'scene' | 'prop';

export type AssetLibraryProps = {
  kind: AssetKind;
  filterFields: FilterField[];
  renderDrawer?: (props: {
    id: number;
    onClose: () => void;
    onCreated: () => void;
  }) => React.ReactNode;
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

  // Export reflects the active filter slice — same kind/search/filters as the
  // list, so the ZIP matches what's on screen rather than always the whole library.
  const exportUrl = trpc.exports.getDownloadUrl.useQuery({
    kind,
    search: debouncedSearch || undefined,
    deletedOnly: filterState.deletedOnly || undefined,
    filters: serverFilters,
  });

  const utils = trpc.useUtils();
  const generateImage = trpc.ai.generateImage.useMutation();

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

  function onEdit(id: number) {
    setDrawerId(id);
  }

  const items: AssetCardData[] =
    list.data?.pages.flatMap((p: { items: AssetCardData[] }) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? items.length;

  async function onGenerateImage(asset: AssetCardData) {
    const prompt = asset.data?.prompt;
    if (!prompt) return;
    await generateImage.mutateAsync({ kind: asset.kind, id: asset.id, prompt });
    await refetch();
  }

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
            命中 {total} 个{list.isFetching ? '（加载中…）' : ''}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!exportUrl.data}
              onClick={() => {
                if (exportUrl.data) window.location.href = exportUrl.data.url;
              }}
            >
              导出资产包
            </Button>
            {headerActions}
            {renderDrawer ? (
              <Button size="sm" onClick={() => setDrawerId('new')}>
                {kind === 'character' ? '新建角色' : kind === 'scene' ? '新建场景' : '新建道具'}
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
          <AssetList
            items={items}
            selectedIds={selectedIds}
            onCardClick={onCardClick}
            onEdit={onEdit}
            selectionMode={selectionMode === 'multi'}
            onGenerateImage={onGenerateImage}
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

type AssetListProps = {
  items: AssetCardData[];
  selectedIds: number[];
  onCardClick: (id: number) => void;
  onEdit: (id: number) => void;
  selectionMode: boolean;
  onGenerateImage: (asset: AssetCardData) => Promise<void>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
};

function AssetList({
  items,
  selectedIds,
  onCardClick,
  onEdit,
  selectionMode,
  onGenerateImage,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: AssetListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

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
      <ul aria-label="资源列表" className="flex flex-col gap-3">
        {items.map((asset) => (
          <li key={asset.id}>
            <AssetCard
              asset={asset}
              onClick={onCardClick}
              onEdit={onEdit}
              selected={selectedIds.includes(asset.id)}
              selectionMode={selectionMode}
              onGenerateImage={onGenerateImage}
            />
          </li>
        ))}
      </ul>
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
