import { describe, expect, it } from 'vitest';
import type { LegacyAssetImageRow, LegacyAssetRow, LegacyItemRow } from './legacy.ts';
import { basenameFromKey, containerTitle, mapAsset, mapItem, mapMedia } from './mappers.ts';

function asset(over: Partial<LegacyAssetRow> = {}): LegacyAssetRow {
  return {
    id: 1,
    kind: 'character',
    data: {},
    cover_image_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    deleted_at: null,
    ...over,
  };
}

function image(over: Partial<LegacyAssetImageRow> = {}): LegacyAssetImageRow {
  return {
    id: 10,
    asset_id: 1,
    object_key: 'uploads/x.png',
    source: 'upload',
    media_type: 'image',
    created_at: '2024-01-01T00:00:00Z',
    ...over,
  };
}

function item(over: Partial<LegacyItemRow> = {}): LegacyItemRow {
  return {
    id: 1,
    shot_type: '',
    task_type: '',
    question_type: '',
    manual_tag: '',
    difficulty: '',
    scene: '',
    screen_size: '',
    text_prompt: '',
    judging_criteria: '',
    score: null,
    needs_revision: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    deleted_at: null,
    ...over,
  };
}

describe('basenameFromKey', () => {
  it('returns the last path segment', () => {
    expect(basenameFromKey('a/b/c.png')).toBe('c.png');
    expect(basenameFromKey('flat.png')).toBe('flat.png');
    expect(basenameFromKey('')).toBe('');
  });
});

describe('mapAsset name promotion', () => {
  it('prefers data.title, then persona, then name', () => {
    expect(
      mapAsset(asset({ data: { title: 'T', persona: 'P', name: 'N' } }), null).asset.name,
    ).toBe('T');
    expect(mapAsset(asset({ data: { persona: 'P', name: 'N' } }), null).asset.name).toBe('P');
    expect(mapAsset(asset({ data: { name: 'N' } }), null).asset.name).toBe('N');
  });

  it('promotes era/genre and strips them (and title) from data', () => {
    const { asset: a } = mapAsset(
      asset({ data: { title: 'T', era: 'Tang', genre: 'epic', other: 'keep' } }),
      null,
    );
    expect(a.era).toBe('Tang');
    expect(a.genre).toBe('epic');
    expect(a.data).toEqual({ other: 'keep' });
    expect(a.data).not.toHaveProperty('title');
  });

  it('falls back to cover basename and flags an anomaly', () => {
    const { asset: a, anomaly } = mapAsset(asset({ id: 7, data: {} }), 'uploads/hero.png');
    expect(a.name).toBe('hero.png');
    expect(anomaly).toEqual({
      type: 'name_fallback',
      table: 'assets',
      id: 7,
      usedName: 'hero.png',
    });
  });

  it('falls back to untitled-<id> when there is no cover either', () => {
    const { asset: a, anomaly } = mapAsset(asset({ id: 9, data: {} }), null);
    expect(a.name).toBe('untitled-9');
    expect(anomaly?.type).toBe('name_fallback');
  });
});

describe('mapMedia container handling', () => {
  it('keeps asset_id and empty title for non-container parents', () => {
    const m = mapMedia(image({ asset_id: 1 }), { kind: 'character', title: 'ignored' });
    expect(m.asset_id).toBe(1);
    expect(m.title).toBe('');
  });

  it('detaches audio/video container files into standalone media with the container title', () => {
    const audio = mapMedia(image({ asset_id: 2 }), { kind: 'audio', title: 'Song A' });
    expect(audio.asset_id).toBeNull();
    expect(audio.title).toBe('Song A');

    const video = mapMedia(image({ asset_id: 3 }), { kind: 'video', title: 'Clip B' });
    expect(video.asset_id).toBeNull();
    expect(video.title).toBe('Clip B');
  });

  it('keeps asset_id when the parent is unknown', () => {
    const m = mapMedia(image({ asset_id: 99 }), undefined);
    expect(m.asset_id).toBe(99);
  });
});

describe('containerTitle', () => {
  it('prefers title, then name, else empty', () => {
    expect(containerTitle({ title: 'T', name: 'N' })).toBe('T');
    expect(containerTitle({ name: 'N' })).toBe('N');
    expect(containerTitle({})).toBe('');
  });
});

describe('mapItem difficulty range', () => {
  it('accepts allowed values without anomaly', () => {
    for (const d of ['', '易', '中', '难']) {
      expect(mapItem(item({ difficulty: d })).anomaly).toBeUndefined();
    }
  });

  it('flags out-of-range difficulty but keeps the row', () => {
    const { item: it, anomaly } = mapItem(item({ id: 5, difficulty: 'EASY' }));
    expect(it.difficulty).toBe('EASY');
    expect(anomaly).toEqual({
      type: 'difficulty_out_of_range',
      table: 'video_benchmark_items',
      id: 5,
      value: 'EASY',
    });
  });
});
