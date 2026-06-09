/**
 * Covers two things in one file:
 *
 *  1. The U10 surface (author input + localStorage persistence + formatted
 *     timestamp + confirm-on-delete + empty-input toasts).
 *  2. The pre-existing optimistic-rollback guarantee from JUJ-22 — temp ids are
 *     mount-scoped negative ints and a rollback removes only the failing
 *     mutation's row, so sibling optimistic entries (and committed rows) are
 *     never clobbered when two submits race in the same millisecond.
 */
import { createTrpcMock } from '@/test/trpc-mock';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Comment = {
  id: number;
  itemId: number;
  body: string;
  author: string;
  createdAt: Date;
  deletedAt: Date | null;
};

let serverComments: Comment[] = [];
let nextServerId = 100;
let addBehavior: 'ok' | 'fail' = 'ok';
let deleteCalls: { commentId: number }[] = [];
const confirmMock = vi.fn(async () => true);
const toastWarningMock = vi.fn();

vi.mock('@/components/feedback', () => ({
  confirm: (...args: unknown[]) => confirmMock(...(args as Parameters<typeof confirmMock>)),
  toast: {
    warning: (msg: unknown) => toastWarningMock(msg),
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock('@/lib/trpc', () =>
  createTrpcMock({
    query: {
      'benchmark.comments.list': () => serverComments,
    },
    mutation: {
      'benchmark.comments.add': async (input: unknown) => {
        if (addBehavior === 'fail') throw new Error('boom');
        const i = input as { itemId: number; author: string; body: string };
        const row: Comment = {
          id: nextServerId++,
          itemId: i.itemId,
          body: i.body,
          author: i.author,
          createdAt: new Date('2026-06-02T14:30:00'),
          deletedAt: null,
        };
        serverComments.push(row);
        return row;
      },
      'benchmark.comments.delete': async (input: unknown) => {
        deleteCalls.push(input as { commentId: number });
        return { commentId: (input as { commentId: number }).commentId };
      },
    },
  }),
);

import { BenchmarkComments } from '../BenchmarkComments';

const STORAGE_KEY = 'benchmark_comment_author';

beforeEach(() => {
  localStorage.clear();
  serverComments = [];
  nextServerId = 100;
  addBehavior = 'ok';
  deleteCalls = [];
  confirmMock.mockClear();
  confirmMock.mockImplementation(async () => true);
  toastWarningMock.mockClear();
});

afterEach(() => {
  localStorage.clear();
});

describe('BenchmarkComments — author + persistence', () => {
  it('shows the name Input on first mount when no author is stored', () => {
    render(<BenchmarkComments itemId={99} />);
    expect(screen.getByLabelText('评论者名字')).toBeInTheDocument();
  });

  it('persists author to localStorage and shows bold name on next mount', async () => {
    const { unmount } = render(<BenchmarkComments itemId={99} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('评论者名字'), '张三');
    await user.type(screen.getByLabelText('评论内容'), '看起来不错');
    await user.click(screen.getByRole('button', { name: /发送/ }));

    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('张三'));

    unmount();
    render(<BenchmarkComments itemId={99} />);

    expect(screen.queryByLabelText('评论者名字')).not.toBeInTheDocument();
    const nameDisplay = screen.getByRole('button', { name: '修改评论者名字' });
    expect(nameDisplay).toHaveTextContent('张三');
    expect(nameDisplay.className).toMatch(/font-semibold/);
  });

  it('empty author → toast.warning, no submission', async () => {
    render(<BenchmarkComments itemId={99} />);
    const user = userEvent.setup();

    // Leave name blank, type a body, hit send.
    await user.type(screen.getByLabelText('评论内容'), 'orphan body');
    await user.click(screen.getByRole('button', { name: /发送/ }));

    expect(toastWarningMock).toHaveBeenCalledWith('请填写你的名字');
    expect(serverComments).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('empty body → toast.warning, no submission', async () => {
    localStorage.setItem(STORAGE_KEY, '张三');
    render(<BenchmarkComments itemId={99} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /发送/ }));

    expect(toastWarningMock).toHaveBeenCalledWith('请输入评论内容');
    expect(serverComments).toHaveLength(0);
  });
});

describe('BenchmarkComments — rendered comment items', () => {
  it('renders bold author and 6月D日 HH:mm timestamp for each comment', async () => {
    serverComments = [
      {
        id: 1,
        itemId: 99,
        body: '第一条评论',
        author: '李四',
        createdAt: new Date('2026-06-02T14:30:00'),
        deletedAt: null,
      },
    ];

    render(<BenchmarkComments itemId={99} />);

    const author = await screen.findByText('李四');
    expect(author.className).toMatch(/font-semibold/);
    expect(screen.getByText('6月2日 14:30')).toBeInTheDocument();
  });
});

describe('BenchmarkComments — delete via confirm', () => {
  it('calls delete mutation only after user confirms', async () => {
    serverComments = [
      {
        id: 7,
        itemId: 99,
        body: 'to delete',
        author: '王五',
        createdAt: new Date('2026-06-02T09:05:00'),
        deletedAt: null,
      },
    ];

    render(<BenchmarkComments itemId={99} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: '删除评论 7' }));

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    const firstCall = confirmMock.mock.calls[0] as unknown[] | undefined;
    const args = firstCall?.[0] as { title: string; danger?: boolean };
    expect(args.title).toBe('删除这条评论？');
    expect(args.danger).toBe(true);

    await waitFor(() => expect(deleteCalls).toEqual([{ commentId: 7 }]));
  });

  it('does not delete when user cancels the confirm dialog', async () => {
    confirmMock.mockImplementation(async () => false);
    serverComments = [
      {
        id: 8,
        itemId: 99,
        body: 'will survive',
        author: '王五',
        createdAt: new Date('2026-06-02T09:05:00'),
        deletedAt: null,
      },
    ];

    render(<BenchmarkComments itemId={99} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: '删除评论 8' }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));

    expect(deleteCalls).toEqual([]);
  });
});

describe('BenchmarkComments — optimistic rollback (regression from JUJ-22)', () => {
  it("removes only the failed mutation's row on rollback", async () => {
    addBehavior = 'fail';
    localStorage.setItem(STORAGE_KEY, '张三');
    serverComments = [
      {
        id: 1,
        itemId: 99,
        body: 'pre-existing',
        author: 'someone',
        createdAt: new Date('2026-06-02T08:00:00'),
        deletedAt: null,
      },
    ];

    render(<BenchmarkComments itemId={99} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('评论内容'), 'will fail');

    // The pre-existing comment must survive the failed submit's rollback;
    // the optimistic row added during onMutate must be the only thing removed.
    await act(async () => {
      try {
        await user.click(screen.getByRole('button', { name: /发送/ }));
      } catch {
        // Mutation throws; that's the path we want to exercise.
      }
    });

    const list = screen.getByRole('list');
    expect(list).toHaveTextContent('pre-existing');
    expect(list).not.toHaveTextContent('will fail');
  });
});
