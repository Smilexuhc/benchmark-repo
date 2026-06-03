import type { ReactNode } from 'react';
import { createElement, Fragment } from 'react';
import type {
  AssetCardData,
  CharacterCardData,
  PropCardData,
  SceneCardData,
} from './AssetCard.types';

// Render a single row inside the info column. Empty values collapse so we don't
// leak grey labels with nothing next to them (matches legacy InfoRow behavior).
function infoRow(label: string, value: string | null | undefined): ReactNode {
  if (!value) return null;
  return createElement(
    'div',
    { className: 'flex gap-1.5 text-xs leading-5', key: label },
    createElement('span', { className: 'shrink-0 text-[hsl(var(--muted-foreground))]' }, label),
    createElement('span', { className: 'text-[hsl(var(--foreground))]' }, value),
  );
}

function title(text: string): ReactNode {
  return createElement(
    'div',
    { className: 'mb-1 text-[15px] font-semibold leading-tight', key: 'title' },
    text,
  );
}

function attrs(text: string): ReactNode {
  return createElement(
    'div',
    {
      className: 'mb-2.5 text-xs text-[hsl(var(--muted-foreground))]',
      key: 'attrs',
    },
    text || '—',
  );
}

function genreTag(genre: string | null | undefined): ReactNode {
  if (!genre) return null;
  return createElement(
    'div',
    { className: 'mt-1.5', key: 'genre' },
    createElement(
      'span',
      {
        className:
          'inline-block rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[11px] text-[hsl(var(--foreground))]',
      },
      genre,
    ),
  );
}

export function renderCharacterInfo(asset: CharacterCardData): ReactNode {
  const { data } = asset;
  return createElement(
    Fragment,
    null,
    title(data.persona || asset.name || '(未命名)'),
    attrs([asset.era, data.type, data.gender, data.age].filter(Boolean).join(' · ')),
    infoRow('身材', data.body),
    infoRow('特征', data.features),
    genreTag(asset.genre),
  );
}

export function renderSceneInfo(asset: SceneCardData): ReactNode {
  const { data } = asset;
  // `关键元素` lives in `data.elements`. Legacy stores it as a plain string;
  // the admin schema declared it as `string[]`, so rows migrated from legacy
  // arrive as strings while newer rows may be arrays. Tolerate both.
  const raw = data.elements as unknown;
  const elements =
    typeof raw === 'string' ? raw
    : Array.isArray(raw) ? raw.filter(Boolean).join(', ')
    : '';
  return createElement(
    Fragment,
    null,
    title(asset.name || '(未命名)'),
    attrs([asset.era, data.scene_type, data.mood].filter(Boolean).join(' · ')),
    infoRow('关键元素', elements),
    genreTag(asset.genre),
  );
}

export function renderPropInfo(asset: PropCardData): ReactNode {
  // Prop title must never fall back to UUID or filename — name is the only
  // human-readable identifier; placeholder when missing (Codex P2).
  return createElement(
    Fragment,
    null,
    title(asset.name || '(未命名)'),
    genreTag(asset.data.category ?? null),
  );
}

export function renderInfoForKind(asset: AssetCardData): ReactNode {
  if (asset.kind === 'character') return renderCharacterInfo(asset);
  if (asset.kind === 'scene') return renderSceneInfo(asset);
  return renderPropInfo(asset);
}
