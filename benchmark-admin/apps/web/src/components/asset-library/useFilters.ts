import { parseAsArrayOf, parseAsBoolean, parseAsString, useQueryStates } from 'nuqs';
import { useCallback } from 'react';

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

export function buildServerFilters(filters: AssetFilters) {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (Array.isArray(v) && v.length > 0) out[k] = v;
  }
  return out;
}
