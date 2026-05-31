import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { type RouterInputs, type RouterOutputs, trpc } from '@/lib/trpc';

type Comment = RouterOutputs['benchmark']['comments']['list'][number];
type AddInput = RouterInputs['benchmark']['comments']['add'];

export type BenchmarkCommentsProps = {
  itemId: number;
};

export function BenchmarkComments({ itemId }: BenchmarkCommentsProps) {
  const utils = trpc.useUtils();
  const list = trpc.benchmark.comments.list.useQuery({ itemId });
  const add = trpc.benchmark.comments.add.useMutation({
    async onMutate(input: AddInput) {
      await utils.benchmark.comments.list.cancel({ itemId });
      const previous = utils.benchmark.comments.list.getData({ itemId }) as
        | Comment[]
        | undefined;
      const optimistic: Comment = {
        id: -Date.now(),
        itemId,
        body: input.body,
        author: '我',
        createdAt: new Date(),
      };
      utils.benchmark.comments.list.setData({ itemId }, (prev: Comment[] | undefined) => [
        ...(prev ?? []),
        optimistic,
      ]);
      return { previous };
    },
    onError(_err: Error, _input: AddInput, ctx: { previous: Comment[] | undefined } | undefined) {
      if (ctx?.previous) utils.benchmark.comments.list.setData({ itemId }, ctx.previous);
    },
    onSettled() {
      utils.benchmark.comments.list.invalidate({ itemId });
    },
  });
  const del = trpc.benchmark.comments.delete.useMutation({
    onSettled() {
      utils.benchmark.comments.list.invalidate({ itemId });
    },
  });
  const [body, setBody] = useState('');

  async function submit() {
    if (!body.trim()) return;
    await add.mutateAsync({ itemId, body });
    setBody('');
  }

  return (
    <section aria-label="评论" className="space-y-3">
      <h3 className="text-sm font-medium">评论</h3>
      <ul className="space-y-2">
        {((list.data ?? []) as Comment[]).map((c: Comment) => (
          <li key={c.id} className="rounded border border-[hsl(var(--border))] p-2 text-sm">
            <div className="mb-1 flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
              <span>{c.author || '匿名'}</span>
              <button
                type="button"
                className="text-[hsl(var(--destructive))] hover:underline"
                onClick={() => del.mutate({ commentId: c.id })}
                aria-label={`删除评论 ${c.id}`}
              >
                删除
              </button>
            </div>
            <div className="whitespace-pre-wrap">{c.body}</div>
          </li>
        ))}
        {list.data?.length === 0 ? (
          <li className="text-xs text-[hsl(var(--muted-foreground))]">还没有评论。</li>
        ) : null}
      </ul>
      <div className="space-y-2">
        <Textarea
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="写下评论…"
        />
        <div className="flex justify-end">
          <Button type="button" size="sm" disabled={!body.trim() || add.isPending} onClick={submit}>
            {add.isPending ? '发送中…' : '发送'}
          </Button>
        </div>
      </div>
    </section>
  );
}
