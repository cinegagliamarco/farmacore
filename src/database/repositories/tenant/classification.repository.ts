import { EntityManager, IsNull } from 'typeorm';
import { ClassificationEntity } from '../../entities/tenant/classification.entity';

/**
 * Tree-aware classification repository. Legacy stored classification as
 * a `>` separated path (e.g. "GENERICO > PSICOS GENERICO > A1-GEN") on
 * a single row. The new schema uses (name, parent_id) — each segment
 * is its own row, linked up by parent_id.
 *
 * upsertPaths walks each path top-down: ensure (level=0, parent=null),
 * then (level=1, parent=id-from-level-0), etc. Returns a map from the
 * original full path to the LEAF classification id, suitable for
 * tenant_product.classification_id.
 */
export class ClassificationRepository {
  constructor(private readonly em: EntityManager) {}

  public async upsertPaths(
    paths: (string | undefined | null)[],
  ): Promise<Map<string, string>> {
    const repo = this.em.getRepository(ClassificationEntity);
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

    const idCache = new Map<string, string>(); // key: `${parentId ?? 'null'}|${name}`
    const resolve = async (
      name: string,
      parentId: string | null,
    ): Promise<string> => {
      const cacheKey = `${parentId ?? 'null'}|${name}`;
      const cached = idCache.get(cacheKey);
      if (cached) return cached;

      const existing = await repo.findOne({
        where: { name, parentId: parentId ?? IsNull() },
      });
      if (existing) {
        idCache.set(cacheKey, existing.id);
        return existing.id;
      }
      const saved = await repo.save({ name, parentId });
      idCache.set(cacheKey, saved.id);
      return saved.id;
    };

    for (const [path, parts] of segmentsByPath) {
      let parentId: string | null = null;
      let leafId: string | null = null;
      for (const segment of parts) {
        leafId = await resolve(segment, parentId);
        parentId = leafId;
      }
      if (leafId) out.set(path, leafId);
    }
    return out;
  }
}
