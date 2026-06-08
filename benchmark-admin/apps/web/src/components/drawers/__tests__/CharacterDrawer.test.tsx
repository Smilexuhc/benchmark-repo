import { Toaster } from '@/components/feedback/toast';
import { LightboxProvider } from '@/components/ui/lightbox';
import { createTrpcMock } from '@/test/trpc-mock';
/**
 * U6 — Character Drawer alignment.
 *
 * Covers:
 *  1. AI-patched (dirty) fields survive a server refresh (carried over from
 *     JUJ-22 P1 — keepDirtyValues integration with react-hook-form).
 *  2. `persona` is the required field (not `name`); empty persona shows `必填`.
 *  3. `AI 填入字段` link runs extractFields against the description textarea and
 *     merges the partial result back into the form (with a success toast).
 *  4. AutoComplete allows free-text values not in the options list.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

type AssetRow = {
  id: number;
  kind: 'character';
  name: string;
  era: string | null;
  genre: string | null;
  data: Record<string, string | undefined>;
  coverImageId: number | null;
  images: { id: number; objectKey: string; url: string }[];
  deletedAt?: Date | null;
};

const initialAsset: AssetRow = {
  id: 7,
  kind: 'character',
  name: 'Original',
  era: '现代',
  genre: '都市',
  data: {
    type: '人类',
    gender: '男',
    age: '青年',
    persona: 'original persona',
    body: '',
    features: '',
    prompt: 'original prompt',
    description: 'original desc',
  },
  coverImageId: null,
  images: [],
  deletedAt: null,
};

// The "live" copy returned by assets.get. The test mutates this to simulate
// stale server data, then triggers a refetch via setData (mimicking what
// ctx.refresh() would cause in production).
let liveAsset: AssetRow = structuredClone(initialAsset);

vi.mock('@/lib/trpc', () =>
  createTrpcMock({
    query: {
      'assets.get': () => liveAsset,
      'assets.options': () => ({
        kind: 'character' as const,
        era: ['现代', '古代'],
        genre: ['都市', '玄幻'],
        type: ['人类', '动物'],
        gender: ['男', '女'],
        age: ['青年', '中年'],
      }),
    },
    mutation: {
      'assets.create': async () => ({ ...liveAsset, id: 42 }),
      'assets.update': async () => liveAsset,
      'assets.delete': async () => ({ id: 7 }),
      'assets.restore': async () => liveAsset,
      'assets.deleteImage': async () => undefined,
      'assets.setCover': async () => undefined,
      'assets.attachImage': async () => undefined,
      'mediaAssets.getUploadUrl': async () => ({
        uploadUrl: 'https://example.com/upload',
        objectKey: 'images/abc.png',
      }),
      'ai.generatePrompt': async () => ({ prompt: 'generated' }),
      'ai.generateImage': async () => ({}),
      'ai.extractFields': async () => ({
        kind: 'character' as const,
        data: { prompt: 'ai-patched prompt' },
      }),
    },
  }),
);

import { CharacterDrawer } from '../CharacterDrawer';

// ImageGrid (rendered inside the drawer) calls useLightbox, which throws when
// no LightboxProvider is mounted. Wrap every render so tests match the prod
// tree where LightboxProvider lives at the route root.
function renderWithLightbox(ui: React.ReactElement) {
  return render(<LightboxProvider>{ui}</LightboxProvider>);
}

describe('CharacterDrawer', () => {
  it('keeps a dirty (AI-patched) field across a server-data refresh', async () => {
    liveAsset = structuredClone(initialAsset);
    const { rerender } = renderWithLightbox(
      <CharacterDrawer id={7} onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    const user = userEvent.setup();

    const promptField = screen.getByDisplayValue('original prompt');
    await user.clear(promptField);
    await user.type(promptField, 'USER EDIT');
    expect(screen.getByDisplayValue('USER EDIT')).toBeInTheDocument();

    liveAsset = {
      ...liveAsset,
      data: { ...liveAsset.data, prompt: 'stale server prompt' },
    };
    await act(async () => {
      rerender(
        <LightboxProvider>
          <CharacterDrawer id={7} onClose={vi.fn()} onCreated={vi.fn()} />
        </LightboxProvider>,
      );
    });

    expect(screen.getByDisplayValue('USER EDIT')).toBeInTheDocument();
  });

  it('shows `必填` when persona is empty (and not when name is empty)', async () => {
    liveAsset = structuredClone(initialAsset);
    liveAsset.data.persona = '';
    liveAsset.name = '';
    renderWithLightbox(<CharacterDrawer id={7} onClose={vi.fn()} onCreated={vi.fn()} />);

    const user = userEvent.setup();
    // Submitting should fail and surface the persona `必填` error
    // (`name` is no longer required so it must not trigger its own error).
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('必填')).toBeInTheDocument();
    expect(screen.getAllByText('必填')).toHaveLength(1);
  });

  it('AI 填入字段 runs extractFields against the description and merges', async () => {
    liveAsset = structuredClone(initialAsset);
    liveAsset.data.description = '一名古代男侠客';
    renderWithLightbox(
      <>
        <CharacterDrawer id={7} onClose={vi.fn()} onCreated={vi.fn()} />
        <Toaster />
      </>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'AI 填入字段' }));

    // The mock returns { prompt: 'ai-patched prompt' }, which should overwrite
    // the (clean) prompt textarea value.
    expect(await screen.findByDisplayValue('ai-patched prompt')).toBeInTheDocument();
  });

  it('AutoComplete accepts free-text values not in the options list', async () => {
    liveAsset = structuredClone(initialAsset);
    renderWithLightbox(<CharacterDrawer id={7} onClose={vi.fn()} onCreated={vi.fn()} />);

    const user = userEvent.setup();
    const eraInput = screen.getByLabelText('时代');
    await user.clear(eraInput);
    // `unicorn-era` is not in the mocked options list — typing it must succeed.
    await user.type(eraInput, 'unicorn-era');
    expect((eraInput as HTMLInputElement).value).toBe('unicorn-era');
  });
});
