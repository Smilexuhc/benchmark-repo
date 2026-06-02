/**
 * Tests the BenchmarkList V3 category filter (U5): the l1 → l2 → l3 cascade in
 * the filter bar, reset-on-parent-change, and that the leaf category surfaces
 * in the row layout.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { describe, expect, it, vi } from 'vitest';
import { createTrpcMock } from '@/test/trpc-mock';

const ITEM = {
  id: 7,
  shotType: '单镜头',
  taskType: '',
  questionType: '',
  manualTag: '',
  scene: 'a scene',
  screenSize: '16:9',
  categoryL1: '单镜头',
  categoryL2: '人物与角色',
  categoryL3: '人脸与身份稳定性',
  categoryDefinition: '',
  difficulty: '中',
  textPrompt: '',
  judgingCriteria: '',
  score: null,
  needsRevision: false,
  media: {
    character_image: [],
    scene_image: [],
    prop_image: [],
    audio_input: [],
    video_input: [],
    video_output: [],
  },
};

// Capture the request params the filter bar produces. The list is an
// infiniteQuery whose handler the mock only invokes once (in a useState
// initializer), so we assert against the export query instead — it re-reads the
// same category filters on every render, making it a faithful proxy for what the
// list request carries. The handler runs lazily at render time, so reading this
// module-level array from the closure is safe under vi.mock hoisting.
const exportInputs: Record<string, unknown>[] = [];

vi.mock('@/lib/trpc', () =>
  createTrpcMock({
    query: {
      'exports.getDownloadUrl': (input) => {
        exportInputs.push(input as Record<string, unknown>);
        return { url: '/api/export/benchmark.zip' };
      },
    },
    infiniteQuery: {
      'benchmark.list': () => ({ items: [ITEM], total: 1, nextCursor: null }),
    },
  }),
);

import { BenchmarkList } from '../BenchmarkList';

describe('BenchmarkList category filter', () => {
  it('cascades l1 → l2 → l3, enabling children as parents are chosen', async () => {
    render(
      <NuqsTestingAdapter>
        <BenchmarkList />
      </NuqsTestingAdapter>,
    );

    const user = userEvent.setup();
    const l1 = screen.getByRole('combobox', { name: '一级分类' });
    const l2 = screen.getByRole('combobox', { name: '二级分类' });
    const l3 = screen.getByRole('combobox', { name: '三级分类' });

    expect(l2).toBeDisabled();
    expect(l3).toBeDisabled();

    await user.selectOptions(l1, '单镜头');
    expect(l2).toBeEnabled();
    expect(l3).toBeDisabled();

    await user.selectOptions(l2, '人物与角色');
    expect(l3).toBeEnabled();
  });

  it('resets stale l2/l3 when a new l1 is chosen', async () => {
    render(
      <NuqsTestingAdapter>
        <BenchmarkList />
      </NuqsTestingAdapter>,
    );

    const user = userEvent.setup();
    const l1 = screen.getByRole('combobox', { name: '一级分类' });
    const l2 = screen.getByRole('combobox', { name: '二级分类' });
    const l3 = screen.getByRole('combobox', { name: '三级分类' });

    await user.selectOptions(l1, '单镜头');
    await user.selectOptions(l2, '人物与角色');
    expect(l3).toBeEnabled();

    // Switching l1 must clear the now-invalid l2/l3 (l3 falls back to disabled).
    await user.selectOptions(l1, '长镜头');
    expect(l3).toBeDisabled();
  });

  it('surfaces the leaf category in the row', async () => {
    render(
      <NuqsTestingAdapter>
        <BenchmarkList />
      </NuqsTestingAdapter>,
    );

    const row = (await screen.findByText('#7')).closest('div.grid');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('人脸与身份稳定性')).toBeInTheDocument();
  });

  it('drops stale l2/l3 from the request params when a new l1 is chosen', async () => {
    render(
      <NuqsTestingAdapter>
        <BenchmarkList />
      </NuqsTestingAdapter>,
    );

    const user = userEvent.setup();
    const l1 = screen.getByRole('combobox', { name: '一级分类' });
    const l2 = screen.getByRole('combobox', { name: '二级分类' });

    await user.selectOptions(l1, '单镜头');
    await user.selectOptions(l2, '人物与角色');
    await waitFor(() => {
      const input = exportInputs[exportInputs.length - 1];
      expect(input?.categoryL2).toBe('人物与角色');
    });

    // Switching l1 must drop the now-invalid l2/l3 from the outgoing request,
    // not just disable the selects in the DOM.
    await user.selectOptions(l1, '长镜头');
    await waitFor(() => {
      const input = exportInputs[exportInputs.length - 1];
      expect(input?.categoryL1).toBe('长镜头');
      expect(input?.categoryL2).toBeUndefined();
      expect(input?.categoryL3).toBeUndefined();
    });
  });
});
