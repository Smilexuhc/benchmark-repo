/**
 * Smoke test for BenchmarkDrawer's keepDirtyValues preservation (P1 from
 * JUJ-22). Mirrors the CharacterDrawer test but for the benchmark form.
 */
import { act, render, screen } from '@testing-library/react';
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
  textPrompt: string;
  judgingCriteria: string;
  score: number | null;
  needsRevision: boolean;
  media: {
    character_image: { mediaId: number }[];
    scene_image: { mediaId: number }[];
    prop_image: { mediaId: number }[];
    audio_input: { mediaId: number } | null;
    video_input: { mediaId: number } | null;
    video_output: { mediaId: number } | null;
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
  textPrompt: '',
  judgingCriteria: '',
  score: null,
  needsRevision: false,
  media: {
    character_image: [],
    scene_image: [],
    prop_image: [],
    audio_input: null,
    video_input: null,
    video_output: null,
  },
};

vi.mock('@/lib/trpc', () =>
  createTrpcMock({
    query: {
      'benchmark.get': () => live,
      'benchmark.comments.list': () => [],
    },
    mutation: {
      'benchmark.update': async () => live,
      'benchmark.create': async () => live,
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
    const { rerender } = render(
      <BenchmarkDrawer id={42} onClose={onClose} onSaved={onSaved} />,
    );

    const user = userEvent.setup();
    const scene = screen.getByDisplayValue('original scene');
    await user.clear(scene);
    await user.type(scene, 'USER EDIT');

    // Server-side change underneath.
    live = { ...live, scene: 'stale server scene' };
    await act(async () => {
      rerender(<BenchmarkDrawer id={42} onClose={onClose} onSaved={onSaved} />);
    });

    expect(screen.getByDisplayValue('USER EDIT')).toBeInTheDocument();
  });
});
