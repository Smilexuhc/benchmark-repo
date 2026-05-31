import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc';
import { useBatchRegenerateStore } from '@/stores/batch-regenerate';

export type BatchToolbarProps = {
  kind: 'character' | 'scene' | 'prop';
};

export function BatchToolbar({ kind }: BatchToolbarProps) {
  const [open, setOpen] = useState(false);
  const [idsInput, setIdsInput] = useState('');
  const status = useBatchRegenerateStore((s) => s.status);
  const results = useBatchRegenerateStore((s) => s.results);
  const pending = useBatchRegenerateStore((s) => s.pending);
  const errorMessage = useBatchRegenerateStore((s) => s.errorMessage);
  const start = useBatchRegenerateStore((s) => s.start);
  const retryFailed = useBatchRegenerateStore((s) => s.retryFailed);
  const reset = useBatchRegenerateStore((s) => s.reset);

  const totals = Object.values(results);
  const done = totals.filter((r) => r.status === 'done').length;
  const failed = totals.filter((r) => r.status === 'failed').length;

  const exportUrl = trpc.exports.getDownloadUrl.useQuery({ kind: 'benchmark' });

  function parseIds(): number[] {
    return idsInput
      .split(/[,\s]+/)
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          批量重生成
        </Button>
        {kind === 'character' ? null /* export limited to benchmark kind today */ : null}
      </div>

      {open ? (
        <Drawer
          open
          onClose={() => setOpen(false)}
          title="批量重生成图像"
          widthClassName="w-[480px] max-w-full"
        >
          <div className="space-y-4">
            <div className="space-y-1.5 text-sm">
              <label htmlFor="batch-ids-input" className="block font-medium">
                资源 ID（逗号或空格分隔）
              </label>
              <Input
                id="batch-ids-input"
                value={idsInput}
                onChange={(e) => setIdsInput(e.target.value)}
                placeholder="例如：1, 2, 3"
                disabled={status === 'running'}
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={status === 'running' || parseIds().length === 0}
                onClick={() => {
                  reset();
                  void start(parseIds());
                }}
              >
                开始
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={status === 'running' || failed === 0}
                onClick={() => void retryFailed()}
              >
                重试失败 ({failed})
              </Button>
              <Button size="sm" variant="ghost" onClick={reset} disabled={status === 'running'}>
                清空
              </Button>
            </div>

            {totals.length > 0 ? (
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <Badge>{done} 完成</Badge>
                  <Badge variant="outline">{pending.length} 进行中</Badge>
                  <Badge variant="destructive">{failed} 失败</Badge>
                </div>
                <ul className="max-h-64 space-y-1 overflow-y-auto rounded border border-[hsl(var(--border))] p-2 text-xs">
                  {Object.entries(results).map(([id, r]) => (
                    <li key={id} className="flex items-center justify-between gap-2">
                      <span>#{id}</span>
                      {r.status === 'pending' ? (
                        <Badge variant="outline">进行中</Badge>
                      ) : r.status === 'done' ? (
                        <Badge>完成</Badge>
                      ) : (
                        <Badge variant="destructive" title={r.error}>失败</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {errorMessage ? (
              <p role="alert" className="text-xs text-[hsl(var(--destructive))]">
                {errorMessage}
              </p>
            ) : null}

            <div className="border-t border-[hsl(var(--border))] pt-3">
              <p className="mb-2 text-xs text-[hsl(var(--muted-foreground))]">
                导出 ZIP（包含所有未删除评测项及其图像）
              </p>
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
            </div>
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
