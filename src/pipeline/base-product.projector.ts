import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  BaseProductRepository,
  BaseProductUpsertInput,
} from '../database/repositories/shared-catalog/base-product.repository';

/**
 * Projects base_product rows out of a tenant sync, insert-only, in its
 * OWN transaction (a fresh connection off the runtime DataSource, not
 * the tenant batch tx). base_product is `shared_catalog`-schema-qualified
 * so it lands in the shared catalog without the tenant search_path.
 *
 * Decoupling is the point: a shared-catalog hiccup must never roll back
 * a tenant's product write, and the base_product is created once per EAN
 * and skipped if it already exists (ON CONFLICT DO NOTHING) — so any
 * tenant adding a product reactively fills the shared catalog.
 */
@Injectable()
export class BaseProductProjector {
  constructor(private readonly dataSource: DataSource) {}

  public async project(inputs: BaseProductUpsertInput[]): Promise<void> {
    if (inputs.length === 0) return;
    await this.dataSource.transaction((em) =>
      new BaseProductRepository(em).insertNewByEan(inputs),
    );
  }
}
