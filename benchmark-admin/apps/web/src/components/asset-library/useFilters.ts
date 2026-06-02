import { parseAsArrayOf, parseAsBoolean, parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo } from 'react';
import { trpc } from '@/lib/trpc';

const ARRAY_PARAM = parseAsArrayOf(parseAsString, ',').withDefault([]);

export type AssetFilters = {
  era: string[];
  genre: string[];
  type: string[];
  gender: string[];
  age: string[];
  scene_type: string[];
  mood: string[];
  category: string[];
};

export type AssetKind = 'character' | 'scene' | 'prop';

// Filter field shape consumed by FilterPanel. Owned here so the URL-state hook
// and the server-driven options query share a single FilterField definition.
export type FilterField = {
  key: keyof AssetFilters;
  label: string;
  options: readonly string[];
};

// Per-kind list of (key, label) tuples. Order is intentional — it is the
// display order in the filter panel. Only the keys listed here are rendered,
// even if the options payload happens to include others.
const FIELDS_BY_KIND: Record<AssetKind, ReadonlyArray<{ key: keyof AssetFilters; label: string }>> =
  {
    character: [
      { key: 'era', label: '时代' },
      { key: 'genre', label: '题材' },
      { key: 'type', label: '类型' },
      { key: 'gender', label: '性别' },
      { key: 'age', label: '年龄' },
    ],
    scene: [
      { key: 'era', label: '时代' },
      { key: 'genre', label: '题材' },
      { key: 'scene_type', label: '场景类型' },
      // Legacy field is 氛围时段 (time-of-day mood). Admin previously labelled
      // it 氛围, which read as a separate concept from the seed values
      // 白天/黄昏/夜晚 — fixed here.
      { key: 'mood', label: '氛围时段' },
    ],
    prop: [{ key: 'category', label: '分类' }],
  };

const FILTER_PARSERS = {
  era: ARRAY_PARAM,
  genre: ARRAY_PARAM,
  type: ARRAY_PARAM,
  gender: ARRAY_PARAM,
  age: ARRAY_PARAM,
  scene_type: ARRAY_PARAM,
  mood: ARRAY_PARAM,
  category: ARRAY_PARAM,
};

const STATE_PARSERS = {
  search: parseAsString.withDefault(''),
  deletedOnly: parseAsBoolean.withDefault(false),
  ...FILTER_PARSERS,
};

export function useFilters() {
  const [state, setState] = useQueryStates(STATE_PARSERS, { history: 'replace' });

  const setFilter = useCallback(
    <K extends keyof AssetFilters>(key: K, value: string[]) => {
      setState({ [key]: value });
    },
    [setState],
  );

  const setSearch = useCallback((value: string) => setState({ search: value }), [setState]);
  const setDeletedOnly = useCallback(
    (value: boolean) => setState({ deletedOnly: value }),
    [setState],
  );
  const reset = useCallback(
    () =>
      setState({
        era: [],
        genre: [],
        type: [],
        gender: [],
        age: [],
        scene_type: [],
        mood: [],
        category: [],
        search: '',
        deletedOnly: false,
      }),
    [setState],
  );

  const filters: AssetFilters = {
    era: state.era,
    genre: state.genre,
    type: state.type,
    gender: state.gender,
    age: state.age,
    scene_type: state.scene_type,
    mood: state.mood,
    category: state.category,
  };

  return {
    filters,
    search: state.search,
    deletedOnly: state.deletedOnly,
    setFilter,
    setSearch,
    setDeletedOnly,
    reset,
  };
}

// Derive FilterField[] from the live server-side option set. Options change
// rarely (only when assets are imported/edited), so a long staleTime keeps the
// filter panel snappy without re-querying on every list refetch.
export function useFilterFields(kind: AssetKind, deletedOnly: boolean): FilterField[] {
  const optionsQuery = trpc.assets.options.useQuery(
    { kind, deletedOnly },
    { staleTime: 10 * 60_000 },
  );

  return useMemo(() => {
    const data = optionsQuery.data;
    const lookup = (data ?? {}) as Partial<Record<keyof AssetFilters, readonly string[]>>;
    return FIELDS_BY_KIND[kind].map(({ key, label }) => ({
      key,
      label,
      options: lookup[key] ?? [],
    }));
  }, [kind, optionsQuery.data]);
}

export function buildServerFilters(filters: AssetFilters) {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (Array.isArray(v) && v.length > 0) out[k] = v;
  }
  return out;
}
