/**
 * Tests the BenchmarkList card layout (U8): single Cascader category filter,
 * the simplified label set (分类 / 镜头 / 任务 / 难度 / 评分 / 评论), and that
 * the row renders as a BenchmarkCard with the leaf category in the title.
 *
 * Also covers the CommentDrawer header toggle (legacy parity with PR #20):
 * clicking 评论 opens the drawer; the drawer header shows 标记待修改 / 取消待修改
 * that fires benchmark.setNeedsRevision.
 */
import { render, screen, within } from '@testing-library/react';
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
  commentCount: 0,
  createdAt: new Date().toISOString(),
  media: {
    character_image: [],
    scene_image: [],
    prop_image: [],
    audio_input: [],
    video_input: [],
    video_output: [],
  },
};

const setNeedsRevisionCalls: { id: number; needsRevision: boolean }[] = [];

vi.mock('@/components/feedback', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
  confirm: vi.fn(async () => true),
}));

vi.mock('@/lib/trpc', () =>
  createTrpcMock({
    query: {
      'exports.getDownloadUrl': () => ({ url: '/api/export/benchmark.zip' }),
      'benchmark.stats': () => ({ todayNew: 0, groups: [] }),
      'benchmark.comments.list': () => [],
    },
    infiniteQuery: {
      'benchmark.list': () => ({ items: [ITEM], total: 1, nextCursor: null }),
    },
    mutation: {
      'benchmark.setNeedsRevision': (input) => {
        setNeedsRevisionCalls.push(input as { id: number; needsRevision: boolean });
        return { id: (input as { id: number }).id, needsRevision: true };
      },
    },
  }),
);

import { LightboxProvider } from '@/components/ui/lightbox';
import { BenchmarkList } from '../BenchmarkList';

function renderList() {
  return render(
    <NuqsTestingAdapter>
      <LightboxProvider>
        <BenchmarkList />
      </LightboxProvider>
    </NuqsTestingAdapter>,
  );
}

describe('BenchmarkList card layout', () => {
  it('renders the simplified filter labels in the DOM', () => {
    renderList();

    expect(screen.getByRole('button', { name: '分类' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '镜头' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '任务' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '难度' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '评分' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '评论' })).toBeInTheDocument();
  });

  it('renders the leaf category in the card title', async () => {
    renderList();

    const card = (await screen.findByText('#7')).closest(
      '[data-benchmark-card-id]',
    ) as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByTitle(/人脸与身份稳定性/)).toBeInTheDocument();
  });
});

describe('BenchmarkList comment drawer 标记待修改 toggle', () => {
  it('opens the comment drawer with 标记待修改 in the header and fires setNeedsRevision on click', async () => {
    setNeedsRevisionCalls.length = 0;
    renderList();
    const user = userEvent.setup();

    // ITEM has needsRevision=false → button reads 标记待修改; click the
    // 评论 pill on the card to open the drawer first.
    await user.click(await screen.findByRole('button', { name: /评论/ }));
    const dialog = await screen.findByRole('dialog', { name: /评论 · 题目 #7/ });
    const toggle = within(dialog).getByRole('button', { name: '标记待修改' });

    await user.click(toggle);

    expect(setNeedsRevisionCalls).toEqual([{ id: 7, needsRevision: true }]);
  });
});
