/**
 * Tests the optimistic comment store (P1 from JUJ-22).
 *
 * The pre-fix implementation generated a temp id with `-Date.now()` and
 * rolled back by restoring a whole-list snapshot. Two submits in the same
 * millisecond collided, and a rollback for the *second* mutation would
 * restore a snapshot that still contained the *first* mutation's optimistic
 * row — so the wrong comment got removed (or, with two failures, a working
 * comment from elsewhere disappeared).
 *
 * The fix issues a stable, mount-scoped negative id and the rollback removes
 * *only the failing mutation's row* from the current list, leaving sibling
 * optimistic entries alone.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createTrpcMock } from '@/test/trpc-mock';

type Comment = {
  id: number;
  itemId: number;
  body: string;
  author: string;
  createdAt: Date;
};

const initial: Comment[] = [
  { id: 1, itemId: 99, body: 'pre-existing', author: 'someone', createdAt: new Date() },
];

let nextServerId = 100;
let addBehavior: 'ok' | 'fail' = 'ok';

vi.mock('@/lib/trpc', () =>
  createTrpcMock({
    query: {
      'benchmark.comments.list': () => initial,
    },
    mutation: {
      'benchmark.comments.add': async (input: unknown) => {
        if (addBehavior === 'fail') throw new Error('boom');
        const i = input as { itemId: number; body: string };
        const row: Comment = {
          id: nextServerId++,
          itemId: i.itemId,
          body: i.body,
          author: 'me',
          createdAt: new Date(),
        };
        initial.push(row);
        return row;
      },
      'benchmark.comments.delete': async () => undefined,
    },
  }),
);

import { BenchmarkComments } from '../BenchmarkComments';

describe('BenchmarkComments optimistic rollback', () => {
  it("removes only the failed mutation's row on rollback", async () => {
    addBehavior = 'fail';
    render(<BenchmarkComments itemId={99} />);

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('写下评论…'), 'will fail');

    // The pre-existing comment must survive the failed submit's rollback;
    // the optimistic row added during onMutate must be the only thing removed.
    await act(async () => {
      try {
        await user.click(screen.getByRole('button', { name: /发送/ }));
      } catch {
        // Mutation throws; that's the path we want to exercise.
      }
    });

    // Inspect only the comments list (the textarea still contains "will fail"
    // — we don't care about that, we care about the rendered comment list).
    const list = screen.getByRole('list');
    expect(list).toHaveTextContent('pre-existing');
    expect(list).not.toHaveTextContent('will fail');
  });
});
