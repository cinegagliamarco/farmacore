import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { ProductEntity } from '../database/entities/shared-catalog/product.entity';
import { ProductImageEntity } from '../database/entities/shared-catalog/product-image.entity';
import type { ScrapedProduct } from '../scrapers/types';
import { R2StorageService } from './r2-storage.service';

const UPLOAD_CONCURRENCY = 5;

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
    const targets = withImage.flatMap((s) => {
      const productId = idByKey.get(`${s.ean}|${s.origin}`);
      return productId ? [{ scrape: s, productId }] : [];
    });

    // Uploads are pure external I/O (download + resize + PUT); the
    // transactional em is only touched before and after this loop.
    const rows: Array<{ productId: string; url: string }> = [];
    for (let i = 0; i < targets.length; i += UPLOAD_CONCURRENCY) {
      const chunk = targets.slice(i, i + UPLOAD_CONCURRENCY);
      rows.push(
        ...(await Promise.all(
          chunk.map(({ scrape, productId }) =>
            this.uploadOne(scrape).then((url) => ({ productId, url })),
          ),
        )),
      );
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

  /** Upload to R2, falling back to the source URL on failure. */
  private async uploadOne(scrape: ScrapedProduct): Promise<string> {
    const source = scrape.metadata!.image as string;
    try {
      return await this.storage.uploadFromUrl(
        source,
        `competitor/${scrape.origin}/${scrape.ean}.jpg`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `image upload failed ean=${scrape.ean} origin=${scrape.origin}: ${message}; storing source url`,
      );
      return source;
    }
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
