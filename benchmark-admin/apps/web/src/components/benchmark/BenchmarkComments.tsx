import { confirm, toast } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { type RouterInputs, type RouterOutputs, trpc } from '@/lib/trpc';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatCommentTime } from './formatCommentTime';

type Comment = RouterOutputs['benchmark']['comments']['list'][number];
type AddInput = RouterInputs['benchmark']['comments']['add'];

export type BenchmarkCommentsProps = {
  itemId: number;
};

const COMMENT_AUTHOR_KEY = 'benchmark_comment_author';

// Per-mount monotonic counter. Combined with the negative-id encoding it
// guarantees a unique optimistic id even when two submits land in the same
// millisecond (the old `-Date.now()` collided on double-submit and made
// rollback restore the wrong snapshot).
function makeTempIdGenerator() {
  let n = 0;
  return () => {
    n += 1;
    return -n;
  };
}

function readStoredAuthor(): string {
  try {
    return localStorage.getItem(COMMENT_AUTHOR_KEY) ?? '';
  } catch {
    // localStorage can throw in privacy modes or SSR — fall back to empty so
    // the name input shows on first render rather than crashing.
    return '';
  }
}

function writeStoredAuthor(value: string) {
  try {
    localStorage.setItem(COMMENT_AUTHOR_KEY, value);
  } catch {
    // Persistence is best-effort; the in-memory `author` state still drives
    // this session's UI.
  }
}

const TEXTAREA_LINE_HEIGHT = 20;
const TEXTAREA_MIN_ROWS = 3;
const TEXTAREA_MAX_ROWS = 10;

function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { value, style, ...rest } = props;

  // Resize after layout so the textarea grows with content up to maxRows. We
  // keep the scrollbar visible past maxRows instead of unbounded growth.
  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on value so each keystroke retriggers measurement
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const minH = TEXTAREA_MIN_ROWS * TEXTAREA_LINE_HEIGHT;
    const maxH = TEXTAREA_MAX_ROWS * TEXTAREA_LINE_HEIGHT;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minH), maxH)}px`;
  }, [value]);

  return (
    <Textarea
      ref={ref}
      value={value}
      rows={TEXTAREA_MIN_ROWS}
      style={{ resize: 'none', ...style }}
      {...rest}
    />
  );
}

export function BenchmarkComments({ itemId }: BenchmarkCommentsProps) {
  const utils = trpc.useUtils();
  const list = trpc.benchmark.comments.list.useQuery({ itemId });
  const nextTempId = useRef(makeTempIdGenerator()).current;
  const [author, setAuthor] = useState<string>(() => readStoredAuthor());
  const [editingName, setEditingName] = useState<boolean>(() => readStoredAuthor() === '');
  const [body, setBody] = useState('');

  // Keep editingName in sync with author so clearing the field switches the
  // header back into edit mode (e.g. after a manual reset).
  useEffect(() => {
    if (author === '') setEditingName(true);
  }, [author]);

  const add = trpc.benchmark.comments.add.useMutation({
    async onMutate(input: AddInput) {
      await utils.benchmark.comments.list.cancel({ itemId });
      const previous = utils.benchmark.comments.list.getData({ itemId }) as Comment[] | undefined;
      const tempId = nextTempId();
      const optimistic: Comment = {
        id: tempId,
        itemId,
        body: input.body,
        author: input.author,
        createdAt: new Date(),
        deletedAt: null,
      };
      utils.benchmark.comments.list.setData({ itemId }, (prev: Comment[] | undefined) => [
        ...(prev ?? previous ?? []),
        optimistic,
      ]);
      // Return the optimistic row id so rollback only removes *this* mutation's
      // entry — overlapping in-flight submits no longer clobber each other's
      // snapshot.
      return { tempId };
    },
    onError(_err: Error, _input: AddInput, ctx: { tempId: number } | undefined) {
      if (!ctx) return;
      utils.benchmark.comments.list.setData({ itemId }, (prev: Comment[] | undefined) =>
        (prev ?? []).filter((c: Comment) => c.id !== ctx.tempId),
      );
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

  async function submit() {
    const trimmedAuthor = author.trim();
    const trimmedBody = body.trim();
    if (!trimmedAuthor) {
      toast.warning('请填写你的名字');
      return;
    }
    if (!trimmedBody) {
      toast.warning('请输入评论内容');
      return;
    }
    try {
      await add.mutateAsync({ itemId, author: trimmedAuthor, body: trimmedBody });
      writeStoredAuthor(trimmedAuthor);
      setAuthor(trimmedAuthor);
      setEditingName(false);
      setBody('');
    } catch {
      // Rollback + error UI is handled by the mutation's onError/error state;
      // we just need to stop the rejection from escaping the click handler.
    }
  }

  async function handleDelete(commentId: number) {
    const ok = await confirm({
      title: '删除这条评论？',
      danger: true,
      confirmText: '删除',
    });
    if (!ok) return;
    del.mutate({ commentId });
  }

  return (
    <section aria-label="评论" className="space-y-3">
      <h3 className="text-sm font-medium">评论</h3>
      <ul className="space-y-3">
        {((list.data ?? []) as Comment[]).map((c: Comment) => (
          <li key={c.id} className="text-sm">
            <div className="flex items-center gap-2 rounded bg-[hsl(var(--muted))] px-2.5 py-1.5">
              <span className="text-[13px] font-semibold text-[hsl(var(--foreground))]">
                {c.author || '匿名'}
              </span>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                {formatCommentTime(c.createdAt)}
              </span>
              <button
                type="button"
                className="ml-auto text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                onClick={() => handleDelete(c.id)}
                aria-label={`删除评论 ${c.id}`}
              >
                ⋯
              </button>
            </div>
            <div className="whitespace-pre-wrap px-2.5 pt-2 text-[hsl(var(--foreground))]">
              {c.body}
            </div>
          </li>
        ))}
        {list.data?.length === 0 ? (
          <li className="text-xs text-[hsl(var(--muted-foreground))]">还没有评论。</li>
        ) : null}
      </ul>
      <div className="space-y-2">
        {editingName ? (
          <Input
            aria-label="评论者名字"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="首次评论请填写你的名字，后续会记住"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            aria-label="修改评论者名字"
            className="block w-full px-2 text-left text-[13px] font-semibold text-[hsl(var(--foreground))]"
          >
            {author}
          </button>
        )}
        <AutoTextarea
          aria-label="评论内容"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="输入评论"
        />
        <div className="flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setBody('')}>
            取消
          </Button>
          <Button type="button" size="sm" disabled={add.isPending} onClick={submit}>
            {add.isPending ? '发送中…' : '发送'}
          </Button>
        </div>
      </div>
    </section>
  );
}
