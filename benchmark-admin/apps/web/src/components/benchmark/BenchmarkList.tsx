import { parseAsString, useQueryStates } from 'nuqs';
import { useState } from 'react';
import { useDebounce } from 'use-debounce';
import {
  QUESTION_TYPES,
  SHOT_TYPES,
} from '@benchmark-admin/shared/constants/question-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { type RouterOutputs, trpc } from '@/lib/trpc';

type BenchmarkItem = RouterOutputs['benchmark']['list']['items'][number];
import { BenchmarkDrawer } from './BenchmarkDrawer';

const PARSERS = {
  search: parseAsString.withDefault(''),
  shotType: parseAsString.withDefault(''),
  questionType: parseAsString.withDefault(''),
};

export function BenchmarkList() {
  const [state, setState] = useQueryStates(PARSERS, { history: 'replace' });
  const [debouncedSearch] = useDebounce(state.search, 300);
  const [drawerId, setDrawerId] = useState<number | 'new' | null>(null);

  const list = trpc.benchmark.list.useQuery({
    search: debouncedSearch || undefined,
    filters: {
      shotType: state.shotType || undefined,
      questionType: state.questionType || undefined,
    },
  });

  const items: BenchmarkItem[] = list.data?.items ?? [];

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
          aria-label="题型"
          value={state.questionType}
          onChange={(e) => setState({ questionType: e.target.value })}
          disabled={!state.shotType}
          className="max-w-[140px]"
        >
          <option value="">题型</option>
          {QUESTION_TYPES.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
          共 {list.data?.total ?? items.length} 条
          <Button size="sm" onClick={() => setDrawerId('new')}>
            新建
          </Button>
        </div>
      </div>

      {list.isError ? (
        <p role="alert" className="text-sm text-[hsl(var(--destructive))]">
          {list.error.message}
        </p>
      ) : null}

      <table className="w-full border-collapse text-sm">
        <thead className="text-left text-xs text-[hsl(var(--muted-foreground))]">
          <tr className="border-b border-[hsl(var(--border))]">
            <th className="py-2 pr-2">ID</th>
            <th className="py-2 pr-2">镜头</th>
            <th className="py-2 pr-2">题型</th>
            <th className="py-2 pr-2">场景</th>
            <th className="py-2 pr-2">评分</th>
            <th className="py-2 pr-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((item: BenchmarkItem) => (
            <tr key={item.id} className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]">
              <td className="py-2 pr-2 text-[hsl(var(--muted-foreground))]">#{item.id}</td>
              <td className="py-2 pr-2">{item.shotType || '—'}</td>
              <td className="py-2 pr-2">{item.questionType || '—'}</td>
              <td className="py-2 pr-2 truncate">{item.scene || '—'}</td>
              <td className="py-2 pr-2">
                {item.score === null ? (
                  <Badge variant="outline">未评</Badge>
                ) : (
                  <Badge>{item.score}</Badge>
                )}
                {item.needsRevision ? (
                  <Badge variant="destructive" className="ml-1">需返工</Badge>
                ) : null}
              </td>
              <td className="py-2 pr-2 text-right">
                <Button size="sm" variant="outline" onClick={() => setDrawerId(item.id)}>
                  编辑
                </Button>
              </td>
            </tr>
          ))}
          {items.length === 0 && !list.isPending ? (
            <tr>
              <td colSpan={6} className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
                暂无结果
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

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
