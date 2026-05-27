import { EntityManager } from 'typeorm';

/**
 * Tree-aware classification repository. Legacy stored classification as
 * a `>` separated path (e.g. "GENERICO > PSICOS GENERICO > A1-GEN") on
 * a single row. The new schema uses (name, parent_id) — each segment
 * is its own row, linked up by parent_id.
 *
 * upsertPaths walks each path top-down: ensure (level=0, parent=null),
 * then (level=1, parent=id-from-level-0), etc. Returns a map from the
 * original full path to the LEAF classification id, suitable for
 * product.classification_id.
 *
 * Resolution is concurrent-safe: two batches racing on the same path
 * both run INSERT ... ON CONFLICT DO NOTHING against the partial
 * unique indexes (UQ_CLASSIFICATION_ROOT_NAME / _CHILD_NAME). Whoever
 * loses the conflict reads the winner's row.
 */
export class ClassificationRepository {
  constructor(private readonly em: EntityManager) {}

  public async upsertPaths(
    paths: (string | undefined | null)[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();

    const segmentsByPath = new Map<string, string[]>();
    for (const raw of paths) {
      if (!raw || raw.trim() === '') continue;
      const parts = raw
        .split('>')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length === 0) continue;
      segmentsByPath.set(raw, parts);
    }
    if (segmentsByPath.size === 0) return out;

    const idCache = new Map<string, string>();
    for (const [path, parts] of segmentsByPath) {
      let parentId: string | null = null;
      let leafId: string | null = null;
      for (const segment of parts) {
        leafId = await this.resolve(segment, parentId, idCache);
        parentId = leafId;
      }
      if (leafId) out.set(path, leafId);
    }
    return out;
  }

  private async resolve(
    name: string,
    parentId: string | null,
    idCache: Map<string, string>,
  ): Promise<string> {
    const cacheKey = `${parentId ?? 'null'}|${name}`;
    const cached = idCache.get(cacheKey);
    if (cached) return cached;

    const id = await this.upsertAndFetchId(name, parentId);
    idCache.set(cacheKey, id);
    return id;
  }

  /**
   * Atomic upsert: INSERT ... ON CONFLICT DO NOTHING against the
   * partial UNIQUE index that matches the row's parentId nullity.
   * Always follow with a SELECT for the row id (the INSERT returns
   * nothing on conflict).
   */
  private async upsertAndFetchId(
    name: string,
    parentId: string | null,
  ): Promise<string> {
    if (parentId === null) {
      await this.em.query(
        `INSERT INTO classification (name, parent_id)
         VALUES ($1, NULL)
         ON CONFLICT (name) WHERE parent_id IS NULL AND deleted_at IS NULL
         DO NOTHING`,
        [name],
      );
      const rows: Array<{ id: string }> = await this.em.query(
        `SELECT id FROM classification
         WHERE name = $1 AND parent_id IS NULL AND deleted_at IS NULL`,
        [name],
      );
      return rows[0].id;
    }
    await this.em.query(
      `INSERT INTO classification (name, parent_id)
       VALUES ($1, $2)
       ON CONFLICT (parent_id, name) WHERE parent_id IS NOT NULL AND deleted_at IS NULL
       DO NOTHING`,
      [name, parentId],
    );
    const rows: Array<{ id: string }> = await this.em.query(
      `SELECT id FROM classification
       WHERE name = $1 AND parent_id = $2 AND deleted_at IS NULL`,
      [name, parentId],
    );
    return rows[0].id;
  }
}
