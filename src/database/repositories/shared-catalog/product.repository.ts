import { EntityManager } from 'typeorm';
import { ProductEntity } from '../../entities/shared-catalog/product.entity';

export interface CompetitorProperties {
  ean: string;
  origin: string;
  name: string | null;
  supplier: string | null;
  brand: string | null;
  weight: string | null;
  height: string | null;
  length: string | null;
  width: string | null;
}

/**
 * Read repo for shared_catalog.product (scraped competitor data).
 * Reads are bounded to DROGAL + DROGASIL since those are the only
 * origins update-base-product-properties consults (matching legacy).
 */
export class SharedProductRepository {
  constructor(private readonly em: EntityManager) {}

  public async findPropertiesByEans(
    eans: string[],
  ): Promise<CompetitorProperties[]> {
    if (eans.length === 0) return [];
    const rows: CompetitorProperties[] = await this.em
      .getRepository(ProductEntity)
      .createQueryBuilder('p')
      .select([
        'p.ean AS ean',
        'p.origin AS origin',
        'p.name AS name',
        'p.supplier AS supplier',
        'p.brand AS brand',
        'p.weight AS weight',
        'p.height AS height',
        'p.length AS length',
        'p.width AS width',
      ])
      .where('p.ean = ANY(:eans::bigint[])', { eans })
      .andWhere("p.origin IN ('DROGAL', 'DROGASIL')")
      .getRawMany();
    return rows.map((r) => ({
      ...r,
      ean: String(r.ean),
    }));
  }
}
