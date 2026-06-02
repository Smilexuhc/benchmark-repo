// Cascader option helpers — port of legacy frontend/src/data/questionTypeOptions.ts.
// We reuse the shared CategoryOption tree (single source of truth) and produce
// a per-node-count overlay for the cascader's "label (N)" rendering.

import type { CategoryOption } from '@benchmark-admin/shared/benchmark/categoryTree';

export type CategoryStatsGroup = {
  categoryL1: string;
  categoryL2: string;
  categoryL3: string;
  count: number;
};

function pathKey(l1: string, l2: string, l3: string): string {
  return `${l1}|${l2}|${l3}`;
}

function withCount(label: string, count: number): string {
  return `${label} (${count})`;
}

function findNode(
  tree: CategoryOption[],
  l1: string,
  l2?: string,
  l3?: string,
): CategoryOption | undefined {
  const a = tree.find((o) => o.value === l1);
  if (!a || l2 === undefined) return a;
  const b = a.children?.find((o) => o.value === l2);
  if (!b || l3 === undefined) return b;
  return b.children?.find((o) => o.value === l3);
}

// Returns a deep copy of `tree` with each node's label suffixed by " (N)" where
// N is the aggregate count of items whose path lives at or below that node.
export function buildCascaderOptionsWithCounts(
  tree: CategoryOption[],
  groups: CategoryStatsGroup[],
): CategoryOption[] {
  const byPath = new Map<string, number>();
  for (const g of groups) {
    byPath.set(pathKey(g.categoryL1, g.categoryL2, g.categoryL3), g.count);
  }

  return tree.map((l1) => {
    let l1Count = 0;
    const l2List: CategoryOption[] = (l1.children ?? []).map((l2) => {
      let l2Count = 0;
      const l3s: CategoryOption[] = (l2.children ?? []).map((l3) => {
        const count = byPath.get(pathKey(l1.value, l2.value, l3.value)) || 0;
        l2Count += count;
        return { ...l3, label: withCount(l3.label, count) };
      });
      l1Count += l2Count;
      return { ...l2, label: withCount(l2.label, l2Count), children: l3s };
    });
    return { ...l1, label: withCount(l1.label, l1Count), children: l2List };
  });
}

// [l1, l2, l3] values if the full path exists in `tree`, otherwise undefined.
export function findCascaderValue(
  tree: CategoryOption[],
  l1: string,
  l2: string,
  l3: string,
): [string, string, string] | undefined {
  const leaf = findNode(tree, l1, l2, l3);
  return leaf ? [l1, l2, l3] : undefined;
}

// [l1.label, l2.label, l3.label] for the path, or undefined if any level is unknown.
export function findCascaderLabels(
  tree: CategoryOption[],
  l1: string,
  l2: string,
  l3: string,
): [string, string, string] | undefined {
  const a = findNode(tree, l1);
  const b = findNode(tree, l1, l2);
  const c = findNode(tree, l1, l2, l3);
  return a && b && c ? [a.label, b.label, c.label] : undefined;
}
