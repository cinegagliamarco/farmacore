import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The old sync-product-items copied the GLOBAL product.price into
 * product_item.price whenever the ERP had no per-store row, making those
 * snapshots indistinguishable from genuine per-store prices. Reads now
 * COALESCE product_item.price over the live global, so the legacy snapshots
 * would be served as "per-store" prices (and mask global price changes)
 * until a full sync overwrote them. Null them all; the next sync re-fills
 * the genuine per-store prices from the ERP. Down is a no-op — the
 * snapshots are stale data not worth restoring.
 *
 * Deploy notes: run with no sync-product-items in flight (it is nightly) and
 * ideally dispatch a sync right after, so genuine per-store prices return
 * before the next night. A rollback to the old code that survives past a
 * nightly sync recreates snapshots (old sync writes the global copy); the
 * first new-code sync clears them again.
 */
export class NullProductItemPriceSnapshots1700000000021
  implements MigrationInterface
{
  public name = 'NullProductItemPriceSnapshots1700000000021';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE product_item SET price = NULL WHERE price IS NOT NULL`,
    );
  }

  public async down(): Promise<void> {}
}
