export interface ClassificationRow {
  id: string;
  name: string;
  parentId: string | null;
}

/** In-memory tree for ID-based subtree / overlap checks. */
export interface ClassificationIndex {
  depthById: ReadonlyMap<string, number>;
  /** `nodeId` is `ancestorId` or a descendant of it. */
  isUnder(nodeId: string | null | undefined, ancestorId: string): boolean;
  /** Two filters overlap when one subtree contains the other. */
  idsOverlap(a: string, b: string): boolean;
  /** Selected IDs plus every descendant classification ID. */
  expandSubtree(rootIds: string[]): Set<string>;
}

export function buildClassificationIndex(
  rows: ClassificationRow[],
): ClassificationIndex {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const depthById = new Map<string, number>();
  const memoDepth = (id: string): number => {
    const cached = depthById.get(id);
    if (cached !== undefined) return cached;
    const row = byId.get(id);
    if (!row) return 0;
    const depth = row.parentId ? memoDepth(row.parentId) + 1 : 0;
    depthById.set(id, depth);
    return depth;
  };
  for (const row of rows) memoDepth(row.id);

  const ancestorsOf = (nodeId: string): string[] => {
    const chain: string[] = [];
    let cur: string | null = nodeId;
    while (cur) {
      chain.push(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
    return chain;
  };

  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const siblings = childrenOf.get(row.parentId) ?? [];
    siblings.push(row.id);
    childrenOf.set(row.parentId, siblings);
  }

  const expandSubtree = (rootIds: string[]): Set<string> => {
    const out = new Set<string>();
    const stack = [...rootIds];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      for (const child of childrenOf.get(id) ?? []) stack.push(child);
    }
    return out;
  };

  const isUnder = (
    nodeId: string | null | undefined,
    ancestorId: string,
  ): boolean => {
    if (!nodeId || !byId.has(ancestorId)) return false;
    return ancestorsOf(nodeId).includes(ancestorId);
  };

  return {
    depthById,
    isUnder,
    idsOverlap(a, b) {
      if (a === b) return true;
      return isUnder(a, b) || isUnder(b, a);
    },
    expandSubtree,
  };
}
