import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { QUESTION_TYPES, SHOT_TYPES } from '@benchmark-admin/shared/constants/question-types';
import { useVirtualizer } from '@tanstack/react-virtual';
import { parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';

type BenchmarkItem = RouterOutputs['benchmark']['list']['items'][number];
import { BenchmarkDrawer } from './BenchmarkDrawer';

const ROW_HEIGHT = 41;
const SCROLL_AREA_HEIGHT = 'calc(100vh - 240px)';
const NEAR_BOTTOM_PX = 240;

type VRow = { key: string | number; index: number; start: number };

const PARSERS = {
  search: parseAsString.withDefault(''),
  shotType: parseAsString.withDefault(''),
  questionType: parseAsString.withDefault(''),
};

export function BenchmarkList() {
  const [state, setState] = useQueryStates(PARSERS, { history: 'replace' });
  const [debouncedSearch] = useDebounce(state.search, 300);
  const [drawerId, setDrawerId] = useState<number | 'new' | null>(null);

  const list = trpc.benchmark.list.useInfiniteQuery(
    {
      search: debouncedSearch || undefined,
      filters: {
        shotType: state.shotType || undefined,
        questionType: state.questionType || undefined,
      },
    },
    {
      getNextPageParam: (lastPage: { nextCursor: number | null }) =>
        lastPage.nextCursor ?? undefined,
      // benchmark.list items include presigned image URLs for linked media —
      // same rationale as AssetLibrary: a long staleTime avoids re-signing every
      // refetch.
      staleTime: 30 * 60_000,
    },
  );

  const items: BenchmarkItem[] =
    list.data?.pages.flatMap((p: { items: BenchmarkItem[] }) => p.items) ?? [];
  const total: number = list.data?.pages[0]?.total ?? items.length;

  // Export reflects the slice the reviewer is viewing — same filters as the list,
  // so the ZIP matches what's on screen rather than always the full bank.
  const exportUrl = trpc.exports.getDownloadUrl.useQuery({
    kind: 'benchmark',
    search: debouncedSearch || undefined,
    shotType: state.shotType || undefined,
    questionType: state.questionType || undefined,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Auto-load the next page as the user nears the bottom — keeps the existing
  // "加载更多" button as a fallback for keyboard-only / no-scroll cases.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !list.hasNextPage) return;
    function onScroll() {
      if (!el || list.isFetchingNextPage || !list.hasNextPage) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) {
        list.fetchNextPage();
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [list.hasNextPage, list.isFetchingNextPage, list.fetchNextPage]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="搜索"
          placeholder="搜索 prompt 或场景…"
          className="max-w-xs"
          value={state.search}
          onChange={(e) => setState({ search: e.target.value })}
        />
        <Select
          aria-label="镜头类型"
          value={state.shotType}
          onChange={(e) => setState({ shotType: e.target.value, questionType: '' })}
          className="max-w-[140px]"
        >
          <option value="">镜头类型</option>
          {SHOT_TYPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          aria-label="题目类型"
          value={state.questionType}
          onChange={(e) => setState({ questionType: e.target.value })}
          disabled={!state.shotType}
          className="max-w-[140px]"
        >
          <option value="">题目类型</option>
          {QUESTION_TYPES.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
          共 {total} 条
          <Button
            size="sm"
            variant="outline"
            disabled={!exportUrl.data}
            onClick={() => {
              if (exportUrl.data) window.location.href = exportUrl.data.url;
            }}
          >
            导出 ZIP
          </Button>
          <Button size="sm" onClick={() => setDrawerId('new')}>
            新建题目
          </Button>
        </div>
      </div>

      {list.isError ? (
        <p role="alert" className="text-sm text-[hsl(var(--destructive))]">
          {list.error.message}
        </p>
      ) : null}

      {/* Sticky header sits above the virtualized body; the body owns the
          scroll so only visible rows are mounted. */}
      <div className="grid grid-cols-[80px_1fr_1fr_2fr_140px_80px] gap-2 border-b border-[hsl(var(--border))] py-2 text-left text-xs text-[hsl(var(--muted-foreground))]">
        <div>ID</div>
        <div>镜头</div>
        <div>题目类型</div>
        <div>场景</div>
        <div>评分</div>
        <div />
      </div>

      {items.length === 0 && !list.isPending ? (
        <div className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">没有符合条件的题目</div>
      ) : (
        <div ref={scrollRef} className="overflow-auto" style={{ height: SCROLL_AREA_HEIGHT }}>
          <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow: VRow) => {
              const item = items[virtualRow.index];
              if (!item) return null;
              return (
                <div
                  key={item.id}
                  className="absolute left-0 right-0 grid grid-cols-[80px_1fr_1fr_2fr_140px_80px] items-center gap-2 border-b border-[hsl(var(--border))] py-2 text-sm hover:bg-[hsl(var(--muted))]"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    height: `${ROW_HEIGHT}px`,
                  }}
                >
                  <div className="text-[hsl(var(--muted-foreground))]">#{item.id}</div>
                  <div className="truncate">{item.shotType || '—'}</div>
                  <div className="truncate">{item.questionType || '—'}</div>
                  <div className="truncate">{item.scene || '—'}</div>
                  <div className="flex items-center gap-1">
                    {item.score === null ? (
                      <Badge variant="outline">未评分</Badge>
                    ) : (
                      <Badge>{item.score}</Badge>
                    )}
                    {item.needsRevision ? <Badge variant="destructive">待修改</Badge> : null}
                  </div>
                  <div className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setDrawerId(item.id)}>
                      编辑
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {list.hasNextPage ? (
            <div className="flex justify-center py-2">
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
        </div>
      )}

      {drawerId !== null ? (
        <BenchmarkDrawer
          id={drawerId === 'new' ? 0 : drawerId}
          onClose={() => setDrawerId(null)}
          onSaved={() => setDrawerId(null)}
        />
      ) : null}
    </div>
  );
}
