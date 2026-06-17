import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { ProductEntity } from '../database/entities/shared-catalog/product.entity';
import { ProductImageEntity } from '../database/entities/shared-catalog/product-image.entity';
import type { ScrapedProduct } from '../scrapers/types';
import { R2StorageService } from './r2-storage.service';

/**
 * Re-hosts scraped competitor images onto R2 and projects them into
 * shared_catalog.product_image. Scrapers carry a single image URL in
 * metadata.image; we upload it to our bucket and store the public URL,
 * falling back to the source URL when the upload fails (e.g. local dev
 * with a placeholder R2) so the projection still records something.
 *
 * Delete-then-insert per product keeps the table in sync with the latest
 * scrape instead of accumulating duplicates across runs.
 */
@Injectable()
export class CompetitorImageService {
  private readonly logger = new Logger(CompetitorImageService.name);

  constructor(private readonly storage: R2StorageService) {}

  public async project(
    em: EntityManager,
    scrapes: ScrapedProduct[],
  ): Promise<void> {
    const withImage = scrapes.filter(
      (s) => s.found && typeof s.metadata?.image === 'string',
    );
    if (withImage.length === 0) return;

    const idByKey = await this.resolveProductIds(em, withImage);

    const rows: Array<{ productId: string; url: string }> = [];
    for (const s of withImage) {
      const productId = idByKey.get(`${s.ean}|${s.origin}`);
      if (!productId) continue;
      const source = s.metadata!.image as string;
      let url = source;
      try {
        url = await this.storage.uploadFromUrl(
          source,
          `competitor/${s.origin}/${s.ean}.jpg`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `image upload failed ean=${s.ean} origin=${s.origin}: ${message}; storing source url`,
        );
      }
      rows.push({ productId, url });
    }
    if (rows.length === 0) return;

    const imageRepo = em.getRepository(ProductImageEntity);
    await imageRepo.delete({ productId: In(rows.map((r) => r.productId)) });
    await imageRepo.insert(
      rows.map((r) => ({
        productId: r.productId,
        url: r.url,
        isPrimary: true,
      })),
    );
  }

  private async resolveProductIds(
    em: EntityManager,
    scrapes: ScrapedProduct[],
  ): Promise<Map<string, string>> {
    const rows: Array<{ id: string; ean: string; origin: string }> = await em
      .getRepository(ProductEntity)
      .createQueryBuilder('p')
      .select(['p.id AS id', 'p.ean AS ean', 'p.origin AS origin'])
      .where('p.ean = ANY(:eans::bigint[])', {
        eans: [...new Set(scrapes.map((s) => s.ean))],
      })
      .andWhere('p.origin IN (:...origins)', {
        origins: [...new Set(scrapes.map((s) => s.origin))],
      })
      .getRawMany();
    return new Map(rows.map((r) => [`${String(r.ean)}|${r.origin}`, r.id]));
  }
}
