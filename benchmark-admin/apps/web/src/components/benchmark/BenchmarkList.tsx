import { Button } from '@/components/ui/button';
import { Cascader } from '@/components/ui/cascader';
import { buildCascaderOptionsWithCounts } from '@/components/ui/cascader.helpers';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { CATEGORY_TREE } from '@benchmark-admin/shared/benchmark/categoryTree';
import { SHOT_TYPES, TASK_TYPES } from '@benchmark-admin/shared/constants/question-types';
import { useVirtualizer } from '@tanstack/react-virtual';
import { parseAsBoolean, parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { BenchmarkCard } from './BenchmarkCard';
import { BenchmarkComments } from './BenchmarkComments';
import { BenchmarkDrawer } from './BenchmarkDrawer';

type BenchmarkItem = RouterOutputs['benchmark']['list']['items'][number];
type VirtualRow = { key: string | number; index: number; start: number };

// Card height varies with prompt / asset count, so the virtualizer is keyed off
// `measureElement` instead of a fixed row height. The estimate just primes the
// scroll buffer for the first paint — once a card mounts, its real height
// replaces the estimate.
const ROW_ESTIMATE = 320;
const SCROLL_AREA_HEIGHT = 'calc(100vh - 240px)';
const NEAR_BOTTOM_PX = 240;

const DIFFICULTY_OPTIONS = ['易', '中', '难'];
const SCORE_OPTIONS = ['0', '1', '2', '3', '4', '5'];

const PARSERS = {
  search: parseAsString.withDefault(''),
  categoryL1: parseAsString.withDefault(''),
  categoryL2: parseAsString.withDefault(''),
  categoryL3: parseAsString.withDefault(''),
  shotType: parseAsString.withDefault(''),
  taskType: parseAsString.withDefault(''),
  difficulty: parseAsString.withDefault(''),
  manualTag: parseAsString.withDefault(''),
  score: parseAsString.withDefault(''),
  needsRevision: parseAsBoolean.withDefault(false),
  hasComments: parseAsBoolean.withDefault(false),
};

type CommentDrawerItem = { id: number; title: string };

export function BenchmarkList() {
  const [state, setState] = useQueryStates(PARSERS, { history: 'replace' });
  const [debouncedSearch] = useDebounce(state.search, 300);
  const [debouncedManualTag] = useDebounce(state.manualTag, 300);
  const [drawerId, setDrawerId] = useState<number | 'new' | null>(null);
  const [commentItem, setCommentItem] = useState<CommentDrawerItem | null>(null);

  const list = trpc.benchmark.list.useInfiniteQuery(
    {
      search: debouncedSearch || undefined,
      filters: {
        categoryL1: state.categoryL1 || undefined,
        categoryL2: state.categoryL2 || undefined,
        categoryL3: state.categoryL3 || undefined,
        shotType: state.shotType || undefined,
        taskType: state.taskType || undefined,
        difficulty: (state.difficulty as '' | '易' | '中' | '难') || undefined,
        manualTag: debouncedManualTag || undefined,
        score: state.score === '' ? undefined : Number(state.score),
        needsRevision: state.needsRevision || undefined,
        hasComments: state.hasComments || undefined,
      },
    },
    {
      getNextPageParam: (lastPage: { nextCursor: number | null }) =>
        lastPage.nextCursor ?? undefined,
      // Was 30 min — long enough that a transient empty response (e.g. a
      // post-deploy DB blip) would haunt the user for half an hour. Drop to
      // 1 min so mount + visibility-change refetch picks up fresh data fast;
      // presigned URLs are valid for ~1h so the re-sign cost stays low.
      staleTime: 60_000,
    },
  );

  const items: BenchmarkItem[] =
    list.data?.pages.flatMap((p: { items: BenchmarkItem[] }) => p.items) ?? [];
  const total: number = list.data?.pages[0]?.total ?? items.length;

  // Stats power the category Cascader (with per-node counts). Failures don't
  // block the list — Cascader gracefully renders zero-count nodes.
  const stats = trpc.benchmark.stats.useQuery();
  const cascaderOptions = useMemo(
    () => buildCascaderOptionsWithCounts(CATEGORY_TREE, stats.data?.groups ?? []),
    [stats.data],
  );
  const cascaderValue = useMemo(
    () => [state.categoryL1, state.categoryL2, state.categoryL3].filter((v) => v !== ''),
    [state.categoryL1, state.categoryL2, state.categoryL3],
  );

  // Export reflects the slice the reviewer is viewing — same filters as the list,
  // so the ZIP matches what's on screen rather than always the full bank.
  const exportUrl = trpc.exports.getDownloadUrl.useQuery({
    kind: 'benchmark',
    search: debouncedSearch || undefined,
    categoryL1: state.categoryL1 || undefined,
    categoryL2: state.categoryL2 || undefined,
    categoryL3: state.categoryL3 || undefined,
    shotType: state.shotType || undefined,
    needsRevision: state.needsRevision || undefined,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 4,
    // `measureElement` reads each card's real height after layout so a row that
    // expands its prompt / criteria gets the extra scroll space it needs.
    measureElement: (el: HTMLElement) => el.getBoundingClientRect().height,
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

  const onCategoryChange = useCallback(
    (path: string[]) => {
      const [l1 = '', l2 = '', l3 = ''] = path;
      setState({ categoryL1: l1, categoryL2: l2, categoryL3: l3 });
    },
    [setState],
  );

  function openComments(item: BenchmarkItem) {
    setCommentItem({ id: item.id, title: `评论 · 题目 #${item.id}` });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Cascader
          ariaLabel="分类"
          placeholder="分类"
          options={cascaderOptions}
          value={cascaderValue}
          onChange={onCategoryChange}
          className="w-[260px]"
        />
        <Select
          aria-label="镜头"
          value={state.shotType}
          onChange={(e) => setState({ shotType: e.target.value })}
          className="max-w-[140px]"
        >
          <option value="">镜头</option>
          {SHOT_TYPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          aria-label="任务"
          value={state.taskType}
          onChange={(e) => setState({ taskType: e.target.value })}
          className="max-w-[140px]"
        >
          <option value="">任务</option>
          {TASK_TYPES.map((tk) => (
            <option key={tk} value={tk}>
              {tk}
            </option>
          ))}
        </Select>
        <Select
          aria-label="难度"
          value={state.difficulty}
          onChange={(e) => setState({ difficulty: e.target.value })}
          className="max-w-[110px]"
        >
          <option value="">难度</option>
          {DIFFICULTY_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
        <Select
          aria-label="评分"
          value={state.score}
          onChange={(e) => setState({ score: e.target.value })}
          className="max-w-[110px]"
        >
          <option value="">评分</option>
          {SCORE_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1 text-sm" aria-label="评论">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={state.hasComments}
            onChange={(e) => setState({ hasComments: e.target.checked })}
          />
          评论
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={state.needsRevision}
            onChange={(e) => setState({ needsRevision: e.target.checked })}
          />
          待修改
        </label>
        <Input
          aria-label="搜索测试点人工标注"
          placeholder="搜索测试点人工标注"
          className="max-w-[200px]"
          value={state.manualTag}
          onChange={(e) => setState({ manualTag: e.target.value })}
        />
        <div className="ml-auto flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
          共 {total} 条
          <Button
            size="sm"
            variant="outline"
            disabled={!exportUrl.data || exportUrl.isFetching}
            onClick={() => {
              if (exportUrl.data && !exportUrl.isFetching)
                window.location.href = exportUrl.data.url;
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

      {items.length === 0 && !list.isPending ? (
        <div className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
          没有符合条件的题目
        </div>
      ) : (
        <div ref={scrollRef} className="overflow-auto" style={{ height: SCROLL_AREA_HEIGHT }}>
          <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow: VirtualRow) => {
              const item = items[virtualRow.index];
              if (!item) return null;
              return (
                <div
                  key={item.id}
                  data-index={virtualRow.index}
                  ref={(el) => {
                    if (el) rowVirtualizer.measureElement(el);
                  }}
                  className="absolute left-0 right-0 pb-3"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <BenchmarkCard
                    item={item}
                    onEdit={() => setDrawerId(item.id)}
                    onOpenComments={() => openComments(item)}
                  />
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

      {commentItem !== null ? (
        <CommentDrawer item={commentItem} onClose={() => setCommentItem(null)} />
      ) : null}

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

// Lightweight comments-only drawer for the 评论 N pill. Reuses BenchmarkComments
// so adds/deletes flow through the same optimistic-update path as the editor
// drawer's tab.
function CommentDrawer({
  item,
  onClose,
}: {
  item: CommentDrawerItem;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="关闭评论"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <aside
        // biome-ignore lint/a11y/useSemanticElements: <dialog>.showModal would steal focus from the underlying list; this anchored drawer follows the existing Drawer / Lightbox pattern in the project
        role="dialog"
        aria-label={item.title}
        className="relative flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-[hsl(var(--background))] p-4 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">{item.title}</h3>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="关闭">
            ×
          </Button>
        </div>
        <BenchmarkComments itemId={item.id} />
      </aside>
    </div>
  );
}
