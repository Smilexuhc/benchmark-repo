/**
 * Tests BenchmarkCard's acceptance criteria (U8):
 * - title joins cascader-path labels with " · " and the #id prefix
 * - 评论 N reflects item.commentCount
 * - ExpandableText prompt toggles 展开 / 收起
 * - asset thumbs open the U2 lightbox
 * - scoreColor tier classes follow the 5→green / 3→blue / 1→orange / null→gray rule
 * - inline score editor fires setScore
 *
 * The 标记待修改 / 取消待修改 toggle lives in the comment drawer header (legacy
 * parity with PR #20), so its behaviour is covered in BenchmarkList.test.tsx,
 * not here.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RouterOutputs } from '@/lib/trpc';
import { createTrpcMock } from '@/test/trpc-mock';
import { scoreColorClasses, scoreTier } from '../scoreColor';

type ItemOverrides = Partial<{
  id: number;
  categoryL1: string;
  categoryL2: string;
  categoryL3: string;
  manualTag: string;
  difficulty: string;
  textPrompt: string;
  judgingCriteria: string;
  categoryDefinition: string;
  score: number | null;
  needsRevision: boolean;
  commentCount: number;
  screenSize: string;
  expectedVideoTimeInSec: number | null;
  scene: string;
  characterImages: { id: number; mediaId: number; url: string }[];
  videoOutput: { id: number; mediaId: number; url: string }[];
}>;

function makeLinks(
  links: { id: number; mediaId: number; url: string }[] | undefined,
  role: string,
): RouterOutputs['benchmark']['list']['items'][number]['media']['character_image'] {
  return (links ?? []).map((l) => ({
    id: l.id,
    mediaId: l.mediaId,
    url: l.url,
    role,
    itemId: 0,
    sortOrder: 0,
    createdAt: new Date(),
  }));
}

function makeItem(
  overrides: ItemOverrides = {},
): RouterOutputs['benchmark']['list']['items'][number] {
  return {
    id: overrides.id ?? 42,
    shotType: '单镜头',
    taskType: '',
    questionType: '',
    manualTag: overrides.manualTag ?? '',
    scene: overrides.scene ?? '',
    screenSize: overrides.screenSize ?? '16:9',
    categoryL1: overrides.categoryL1 ?? '单镜头',
    categoryL2: overrides.categoryL2 ?? '人物与角色',
    categoryL3: overrides.categoryL3 ?? '人脸与身份稳定性',
    categoryDefinition: overrides.categoryDefinition ?? '',
    difficulty: overrides.difficulty ?? '',
    textPrompt: overrides.textPrompt ?? '',
    judgingCriteria: overrides.judgingCriteria ?? '',
    score: overrides.score === undefined ? null : overrides.score,
    expectedVideoTimeInSec: overrides.expectedVideoTimeInSec ?? null,
    needsRevision: overrides.needsRevision ?? false,
    commentCount: overrides.commentCount ?? 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    media: {
      character_image: makeLinks(overrides.characterImages, 'character_image'),
      scene_image: [],
      prop_image: [],
      audio_input: [],
      video_input: [],
      video_output: makeLinks(overrides.videoOutput, 'video_output'),
    },
  };
}

const setScoreCalls: { id: number; score: number | null }[] = [];

vi.mock('@/lib/trpc', () =>
  createTrpcMock({
    mutation: {
      'benchmark.setScore': (input) => {
        setScoreCalls.push(input as { id: number; score: number | null });
        return { id: (input as { id: number }).id };
      },
    },
  }),
);

import { LightboxProvider } from '@/components/ui/lightbox';
import { BenchmarkCard } from '../BenchmarkCard';

function renderCard(item: ReturnType<typeof makeItem>) {
  return render(
    <LightboxProvider>
      <BenchmarkCard item={item} onEdit={vi.fn()} onOpenComments={vi.fn()} />
    </LightboxProvider>,
  );
}

describe('BenchmarkCard', () => {
  it('joins the cascader-path labels with " · " and prefixes #id', () => {
    const item = makeItem({ id: 12 });
    renderCard(item);

    expect(screen.getByText('#12')).toBeInTheDocument();
    // Tree maps (单镜头 / 人物与角色 / 人脸与身份稳定性) → (1, 1.2, 1.2.1).
    // Cascader labels prefix the code, joined with the legacy " · " separator.
    expect(
      screen.getByTitle(/1 单镜头.* · .*1\.2 人物与角色.* · .*1\.2\.1 人脸与身份稳定性/),
    ).toBeInTheDocument();
  });

  it('shows 待修改 when needsRevision is set', () => {
    renderCard(makeItem({ needsRevision: true }));
    expect(screen.getAllByText('待修改').length).toBeGreaterThan(0);
  });

  it('reflects commentCount in the 评论 button', () => {
    renderCard(makeItem({ commentCount: 3 }));
    expect(screen.getByRole('button', { name: /评论 3/ })).toBeInTheDocument();
  });

  it('toggles the prompt with 展开 / 收起', async () => {
    renderCard(makeItem({ textPrompt: '一段超长的提示词，应该被两行截断显示。' }));
    const user = userEvent.setup();

    const toggle = screen.getByRole('button', { name: '切换提示词' });
    expect(toggle).toHaveTextContent('展开');
    await user.click(toggle);
    expect(toggle).toHaveTextContent('收起');
  });

  it('opens the U2 lightbox when an asset thumb is clicked', async () => {
    const item = makeItem({
      characterImages: [
        { id: 1, mediaId: 100, url: 'https://example.com/a.png' },
        { id: 2, mediaId: 101, url: 'https://example.com/b.png' },
      ],
    });
    renderCard(item);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /预览 角色 100/ }));
    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument();
  });

  it('paints the scoreColor block using the 5→green / 3→blue / 1→orange / null→gray rule', () => {
    expect(scoreTier(5)).toBe('green');
    expect(scoreTier(3)).toBe('blue');
    expect(scoreTier(1)).toBe('orange');
    expect(scoreTier(null)).toBe('gray');

    expect(scoreColorClasses(5)).toContain('emerald');
    expect(scoreColorClasses(3)).toContain('blue');
    expect(scoreColorClasses(1)).toContain('orange');
    expect(scoreColorClasses(null)).toContain('muted');
  });

  it('fires setScore on inline score change', async () => {
    setScoreCalls.length = 0;
    renderCard(makeItem({ id: 99, score: null }));

    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: '4' }));

    expect(setScoreCalls).toEqual([{ id: 99, score: 4 }]);
  });

  it('renders the output video with the correct aspect ratio', () => {
    const { container } = renderCard(
      makeItem({
        screenSize: '9:16',
        videoOutput: [{ id: 1, mediaId: 7, url: 'https://example.com/v.mp4' }],
      }),
    );
    const wrapper = container.querySelector('video')?.parentElement;
    expect(wrapper?.getAttribute('style')).toContain('aspect-ratio');
    expect(wrapper?.getAttribute('style')).toContain('9 / 16');
  });

  it('shows expected video time in the output header', () => {
    renderCard(makeItem({ expectedVideoTimeInSec: 75 }));
    expect(screen.getByText('视频时长 1分15秒')).toBeInTheDocument();
  });
});

describe('BenchmarkCard chips', () => {
  it('shows difficulty + scene + screenSize chips and dedups manualTag against the leaf', () => {
    renderCard(
      makeItem({
        difficulty: '难',
        scene: '电影 / 预告片',
        screenSize: '2.39:1',
        manualTag: '人脸与身份稳定性', // matches categoryL3 → suppressed
      }),
    );
    expect(screen.getByText('难')).toBeInTheDocument();
    expect(screen.getByText('电影 / 预告片')).toBeInTheDocument();
    expect(screen.getByText('2.39:1')).toBeInTheDocument();
    // categoryL3 is in the title (joined with the path), so it is not also a chip.
    expect(
      within(screen.getByText('#42').parentElement as HTMLElement).queryByText(
        /^人脸与身份稳定性$/,
      ),
    ).not.toBeInTheDocument();
  });
});
