import { LazyImage } from '@/components/asset-library/LazyImage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import {
  QUESTION_TYPES,
  SHOT_TYPES,
  TASK_TYPES,
} from '@benchmark-admin/shared/constants/question-types';
import { useVirtualizer } from '@tanstack/react-virtual';
import { parseAsBoolean, parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';

type BenchmarkItem = RouterOutputs['benchmark']['list']['items'][number];
type ItemMediaLink = BenchmarkItem['media']['character_image'][number];
import { BenchmarkDrawer } from './BenchmarkDrawer';

// Rows carry a thumbnail strip + difficulty tag, so they're taller than a plain
// text row.
const ROW_HEIGHT = 68;
const SCROLL_AREA_HEIGHT = 'calc(100vh - 280px)';
const NEAR_BOTTOM_PX = 240;
const GRID_COLS = 'grid-cols-[56px_180px_88px_88px_1fr_56px_104px_64px]';

type VRow = { key: string | number; index: number; start: number };

const SCENE_OPTIONS = ['电影 / 预告片', '短剧 / 剧情片段', '动画 / 风格化内容'];
const SCREEN_SIZE_OPTIONS = ['16:9', '9:16', '2.39:1'];
const DIFFICULTY_OPTIONS = ['易', '中', '难'];
const SCORE_OPTIONS = ['0', '1', '2', '3', '4', '5'];

const PARSERS = {
  search: parseAsString.withDefault(''),
  shotType: parseAsString.withDefault(''),
  taskType: parseAsString.withDefault(''),
  questionType: parseAsString.withDefault(''),
  scene: parseAsString.withDefault(''),
  screenSize: parseAsString.withDefault(''),
  difficulty: parseAsString.withDefault(''),
  manualTag: parseAsString.withDefault(''),
  score: parseAsString.withDefault(''),
  needsRevision: parseAsBoolean.withDefault(false),
  hasComments: parseAsBoolean.withDefault(false),
};

function screenSizeToAspect(screenSize: string): string {
  switch (screenSize) {
    case '16:9':
      return '16 / 9';
    case '9:16':
      return '9 / 16';
    case '2.39:1':
      return '2.39 / 1';
    default:
      return '16 / 9';
  }
}

function DifficultyTag({ value }: { value: string }) {
  if (!value) return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
  const color =
    value === '易'
      ? 'bg-emerald-100 text-emerald-700'
      : value === '中'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-red-100 text-red-700';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {value}
    </span>
  );
}

type PreviewState = { url: string; type: 'image' | 'video'; aspect: string };

export function BenchmarkList() {
  const [state, setState] = useQueryStates(PARSERS, { history: 'replace' });
  const [debouncedSearch] = useDebounce(state.search, 300);
  const [debouncedManualTag] = useDebounce(state.manualTag, 300);
  const [drawerId, setDrawerId] = useState<number | 'new' | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const list = trpc.benchmark.list.useInfiniteQuery(
    {
      search: debouncedSearch || undefined,
      filters: {
        shotType: state.shotType || undefined,
        taskType: state.taskType || undefined,
        questionType: state.questionType || undefined,
        scene: state.scene || undefined,
        screenSize: state.screenSize || undefined,
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
      // benchmark.list items include presigned media URLs — a long staleTime
      // avoids re-signing every refetch.
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
    needsRevision: state.needsRevision || undefined,
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
          placeholder="搜索全部字段…"
          className="max-w-xs"
          value={state.search}
          onChange={(e) => setState({ search: e.target.value })}
        />
        <Select
          aria-label="镜头类型"
          value={state.shotType}
          onChange={(e) => setState({ shotType: e.target.value, questionType: '' })}
          className="max-w-[130px]"
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
          className="max-w-[130px]"
        >
          <option value="">题目类型</option>
          {QUESTION_TYPES.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </Select>
        <Select
          aria-label="任务类型"
          value={state.taskType}
          onChange={(e) => setState({ taskType: e.target.value })}
          className="max-w-[130px]"
        >
          <option value="">任务类型</option>
          {TASK_TYPES.map((tk) => (
            <option key={tk} value={tk}>
              {tk}
            </option>
          ))}
        </Select>
        <Select
          aria-label="场景"
          value={state.scene}
          onChange={(e) => setState({ scene: e.target.value })}
          className="max-w-[150px]"
        >
          <option value="">场景</option>
          {SCENE_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
        <Select
          aria-label="屏幕尺寸"
          value={state.screenSize}
          onChange={(e) => setState({ screenSize: e.target.value })}
          className="max-w-[110px]"
        >
          <option value="">屏幕尺寸</option>
          {SCREEN_SIZE_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
        <Select
          aria-label="难度"
          value={state.difficulty}
          onChange={(e) => setState({ difficulty: e.target.value })}
          className="max-w-[100px]"
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
          className="max-w-[100px]"
        >
          <option value="">评分</option>
          {SCORE_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
        <Input
          aria-label="人工标注"
          placeholder="人工标注…"
          className="max-w-[140px]"
          value={state.manualTag}
          onChange={(e) => setState({ manualTag: e.target.value })}
        />
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={state.needsRevision}
            onChange={(e) => setState({ needsRevision: e.target.checked })}
          />
          待修改
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={state.hasComments}
            onChange={(e) => setState({ hasComments: e.target.checked })}
          />
          有评论
        </label>
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
      <div
        className={`grid ${GRID_COLS} gap-2 border-b border-[hsl(var(--border))] py-2 text-left text-xs text-[hsl(var(--muted-foreground))]`}
      >
        <div>ID</div>
        <div>媒体</div>
        <div>镜头</div>
        <div>题目类型</div>
        <div>场景</div>
        <div>难度</div>
        <div>评分</div>
        <div />
      </div>

      {items.length === 0 && !list.isPending ? (
        <div className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
          没有符合条件的题目
        </div>
      ) : (
        <div ref={scrollRef} className="overflow-auto" style={{ height: SCROLL_AREA_HEIGHT }}>
          <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow: VRow) => {
              const item = items[virtualRow.index];
              if (!item) return null;
              const aspect = screenSizeToAspect(item.screenSize);
              const images: ItemMediaLink[] = [
                ...item.media.character_image,
                ...item.media.scene_image,
                ...item.media.prop_image,
              ];
              const firstVideoUrl = item.media.video_output[0]?.url;
              return (
                <div
                  key={item.id}
                  className={`absolute left-0 right-0 grid ${GRID_COLS} items-center gap-2 border-b border-[hsl(var(--border))] py-2 text-sm hover:bg-[hsl(var(--muted))]`}
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    height: `${ROW_HEIGHT}px`,
                  }}
                >
                  <div className="text-[hsl(var(--muted-foreground))]">#{item.id}</div>
                  <div className="flex items-center gap-1">
                    {images.slice(0, 3).map((l) =>
                      l.url ? (
                        <button
                          key={l.id}
                          type="button"
                          aria-label={`预览图片 ${l.mediaId}`}
                          onClick={() => setPreview({ url: l.url, type: 'image', aspect })}
                          className="h-12 w-12 overflow-hidden rounded border border-[hsl(var(--border))]"
                        >
                          <LazyImage src={l.url} alt={`media-${l.mediaId}`} className="h-12 w-12" />
                        </button>
                      ) : null,
                    )}
                    {images.length > 3 ? (
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        +{images.length - 3}
                      </span>
                    ) : null}
                    {firstVideoUrl ? (
                      <button
                        type="button"
                        aria-label="播放输出视频"
                        onClick={() => setPreview({ url: firstVideoUrl, type: 'video', aspect })}
                        className="flex h-12 w-12 items-center justify-center rounded border border-[hsl(var(--border))] bg-black/80 text-white"
                      >
                        ▶
                      </button>
                    ) : null}
                    {images.length === 0 && !firstVideoUrl ? (
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>
                    ) : null}
                  </div>
                  <div className="truncate">{item.shotType || '—'}</div>
                  <div className="truncate">{item.questionType || '—'}</div>
                  <div className="truncate">{item.scene || '—'}</div>
                  <div>
                    <DifficultyTag value={item.difficulty} />
                  </div>
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

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          {/* Backdrop is a sibling button (not a parent) so the media element
              isn't nested inside an interactive element. */}
          <button
            type="button"
            aria-label="关闭预览"
            className="absolute inset-0 bg-black/70"
            onClick={() => setPreview(null)}
          />
          <div
            className="relative max-h-[85vh] max-w-[85vw]"
            style={{ aspectRatio: preview.aspect }}
          >
            {preview.type === 'image' ? (
              <img src={preview.url} alt="预览" className="h-full w-full rounded object-contain" />
            ) : (
              // biome-ignore lint/a11y/useMediaCaption: review-tool preview of user-supplied media; no captions exist
              <video src={preview.url} controls autoPlay className="h-full w-full rounded" />
            )}
          </div>
        </div>
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
