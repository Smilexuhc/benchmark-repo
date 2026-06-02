/**
 * Smoke test for BenchmarkDrawer's keepDirtyValues preservation (P1 from
 * JUJ-22). Mirrors the CharacterDrawer test but for the benchmark form.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createTrpcMock } from '@/test/trpc-mock';

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

  it('cascades l1 → l2 → l3 and auto-fills the definition', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<BenchmarkDrawer id={0} onClose={onClose} onSaved={onSaved} />);

    const user = userEvent.setup();
    const l1 = screen.getByRole('combobox', { name: '一级分类' });
    const l2 = screen.getByRole('combobox', { name: '二级分类' });
    const l3 = screen.getByRole('combobox', { name: '三级分类' });

    // l2/l3 are disabled until their parent is chosen.
    expect(l2).toBeDisabled();
    expect(l3).toBeDisabled();

    await user.selectOptions(l1, '单镜头');
    expect(l2).toBeEnabled();
    expect(l3).toBeDisabled();

    await user.selectOptions(l2, '提示词遵循/参考绑定');
    expect(l3).toBeEnabled();

    await user.selectOptions(l3, '核心文本指令遵循');

    expect(
      screen.getByText(/检查文本指令中的主体、动作、场景、情绪和基础要求是否被正确执行/),
    ).toBeInTheDocument();
  });

  it('selecting a new l1 resets stale l2/l3 selections', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<BenchmarkDrawer id={0} onClose={onClose} onSaved={onSaved} />);

    const user = userEvent.setup();
    const l1 = screen.getByRole('combobox', { name: '一级分类' });
    const l2 = screen.getByRole('combobox', { name: '二级分类' });
    const l3 = screen.getByRole('combobox', { name: '三级分类' });

    await user.selectOptions(l1, '单镜头');
    await user.selectOptions(l2, '提示词遵循/参考绑定');
    await user.selectOptions(l3, '核心文本指令遵循');
    expect(l3).toHaveValue('核心文本指令遵循');

    // Switching l1 must clear the now-invalid l2/l3.
    await user.selectOptions(l1, '长镜头');
    expect(l2).toHaveValue('');
    expect(l3).toHaveValue('');
    expect(l3).toBeDisabled();
  });

  it('sends all four category fields in the create payload', async () => {
    capturedCreate = undefined;
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<BenchmarkDrawer id={0} onClose={onClose} onSaved={onSaved} />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: '一级分类' }), '单镜头');
    await user.selectOptions(
      screen.getByRole('combobox', { name: '二级分类' }),
      '提示词遵循/参考绑定',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: '三级分类' }),
      '核心文本指令遵循',
    );

    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(capturedCreate).toBeTruthy());
    expect(capturedCreate).toMatchObject({
      categoryL1: '单镜头',
      categoryL2: '提示词遵循/参考绑定',
      categoryL3: '核心文本指令遵循',
      categoryDefinition: '检查文本指令中的主体、动作、场景、情绪和基础要求是否被正确执行',
    });
  });

  it('pre-selects categories and shows the definition when editing an existing item', async () => {
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

    expect(await screen.findByRole('combobox', { name: '三级分类' })).toHaveValue(
      '核心文本指令遵循',
    );
    expect(screen.getByRole('combobox', { name: '一级分类' })).toHaveValue('单镜头');
    expect(screen.getByRole('combobox', { name: '二级分类' })).toHaveValue('提示词遵循/参考绑定');
    expect(
      screen.getByText(/出题意图：检查文本指令中的主体、动作、场景、情绪和基础要求是否被正确执行/),
    ).toBeInTheDocument();
  });
});
