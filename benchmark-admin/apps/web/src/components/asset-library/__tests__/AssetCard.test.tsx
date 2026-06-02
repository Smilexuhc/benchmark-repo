/**
 * AssetCard (U5) — wholesale 4-column legacy layout.
 *
 * Coverage matches the U5 acceptance bullets in BEN-11:
 * - kind-specific info renderers (character / scene / prop) with field labels
 * - prop name fallback `(未命名道具)` — never UUID/filename (Codex P2)
 * - scene `关键元素` row (Codex S3)
 * - lightbox open on cover click, with onSetCover wiring + toast on success
 * - Copy prompt → toast.success('提示词已复制')
 * - 重新生成 swaps the image col to a spinner while pending
 * - deleted state shows opacity-60 + 已删除 corner badge
 * - selectMode shows / hides the 44px checkbox lane
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LightboxProvider } from '@/components/ui/lightbox';
import { Toaster } from '@/components/feedback/toast';
import { AssetCard } from '../AssetCard';
import type {
  AssetCardData,
  CharacterCardData,
  PropCardData,
  SceneCardData,
} from '../AssetCard.types';

function withProviders(ui: React.ReactNode) {
  return (
    <LightboxProvider>
      <Toaster />
      {ui}
    </LightboxProvider>
  );
}

function characterAsset(overrides: Partial<CharacterCardData> = {}): CharacterCardData {
  return {
    kind: 'character',
    id: 1,
    name: '原始名字',
    era: '现代',
    genre: '都市',
    coverImageId: 11,
    images: [
      { id: 11, url: 'https://example.test/img/cover.png' },
      { id: 12, url: 'https://example.test/img/alt.png' },
    ],
    deletedAt: null,
    data: {
      persona: '林夕',
      type: '人类',
      gender: '女',
      age: '青年',
      body: '高挑',
      features: '短发',
      prompt: 'a prompt body',
    },
    ...overrides,
  };
}

function sceneAsset(overrides: Partial<SceneCardData> = {}): SceneCardData {
  return {
    kind: 'scene',
    id: 2,
    name: '雨夜街角',
    era: '现代',
    genre: '都市',
    coverImageId: 21,
    images: [{ id: 21, url: 'https://example.test/scene/cover.png' }],
    deletedAt: null,
    data: {
      scene_type: '街景',
      mood: '阴郁',
      elements: ['霓虹灯', '湿滑路面'],
      prompt: 'a scene prompt',
    },
    ...overrides,
  };
}

function propAsset(overrides: Partial<PropCardData> = {}): PropCardData {
  return {
    kind: 'prop',
    id: 3,
    name: '雕花匕首',
    era: null,
    genre: null,
    coverImageId: null,
    images: [],
    deletedAt: null,
    data: { category: '武器', prompt: '' },
    ...overrides,
  };
}

function defaultHandlers() {
  return {
    onEdit: vi.fn(),
    onSetCover: vi.fn(),
    onRegenerate: vi.fn(),
    onDownload: vi.fn(),
  };
}

describe('AssetCard — character', () => {
  it('renders persona as title with era·type·gender·age subtitle and InfoRows', () => {
    const handlers = defaultHandlers();
    render(withProviders(<AssetCard asset={characterAsset()} {...handlers} />));

    expect(screen.getByText('林夕')).toBeInTheDocument();
    expect(screen.getByText('现代 · 人类 · 女 · 青年')).toBeInTheDocument();
    expect(screen.getByText('身材')).toBeInTheDocument();
    expect(screen.getByText('高挑')).toBeInTheDocument();
    expect(screen.getByText('特征')).toBeInTheDocument();
    expect(screen.getByText('短发')).toBeInTheDocument();
    expect(screen.getByText('都市')).toBeInTheDocument(); // genre tag
  });

  it('Copy prompt fires clipboard write + success toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const handlers = defaultHandlers();
    render(withProviders(<AssetCard asset={characterAsset()} {...handlers} />));

    await userEvent.click(screen.getByRole('button', { name: '复制' }));

    expect(writeText).toHaveBeenCalledWith('a prompt body');
    expect(await screen.findByText('提示词已复制')).toBeInTheDocument();
  });

  it('clicking the cover opens the lightbox; setCover fires the handler', async () => {
    const handlers = defaultHandlers();
    render(withProviders(<AssetCard asset={characterAsset()} {...handlers} />));

    await userEvent.click(screen.getByRole('button', { name: '查看大图' }));
    // Lightbox mounts a portal labeled `图片预览`.
    expect(await screen.findByRole('dialog', { name: '图片预览' })).toBeInTheDocument();
    // Counter shows index 1 of 2 because the cover (id 11) is the first image.
    expect(screen.getByLabelText('counter')).toHaveTextContent('1/2');

    // Walk to the next image so the cover button is "Set as default".
    await userEvent.click(screen.getByRole('button', { name: '下一张' }));
    await userEvent.click(screen.getByRole('button', { name: '设为默认图' }));
    expect(handlers.onSetCover).toHaveBeenCalledWith(12);
  });

  it('重新生成 button delegates to onRegenerate', async () => {
    const handlers = defaultHandlers();
    render(withProviders(<AssetCard asset={characterAsset()} {...handlers} />));
    await userEvent.click(screen.getByRole('button', { name: '重新生成' }));
    expect(handlers.onRegenerate).toHaveBeenCalledWith(1);
  });

  it('generating=true swaps the image col to spinner + "生成中" copy', () => {
    const handlers = defaultHandlers();
    render(withProviders(<AssetCard asset={characterAsset()} {...handlers} generating />));
    expect(screen.getByRole('status', { name: '生成中' })).toBeInTheDocument();
    expect(screen.getByText('生成中,约 1 分钟…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看大图' })).toBeNull();
  });

  it('deleted asset renders the corner badge and opacity-60', () => {
    const asset = characterAsset({ deletedAt: new Date('2026-01-01') });
    const handlers = defaultHandlers();
    render(withProviders(<AssetCard asset={asset} {...handlers} />));
    const badge = screen.getByText('已删除');
    expect(badge).toBeInTheDocument();
    // The badge is a direct child of the card root, so walking one parent up
    // gives us the dim-styled container. Test by class signature rather than a
    // DOM-position assertion that breaks if the provider wrapper changes shape.
    expect(badge.parentElement).toHaveClass('opacity-60');
  });

  it('selectMode shows the 44px checkbox lane and dispatches onToggleSelect', async () => {
    const handlers = defaultHandlers();
    const onToggleSelect = vi.fn();
    render(
      withProviders(
        <AssetCard
          asset={characterAsset()}
          {...handlers}
          selectMode
          selected={false}
          onToggleSelect={onToggleSelect}
        />,
      ),
    );
    const lane = screen.getByRole('button', { name: '选中' });
    expect(lane).toBeInTheDocument();
    await userEvent.click(lane);
    expect(onToggleSelect).toHaveBeenCalledWith(1);
  });

  it('selectMode=false hides the checkbox lane', () => {
    const handlers = defaultHandlers();
    render(withProviders(<AssetCard asset={characterAsset()} {...handlers} />));
    expect(screen.queryByRole('button', { name: /选中/ })).toBeNull();
  });
});

describe('AssetCard — scene', () => {
  it('renders 关键元素 row (Codex S3)', () => {
    const handlers = defaultHandlers();
    render(withProviders(<AssetCard asset={sceneAsset()} {...handlers} />));
    expect(screen.getByText('关键元素')).toBeInTheDocument();
    expect(screen.getByText('霓虹灯, 湿滑路面')).toBeInTheDocument();
  });

  it('renderExtra mounts a 4th column for scene multi-view', () => {
    const handlers = defaultHandlers();
    render(
      withProviders(
        <AssetCard
          asset={sceneAsset()}
          {...handlers}
          renderExtra={() => <div data-testid="scene-extra">multi-view</div>}
        />,
      ),
    );
    expect(screen.getByTestId('scene-extra')).toHaveTextContent('multi-view');
  });
});

describe('AssetCard — prop', () => {
  it('uses asset.name as title (not UUID/filename)', () => {
    const handlers = defaultHandlers();
    const asset: AssetCardData = propAsset();
    render(withProviders(<AssetCard asset={asset} {...handlers} />));
    expect(screen.getByText('雕花匕首')).toBeInTheDocument();
    expect(screen.getByText('武器')).toBeInTheDocument(); // category tag
  });

  it('falls back to "(未命名道具)" when name is empty — never UUID (Codex P2)', () => {
    const handlers = defaultHandlers();
    const asset = propAsset({ name: '' });
    render(withProviders(<AssetCard asset={asset} {...handlers} />));
    expect(screen.getByText('(未命名道具)')).toBeInTheDocument();
  });
});
