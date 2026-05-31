import { useMemo, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { AssetCard, type AssetCardData } from './AssetCard';
import { type FilterField, FilterPanel } from './FilterPanel';
import { buildServerFilters, useFilters } from './useFilters';

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
          <>
            <ul
              aria-label="资源卡片"
              className="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4"
            >
              {items.map((asset) => (
                <li key={asset.id}>
                  <AssetCard
                    asset={asset}
                    onClick={onCardClick}
                    selected={selectedIds.includes(asset.id)}
                  />
                </li>
              ))}
            </ul>
            {list.hasNextPage ? (
              <div className="mt-4 flex justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => list.fetchNextPage()}
                  disabled={list.isFetchingNextPage}
                >
                  {list.isFetchingNextPage ? '加载中…' : '加载更多'}
                </Button>
              </div>
            ) : null}
          </>
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
