/**
 * Tests the StatsDashboard V3 category breakdown (U5): the l1/l2/l3 column
 * headers, per-group counts, and the "—" fallback for groups whose category
 * levels are empty (legacy / uncategorized items).
 */
import { render, screen, within } from '@testing-library/react';
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
  it('renders l1/l2/l3 column headers and the per-group leaf + count', () => {
    render(<StatsDashboard />);

    expect(screen.getByText('一级分类')).toBeInTheDocument();
    expect(screen.getByText('二级分类')).toBeInTheDocument();
    expect(screen.getByText('三级分类')).toBeInTheDocument();
    expect(screen.getByText('人脸与身份稳定性')).toBeInTheDocument();
  });

  it('shows the — fallback for a group whose category levels are empty', () => {
    render(<StatsDashboard />);

    const emptyRow = screen.getByText('3').closest('tr');
    expect(emptyRow).not.toBeNull();
    expect(within(emptyRow as HTMLElement).getAllByText('—')).toHaveLength(3);
  });
});
