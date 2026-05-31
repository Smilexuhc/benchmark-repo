/**
 * Tests the AssetLibrary pagination wiring (P1 from JUJ-22).
 *
 * Before this fix, AssetLibrary used `useQuery`, so the server's nextCursor
 * was never read and only the first 20 items were ever reachable. The fix
 * uses `useInfiniteQuery` + a "Load more" button. This test mocks tRPC and
 * verifies that clicking the button surfaces items beyond page 1.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { describe, expect, it, vi } from 'vitest';
import { createTrpcMock } from '@/test/trpc-mock';

// Two pages of stub data — first page returns nextCursor: 21 so the button
// becomes available; second page returns nextCursor: null.
const PAGE_ONE = Array.from({ length: 20 }, (_, i) => ({
  id: 100 - i,
  kind: 'character' as const,
  name: `First page #${i + 1}`,
  coverImageId: null,
  era: null,
  genre: null,
  data: {},
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  images: [],
}));

const PAGE_TWO = [
  {
    id: 80,
    kind: 'character' as const,
    name: 'Second-page only',
    coverImageId: null,
    era: null,
    genre: null,
    data: {},
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    images: [],
  },
];

vi.mock('@/lib/trpc', () =>
  createTrpcMock({
    infiniteQuery: {
      'assets.list': (_input, cursor) => {
        if (cursor == null) return { items: PAGE_ONE, nextCursor: 81 };
        return { items: PAGE_TWO, nextCursor: null };
      },
    },
  }),
);

import { AssetLibrary } from '../AssetLibrary';

describe('AssetLibrary pagination', () => {
  it('renders page 1 and loads page 2 from the server cursor', async () => {
    render(
      <NuqsTestingAdapter>
        <AssetLibrary kind="character" filterFields={[]} />
      </NuqsTestingAdapter>,
    );

    expect(screen.getByText('First page #1')).toBeInTheDocument();
    expect(screen.queryByText('Second-page only')).toBeNull();

    const more = screen.getByRole('button', { name: /加载更多/ });
    await userEvent.click(more);

    expect(await screen.findByText('Second-page only')).toBeInTheDocument();
  });
});
