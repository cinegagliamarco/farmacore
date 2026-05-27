import { EntityManager, In } from 'typeorm';
import { BaseProductEntity } from '../../entities/shared-catalog/base-product.entity';

export interface BaseProductUpsertInput {
  ean: string;
  description?: string | null;
  activeIngredient?: string | null;
  generic?: boolean;
}

/**
 * Shared-catalog base_product repository.
 *
 * Plain class instantiated per pipeline step, bound to the tenant
 * EntityManager from runWithTenant. The entity is declared with
 * `schema: 'shared_catalog'` so writes land in the shared catalog
 * regardless of the search_path.
 */
export class BaseProductRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Bulk upsert by `ean`, returning a Map<ean, id>. Deduplicates the
   * incoming batch by ean (last-write-wins) — embalagem can carry
   * multiple packagings sharing one barcode, which would otherwise
   * trip ON CONFLICT ("cannot affect row a second time").
   */
  public async upsertManyByEan(
    inputs: BaseProductUpsertInput[],
  ): Promise<Map<string, string>> {
    if (inputs.length === 0) return new Map();
    const deduped = this.dedupeByEan(inputs);
    const repo = this.em.getRepository(BaseProductEntity);
    await repo.upsert(deduped, {
      conflictPaths: ['ean'],
      skipUpdateIfNoValuesChanged: true,
    });
    const eans = deduped.map((d) => d.ean);
    const rows = await repo.find({
      where: { ean: In(eans) },
      select: { id: true, ean: true },
    });
    const out = new Map<string, string>();
    for (const row of rows) out.set(String(row.ean), row.id);
    return out;
  }

  private dedupeByEan(
    inputs: BaseProductUpsertInput[],
  ): BaseProductUpsertInput[] {
    const byEan = new Map<string, BaseProductUpsertInput>();
    for (const i of inputs) byEan.set(String(i.ean), i);
    return [...byEan.values()];
  }
}
