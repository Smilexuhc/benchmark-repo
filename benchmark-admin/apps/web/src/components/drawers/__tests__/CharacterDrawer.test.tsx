/**
 * Tests that the AI-patched (dirty) fields in CharacterDrawer survive a
 * post-AI ctx.refresh() (P1 from JUJ-22).
 *
 * The drawer's effect calls form.reset(serverData, { keepDirtyValues: true })
 * — fields the user (or AI extract) has touched are kept; only untouched
 * fields are overwritten by fresh server data. Without this option, a
 * refresh after an AI patch would clobber the patch with stale server data.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createTrpcMock } from '@/test/trpc-mock';

type AssetRow = {
  id: number;
  kind: 'character';
  name: string;
  era: string | null;
  genre: string | null;
  data: Record<string, string | undefined>;
  coverImageId: number | null;
  images: { id: number; objectKey: string; url: string }[];
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
};

// The "live" copy returned by assets.get. The test mutates this to simulate
// stale server data, then triggers a refetch via setData (mimicking what
// ctx.refresh() would cause in production).
let liveAsset: AssetRow = structuredClone(initialAsset);

vi.mock('@/lib/trpc', () =>
  createTrpcMock({
    query: {
      'assets.get': () => liveAsset,
    },
    mutation: {
      'assets.create': async () => liveAsset,
      'assets.update': async () => liveAsset,
      'assets.deleteImage': async () => undefined,
      'assets.setCover': async () => undefined,
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

describe('CharacterDrawer AI-patch preservation', () => {
  it('keeps a dirty (AI-patched) field across a server-data refresh', async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const { rerender } = render(
      <CharacterDrawer id={7} onClose={onClose} onCreated={onCreated} />,
    );

    const user = userEvent.setup();

    // Simulate the user touching the prompt field — this marks it dirty.
    // (Stand-in for the AI extract path, which also writes via form.setValue
    // / form.reset with keepDirty so the field ends up dirty.)
    const promptField = screen.getByDisplayValue('original prompt');
    await user.clear(promptField);
    await user.type(promptField, 'USER EDIT');
    expect(screen.getByDisplayValue('USER EDIT')).toBeInTheDocument();

    // Server-side state changes underneath (someone else updated this row);
    // a refresh would re-read it. Force a rerender so the drawer's effect
    // observes the new query result.
    liveAsset = { ...liveAsset, data: { ...liveAsset.data, prompt: 'stale server prompt' } };
    await act(async () => {
      rerender(<CharacterDrawer id={7} onClose={onClose} onCreated={onCreated} />);
    });

    // Without keepDirtyValues the field would now read "stale server prompt"
    // and the user's unsaved edit would be lost.
    expect(screen.getByDisplayValue('USER EDIT')).toBeInTheDocument();
  });
});
