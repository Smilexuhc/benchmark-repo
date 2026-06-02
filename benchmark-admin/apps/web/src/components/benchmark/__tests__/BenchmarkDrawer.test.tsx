import { createTrpcMock } from '@/test/trpc-mock';
/**
 * Smoke test for BenchmarkDrawer's keepDirtyValues preservation (P1 from
 * JUJ-22). Mirrors the CharacterDrawer test but for the benchmark form.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

type BenchmarkRow = {
  id: number;
  shotType: string;
  taskType: string;
  questionType: string;
  manualTag: string;
  scene: string;
  screenSize: string;
  categoryL1: string;
  categoryL2: string;
  categoryL3: string;
  categoryDefinition: string;
  difficulty: string;
  textPrompt: string;
  judgingCriteria: string;
  score: number | null;
  needsRevision: boolean;
  media: {
    character_image: { mediaId: number }[];
    scene_image: { mediaId: number }[];
    prop_image: { mediaId: number }[];
    audio_input: { mediaId: number }[];
    video_input: { mediaId: number }[];
    video_output: { mediaId: number }[];
  };
};

let live: BenchmarkRow = {
  id: 42,
  shotType: '',
  taskType: '',
  questionType: '',
  manualTag: '',
  scene: 'original scene',
  screenSize: '',
  categoryL1: '',
  categoryL2: '',
  categoryL3: '',
  categoryDefinition: '',
  difficulty: '',
  textPrompt: 'original prompt',
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

// Capture the create payload the drawer sends so we can assert the V3 category
// fields ride along in the mutation input.
let capturedCreate: Record<string, unknown> | undefined;

vi.mock('@/lib/trpc', () =>
  createTrpcMock({
    query: {
      'benchmark.get': () => live,
      'benchmark.comments.list': () => [],
      'benchmark.stats': () => ({ groups: [], todayNew: 0 }),
    },
    mutation: {
      'benchmark.update': async () => live,
      'benchmark.create': async (input) => {
        capturedCreate = input as Record<string, unknown>;
        return live;
      },
      'benchmark.comments.add': async () => undefined,
      'benchmark.comments.delete': async () => undefined,
    },
  }),
);

import { BenchmarkDrawer } from '../BenchmarkDrawer';

describe('BenchmarkDrawer', () => {
  it('keeps unsaved edits when fresh server data arrives', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const { rerender } = render(<BenchmarkDrawer id={42} onClose={onClose} onSaved={onSaved} />);

    const user = userEvent.setup();
    const prompt = screen.getByDisplayValue('original prompt');
    await user.clear(prompt);
    await user.type(prompt, 'USER EDIT');

    // Server-side change underneath.
    live = { ...live, textPrompt: 'stale server prompt' };
    await act(async () => {
      rerender(<BenchmarkDrawer id={42} onClose={onClose} onSaved={onSaved} />);
    });

    expect(screen.getByDisplayValue('USER EDIT')).toBeInTheDocument();
  });

  it('cascades l1 → l2 → l3 via the shared Cascader and fills the definition', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<BenchmarkDrawer id={0} onClose={onClose} onSaved={onSaved} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '分类' }));

    // Walking the popover columns: click l1, then l2, then the l3 leaf which
    // commits the path and closes the popover.
    await user.click(await screen.findByRole('option', { name: /1 单镜头/ }));
    await user.click(await screen.findByRole('option', { name: /1\.1 提示词遵循\/参考绑定/ }));
    await user.click(await screen.findByRole('option', { name: /1\.1\.1 核心文本指令遵循/ }));

    expect(
      screen.getByText(/检查文本指令中的主体、动作、场景、情绪和基础要求是否被正确执行/),
    ).toBeInTheDocument();
  });

  it('sends all four category fields in the create payload', async () => {
    capturedCreate = undefined;
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<BenchmarkDrawer id={0} onClose={onClose} onSaved={onSaved} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '分类' }));
    await user.click(await screen.findByRole('option', { name: /1 单镜头/ }));
    await user.click(await screen.findByRole('option', { name: /1\.1 提示词遵循\/参考绑定/ }));
    await user.click(await screen.findByRole('option', { name: /1\.1\.1 核心文本指令遵循/ }));

    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(capturedCreate).toBeTruthy());
    expect(capturedCreate).toMatchObject({
      categoryL1: '单镜头',
      categoryL2: '提示词遵循/参考绑定',
      categoryL3: '核心文本指令遵循',
      categoryDefinition: '检查文本指令中的主体、动作、场景、情绪和基础要求是否被正确执行',
    });
  });

  it('pre-fills the cascader trigger and definition when editing an existing item', async () => {
    live = {
      ...live,
      categoryL1: '单镜头',
      categoryL2: '提示词遵循/参考绑定',
      categoryL3: '核心文本指令遵循',
      categoryDefinition: '检查文本指令中的主体、动作、场景、情绪和基础要求是否被正确执行',
    };
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<BenchmarkDrawer id={42} onClose={onClose} onSaved={onSaved} />);

    const trigger = await screen.findByRole('button', { name: '分类' });
    // Cascader trigger shows the current path joined by ' / '.
    expect(trigger).toHaveTextContent('1 单镜头');
    expect(trigger).toHaveTextContent('1.1 提示词遵循/参考绑定');
    expect(trigger).toHaveTextContent('1.1.1 核心文本指令遵循');
    expect(
      screen.getByText(/出题意图：检查文本指令中的主体、动作、场景、情绪和基础要求是否被正确执行/),
    ).toBeInTheDocument();
  });

  it('renders the embedded comments by default when editing an item', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<BenchmarkDrawer id={42} onClose={onClose} onSaved={onSaved} />);

    expect(await screen.findByRole('heading', { name: '评论' })).toBeInTheDocument();
  });

  it('shows 未评分 and gray highlight when score is null', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<BenchmarkDrawer id={0} onClose={onClose} onSaved={onSaved} />);

    const noScore = screen.getByRole('button', { name: '未评分' });
    expect(noScore).toHaveAttribute('aria-pressed', 'true');
    expect(noScore.className).toMatch(/bg-gray-100/);
  });

  it('paints the active score button with the scoreColor token', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<BenchmarkDrawer id={0} onClose={onClose} onSaved={onSaved} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '评分 4' }));
    expect(screen.getByRole('button', { name: '评分 4' })).toHaveClass('bg-emerald-500');

    await user.click(screen.getByRole('button', { name: '评分 2' }));
    expect(screen.getByRole('button', { name: '评分 2' })).toHaveClass('bg-blue-500');

    await user.click(screen.getByRole('button', { name: '评分 1' }));
    expect(screen.getByRole('button', { name: '评分 1' })).toHaveClass('bg-orange-500');
  });
});
