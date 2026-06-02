/**
 * Tests the BatchToolbar U7 flow: enter batch mode → confirm → sequential
 * generateImage per selected item → live progress + 当前项 + stop → completion
 * toast. AE9 acceptance criteria from BEN-13.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetCardData } from '../AssetCard';

// Hoisted mutable hook so each test can swap in its own generateImage behavior.
const generateImageImpl = vi.hoisted(() => ({
  fn: vi.fn<(input: { id: number; prompt: string }) => Promise<unknown>>(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    ai: {
      generateImage: {
        useMutation: () => ({
          mutateAsync: (input: { id: number; prompt: string }) =>
            generateImageImpl.fn(input),
          isPending: false,
        }),
      },
    },
  },
}));

// Test-controllable confirm + toast modules. Each test sets confirmResult
// before clicking 开始; toast mocks let us assert what was announced.
const confirmResult = vi.hoisted(() => ({ value: true as boolean }));
vi.mock('@/components/feedback/confirm', () => ({
  confirm: vi.fn(async () => confirmResult.value),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/components/feedback/toast', () => ({ toast: toastMock }));

import { confirm } from '@/components/feedback/confirm';
import { BatchToolbar } from '../BatchToolbar';

function makeItem(id: number, name: string, prompt: string | null = `prompt-${id}`): AssetCardData {
  return {
    kind: 'character',
    id,
    name,
    coverImageId: null,
    images: [],
    era: null,
    genre: null,
    data: prompt === null ? {} : { prompt },
  };
}

type RenderOpts = Partial<React.ComponentProps<typeof BatchToolbar>> & {
  initiallyInSelectMode?: boolean;
};

function renderToolbar(opts: RenderOpts = {}) {
  const items = opts.items ?? [
    makeItem(1, 'Alpha'),
    makeItem(2, 'Beta'),
    makeItem(3, 'Gamma'),
  ];
  let selectMode = opts.initiallyInSelectMode ?? false;
  let selectedIds = opts.selectedIds ?? [];

  const onSelectedIdsChange = vi.fn((ids: number[]) => {
    selectedIds = ids;
    rerender();
  });
  const onEnterSelectMode = vi.fn(() => {
    selectMode = true;
    rerender();
  });
  const onExitSelectMode = vi.fn(() => {
    selectMode = false;
    rerender();
  });

  function ui() {
    return (
      <BatchToolbar
        kind="character"
        items={items}
        selectMode={selectMode}
        onEnterSelectMode={onEnterSelectMode}
        onExitSelectMode={onExitSelectMode}
        selectedIds={selectedIds}
        onSelectedIdsChange={onSelectedIdsChange}
        onNewClick={opts.onNewClick}
        newLabel={opts.newLabel}
        exportHref={opts.exportHref}
      />
    );
  }

  const view = render(ui());
  const rerender = () => view.rerender(ui());

  return {
    ...view,
    onSelectedIdsChange,
    onEnterSelectMode,
    onExitSelectMode,
    getSelectedIds: () => selectedIds,
  };
}

beforeEach(() => {
  generateImageImpl.fn.mockReset();
  generateImageImpl.fn.mockResolvedValue({});
  confirmResult.value = true;
  vi.mocked(confirm).mockClear();
  toastMock.success.mockClear();
  toastMock.info.mockClear();
  toastMock.warning.mockClear();
  toastMock.error.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BatchToolbar — outside select mode', () => {
  it('renders 批量生成 + 新建 + 导出资产包 in outside-select state', () => {
    renderToolbar({ onNewClick: vi.fn(), newLabel: '新建角色', exportHref: '/export.zip' });
    expect(screen.getByRole('button', { name: '批量生成' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建角色' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出资产包' })).toBeInTheDocument();
  });

  it('clicking 批量生成 enters select mode', async () => {
    const { onEnterSelectMode } = renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: '批量生成' }));
    expect(onEnterSelectMode).toHaveBeenCalledTimes(1);
  });
});

describe('BatchToolbar — select mode idle', () => {
  it('shows 已选 N/M counter that reflects selectedIds', () => {
    renderToolbar({ initiallyInSelectMode: true, selectedIds: [1, 3] });
    expect(screen.getByText('已选 2/3')).toBeInTheDocument();
  });

  it('全选当前 selects every item currently in view', async () => {
    const { onSelectedIdsChange } = renderToolbar({ initiallyInSelectMode: true });
    await userEvent.click(screen.getByRole('button', { name: '全选当前' }));
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith([1, 2, 3]);
  });

  it('清空 clears the selection', async () => {
    const { onSelectedIdsChange } = renderToolbar({
      initiallyInSelectMode: true,
      selectedIds: [1, 2],
    });
    await userEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith([]);
  });

  it('退出 exits batch mode and clears selection without running', async () => {
    const { onExitSelectMode, onSelectedIdsChange } = renderToolbar({
      initiallyInSelectMode: true,
      selectedIds: [1],
    });
    await userEvent.click(screen.getByRole('button', { name: '退出' }));
    expect(onExitSelectMode).toHaveBeenCalledTimes(1);
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith([]);
    expect(generateImageImpl.fn).not.toHaveBeenCalled();
  });
});

describe('BatchToolbar — run flow', () => {
  it('warns when every selected item has no prompt and never confirms', async () => {
    const items = [
      makeItem(1, 'Alpha', null),
      makeItem(2, 'Beta', '   '),
    ];
    renderToolbar({ initiallyInSelectMode: true, selectedIds: [1, 2], items });
    await userEvent.click(screen.getByRole('button', { name: '开始重新生成' }));
    expect(toastMock.warning).toHaveBeenCalledWith('选中的项都没有提示词');
    expect(confirm).not.toHaveBeenCalled();
    expect(generateImageImpl.fn).not.toHaveBeenCalled();
  });

  it('confirms with the runnable count, then fires generateImage once per item with a prompt', async () => {
    const items = [
      makeItem(1, 'Alpha'),
      makeItem(2, 'Beta', null), // skipped
      makeItem(3, 'Gamma'),
    ];
    renderToolbar({ initiallyInSelectMode: true, selectedIds: [1, 2, 3], items });
    await userEvent.click(screen.getByRole('button', { name: '开始重新生成' }));

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: '批量重新生成 2 项？' }),
    );

    await waitFor(() => {
      expect(generateImageImpl.fn).toHaveBeenCalledTimes(2);
    });
    expect(generateImageImpl.fn).toHaveBeenNthCalledWith(1, {
      kind: 'character',
      id: 1,
      prompt: 'prompt-1',
    });
    expect(generateImageImpl.fn).toHaveBeenNthCalledWith(2, {
      kind: 'character',
      id: 3,
      prompt: 'prompt-3',
    });
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith('批量生成完成：2 个');
    });
  });

  it('cancelling the confirm modal aborts the run', async () => {
    confirmResult.value = false;
    renderToolbar({ initiallyInSelectMode: true, selectedIds: [1, 2] });
    await userEvent.click(screen.getByRole('button', { name: '开始重新生成' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(generateImageImpl.fn).not.toHaveBeenCalled();
  });

  it('停止 halts the loop and announces the partial completion count', async () => {
    // Hold the second call open until we click 停止, then resolve so the loop
    // exits via the stop check at the top of the next iteration.
    let releaseSecond: (() => void) | undefined;
    generateImageImpl.fn
      .mockResolvedValueOnce({})
      .mockImplementationOnce(
        () => new Promise<unknown>((res) => {
          releaseSecond = () => res({});
        }),
      );

    renderToolbar({ initiallyInSelectMode: true, selectedIds: [1, 2, 3] });
    await userEvent.click(screen.getByRole('button', { name: '开始重新生成' }));

    // Wait until the second mutation is in flight, then click 停止.
    await waitFor(() => {
      expect(generateImageImpl.fn).toHaveBeenCalledTimes(2);
    });
    await userEvent.click(screen.getByRole('button', { name: /停止/ }));
    await act(async () => {
      releaseSecond?.();
    });

    await waitFor(() => {
      expect(toastMock.info).toHaveBeenCalledWith('已停止，完成 2 个');
    });
    // The third item must never run.
    expect(generateImageImpl.fn).toHaveBeenCalledTimes(2);
  });

  it('mid-loop error stops the run and reports the item by name', async () => {
    generateImageImpl.fn
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('quota exceeded'));

    renderToolbar({ initiallyInSelectMode: true, selectedIds: [1, 2, 3] });
    await userEvent.click(screen.getByRole('button', { name: '开始重新生成' }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith('「Beta」失败：quota exceeded');
    });
    // Third item must not run after the failure.
    expect(generateImageImpl.fn).toHaveBeenCalledTimes(2);
  });

  it('completion toast carries the count and auto-exits batch mode', async () => {
    const { onExitSelectMode } = renderToolbar({
      initiallyInSelectMode: true,
      selectedIds: [1, 2],
    });
    await userEvent.click(screen.getByRole('button', { name: '开始重新生成' }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith('批量生成完成：2 个');
    });
    expect(onExitSelectMode).toHaveBeenCalled();
  });
});
