/**
 * Regression test for the MediaPicker prune bug: the reconcile effect must NOT
 * drop a selected id that lives on a not-yet-fetched page. Pruning is only safe
 * once the entire list is loaded (`hasNextPage` is false). Before the fix the
 * effect ran against page-1 items only and wrongly dropped page-2 selections.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createTrpcMock } from '@/test/trpc-mock';

const PAGE_ONE = [
  { id: 1, url: 'http://x/1', source: 'a', mediaType: 'image' },
  { id: 2, url: 'http://x/2', source: 'b', mediaType: 'image' },
];
const PAGE_TWO = [{ id: 99, url: 'http://x/99', source: 'c', mediaType: 'image' }];

vi.mock('@/lib/trpc', () =>
  createTrpcMock({
    infiniteQuery: {
      'mediaAssets.list': (_input, cursor) => {
        if (cursor == null) return { items: PAGE_ONE, nextCursor: 3 };
        return { items: PAGE_TWO, nextCursor: null };
      },
    },
  }),
);

import { MediaPicker } from '../MediaPicker';

describe('MediaPicker reconcile', () => {
  it('does not drop a selection that lives on an unfetched page', async () => {
    const onChange = vi.fn();
    // 99 only appears on page 2, which is not fetched until the user loads more.
    render(
      <MediaPicker
        label="角色图"
        mediaType="image"
        multi
        selectedIds={[1, 99]}
        onChange={onChange}
      />,
    );

    // Open the picker so the infinite query mounts (page 1 loaded, hasNextPage).
    await userEvent.click(screen.getByRole('button', { name: /选择/ }));

    // With page 1 loaded and more pages pending, the prune effect must be a
    // no-op — id 99 must NOT be pruned even though it isn't in the loaded items.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('prunes a genuinely-deleted id once the full list is loaded', async () => {
    const onChange = vi.fn();
    // 7 exists nowhere in either page → should be pruned, but only after the
    // last page loads (hasNextPage false).
    render(
      <MediaPicker
        label="角色图"
        mediaType="image"
        multi
        selectedIds={[1, 7]}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /选择/ }));
    // Still has a next page → no prune yet.
    expect(onChange).not.toHaveBeenCalled();

    // Load the final page; now hasNextPage is false and reconcile may run.
    await userEvent.click(await screen.findByRole('button', { name: /加载更多/ }));
    expect(onChange).toHaveBeenCalledWith([1]);
  });
});
