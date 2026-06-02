/**
 * Tests the StatsDashboard V3 category breakdown (U5): the l1/l2/l3 column
 * headers, per-group counts, and the "—" fallback for groups whose category
 * levels are empty (legacy / uncategorized items). The card collapses by
 * default (U8), so each case clicks the toggle before asserting body content.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createTrpcMock } from '@/test/trpc-mock';

vi.mock('@/lib/trpc', () =>
  createTrpcMock({
    query: {
      'benchmark.stats': () => ({
        todayNew: 2,
        groups: [
          {
            categoryL1: '单镜头',
            categoryL2: '人物与角色',
            categoryL3: '人脸与身份稳定性',
            count: 5,
          },
          { categoryL1: '', categoryL2: '', categoryL3: '', count: 3 },
        ],
      }),
    },
  }),
);

import { StatsDashboard } from '../StatsDashboard';

describe('StatsDashboard category columns', () => {
  it('starts collapsed and shows the per-category table after expanding', async () => {
    render(<StatsDashboard />);

    // Body is hidden by default — the toggle button is the only thing rendered
    // outside the header summary.
    expect(screen.queryByText('一级分类')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { expanded: false }));

    expect(screen.getByText('一级分类')).toBeInTheDocument();
    expect(screen.getByText('二级分类')).toBeInTheDocument();
    expect(screen.getByText('三级分类')).toBeInTheDocument();
    expect(screen.getByText('人脸与身份稳定性')).toBeInTheDocument();
  });

  it('shows the — fallback for a group whose category levels are empty', async () => {
    render(<StatsDashboard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { expanded: false }));

    const emptyRow = screen.getByText('3').closest('tr');
    expect(emptyRow).not.toBeNull();
    expect(within(emptyRow as HTMLElement).getAllByText('—')).toHaveLength(3);
  });
});
