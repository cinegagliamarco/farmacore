import { EntityManager } from 'typeorm';
import { OfferBookEntity } from '../../entities/tenant/offer-book.entity';

export interface OfferBookUpsertInput {
  ean: string;
  description?: string | null;
  targetPrice?: string | null;
}

/**
 * Per-tenant offer_book repository. Schema is keyed on `ean` (not the
 * legacy baseProductId FK), with `description` carrying the caderno
 * name and `target_price` carrying the precoOferta. Richer metadata
 * (expirationDate, externalId, effective vs target) lives in
 * offer_book_info.data jsonb.
 */
export class OfferBookRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Wipe and reseed pattern is the legacy contract for sync-base-product:
   * the dispatcher calls deleteAll() once before the batch fan-out, then
   * each batch upserts the rows it owns. Upsert (not insert) is used
   * because the per-tenant ean uniqueness can still collide across
   * batches when an embalagem moves between barcodes mid-run.
   */
  public async deleteAll(): Promise<void> {
    await this.em.getRepository(OfferBookEntity).delete({});
  }

  public async upsertManyByEan(inputs: OfferBookUpsertInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const repo = this.em.getRepository(OfferBookEntity);
    const deduped = this.dedupeByEan(inputs);
    await repo.upsert(deduped, {
      conflictPaths: ['ean'],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  private dedupeByEan(inputs: OfferBookUpsertInput[]): OfferBookUpsertInput[] {
    const byEan = new Map<string, OfferBookUpsertInput>();
    for (const i of inputs) byEan.set(String(i.ean), i);
    // Sort by ean so concurrent batches lock rows in the same order —
    // otherwise batches sharing eans deadlock on the ON CONFLICT upsert.
    return [...byEan.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, v]) => v);
  }
}
