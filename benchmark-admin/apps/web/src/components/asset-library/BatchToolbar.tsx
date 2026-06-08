import { useMemo, useState } from 'react';
import { confirm } from '@/components/feedback/confirm';
import { toast } from '@/components/feedback/toast';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import type { AssetCardData } from './AssetCard';
import { type BatchJob, useBatchRunner } from './useBatchRunner';
import type { AssetKind } from './useFilters';

export type BatchToolbarProps = {
  kind: AssetKind;
  items: AssetCardData[];
  selectMode: boolean;
  onEnterSelectMode: () => void;
  onExitSelectMode: () => void;
  selectedIds: number[];
  onSelectedIdsChange: (ids: number[]) => void;
  // Export-bundle action — when present, the "导出资产包" button is enabled and
  // clicking it navigates to `exportHref`. Disabled when null/undefined.
  exportHref?: string | undefined;
  // "新建" action — when present, the toolbar renders the create button.
  onNewClick?: (() => void) | undefined;
  newLabel?: string | undefined;
};

function getPrompt(asset: AssetCardData | undefined): string {
  const p = asset?.data?.prompt;
  return typeof p === 'string' ? p.trim() : '';
}

function estimateMinutes(count: number): number {
  // ~30s per item; floor to 1 minute so the body is never "0 分钟".
  return Math.max(1, Math.ceil(count * 0.5));
}

export function BatchToolbar({
  kind,
  items,
  selectMode,
  onEnterSelectMode,
  onExitSelectMode,
  selectedIds,
  onSelectedIdsChange,
  exportHref,
  onNewClick,
  newLabel = '新建',
}: BatchToolbarProps) {
  const generateImage = trpc.ai.generateImage.useMutation();
  const runner = useBatchRunner();
  const [confirming, setConfirming] = useState(false);

  // Map of id → item for fast lookup when assembling jobs / labels.
  const itemById = useMemo(() => {
    const map = new Map<number, AssetCardData>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const selectedInView = selectedIds.filter((id) => itemById.has(id));
  const totalInView = items.length;

  function selectAllInView() {
    const ids = items.map((i) => i.id);
    // Preserve any selections from previous pages that are no longer visible.
    const offView = selectedIds.filter((id) => !itemById.has(id));
    onSelectedIdsChange([...offView, ...ids]);
  }

  function clearSelection() {
    onSelectedIdsChange([]);
  }

  function exitBatchMode() {
    runner.reset();
    onSelectedIdsChange([]);
    onExitSelectMode();
  }

  async function handleStart() {
    const jobsAll: BatchJob[] = selectedIds.map((id) => {
      const item = itemById.get(id);
      return { id, name: item?.name ?? `#${id}` };
    });
    const jobs = jobsAll.filter((j) => getPrompt(itemById.get(j.id)) !== '');
    if (jobs.length === 0) {
      toast.warning('选中的项都没有提示词');
      return;
    }

    setConfirming(true);
    const ok = await confirm({
      title: `批量重新生成 ${jobs.length} 项？`,
      body: `共约 ${estimateMinutes(jobs.length)} 分钟，过程中可随时停止。`,
      confirmText: '开始',
    });
    setConfirming(false);
    if (!ok) return;

    const outcome = await runner.start(jobs, async (job) => {
      const prompt = getPrompt(itemById.get(job.id));
      await generateImage.mutateAsync({ kind, id: job.id, prompt });
    });

    if (outcome.kind === 'completed') {
      toast.success(`批量生成完成：${outcome.done} 个`);
      exitBatchMode();
    } else if (outcome.kind === 'stopped') {
      toast.info(`已停止，完成 ${outcome.done} 个`);
    } else {
      toast.error(`「${outcome.job.name}」失败：${outcome.error}`);
    }
  }

  // ── Outside select mode: standard library header buttons ───────────────────
  if (!selectMode) {
    return (
      <div className="flex items-center gap-2">
        {exportHref !== undefined ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              window.location.href = exportHref;
            }}
          >
            导出资产包
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled>
            导出资产包
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onEnterSelectMode}>
          批量生成
        </Button>
        {onNewClick ? (
          <Button size="sm" onClick={onNewClick}>
            {newLabel}
          </Button>
        ) : null}
      </div>
    );
  }

  // ── Inside select mode: blue operation bar ─────────────────────────────────
  const { state, progress } = runner;
  const running = state === 'running' || state === 'stopping';

  return (
    <section
      className={cn(
        'flex w-full items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm',
      )}
      aria-label="批量生成"
    >
      {running ? (
        <>
          <span className="font-medium text-[hsl(var(--foreground))]">批量重新生成</span>
          <span aria-live="polite">
            {progress.done}/{progress.total}
          </span>
          <div
            className="relative h-2 flex-1 overflow-hidden rounded-full bg-blue-100"
            role="progressbar"
            tabIndex={0}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-label="批量生成进度"
          >
            <div
              className="absolute inset-y-0 left-0 bg-blue-500 transition-[width]"
              style={{
                width:
                  progress.total === 0
                    ? '0%'
                    : `${Math.round((progress.done / progress.total) * 100)}%`,
              }}
            />
          </div>
          {progress.current ? (
            <span className="truncate text-[hsl(var(--muted-foreground))]">
              当前: {progress.current.name}
            </span>
          ) : null}
          <Button
            size="sm"
            variant="destructive"
            onClick={runner.stop}
            disabled={state === 'stopping'}
          >
            {state === 'stopping' ? '停止中…' : '停止'}
          </Button>
        </>
      ) : (
        <>
          <span className="font-medium text-[hsl(var(--foreground))]">
            已选 {selectedInView.length}/{totalInView}
          </span>
          <Button size="sm" variant="outline" onClick={selectAllInView}>
            全选当前
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={clearSelection}
            disabled={selectedIds.length === 0}
          >
            清空
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={handleStart}
            disabled={selectedIds.length === 0 || confirming}
          >
            开始重新生成
          </Button>
          <Button size="sm" variant="outline" onClick={exitBatchMode}>
            退出
          </Button>
        </>
      )}
    </section>
  );
}
