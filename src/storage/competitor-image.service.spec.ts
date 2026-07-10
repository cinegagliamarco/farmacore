import { EntityManager, In } from 'typeorm';
import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';
import { ProductEntity } from '../database/entities/shared-catalog/product.entity';
import type { ScrapedProduct } from '../scrapers/types';
import { CompetitorImageService } from './competitor-image.service';
import { R2StorageService } from './r2-storage.service';

describe('CompetitorImageService', () => {
  let service: CompetitorImageService;
  let uploadFromUrl: jest.Mock;
  let productRows: Array<{ id: string; ean: string; origin: string }>;
  let imageRepo: { delete: jest.Mock; insert: jest.Mock };
  let em: EntityManager;

  const scrape = (ean: string): ScrapedProduct => ({
    ean,
    origin: CompetitorOrigin.DROGAL,
    found: true,
    metadata: { image: `https://cdn/${ean}.jpg` },
  });

  beforeEach(() => {
    uploadFromUrl = jest.fn();
    service = new CompetitorImageService({
      uploadFromUrl,
    } as unknown as R2StorageService);
    productRows = [];
    const qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockImplementation(() => Promise.resolve(productRows)),
    };
    imageRepo = { delete: jest.fn(), insert: jest.fn() };
    em = {
      getRepository: jest.fn((entity: unknown) =>
        entity === ProductEntity ? { createQueryBuilder: () => qb } : imageRepo,
      ),
    } as unknown as EntityManager;
  });

  it('falls back to the source url for a failed upload and inserts every row', async () => {
    productRows = [
      { id: 'p1', ean: '1', origin: CompetitorOrigin.DROGAL },
      { id: 'p2', ean: '2', origin: CompetitorOrigin.DROGAL },
      { id: 'p3', ean: '3', origin: CompetitorOrigin.DROGAL },
    ];
    uploadFromUrl.mockImplementation((source: string, key: string) =>
      source === 'https://cdn/2.jpg'
        ? Promise.reject(new Error('r2 down'))
        : Promise.resolve(`https://r2/${key}`),
    );

    await service.project(em, [scrape('1'), scrape('2'), scrape('3')]);

    expect(imageRepo.delete).toHaveBeenCalledWith({
      productId: In(['p1', 'p2', 'p3']),
    });
    expect(imageRepo.insert).toHaveBeenCalledWith([
      {
        productId: 'p1',
        url: 'https://r2/competitor/DROGAL/1.jpg',
        isPrimary: true,
      },
      { productId: 'p2', url: 'https://cdn/2.jpg', isPrimary: true },
      {
        productId: 'p3',
        url: 'https://r2/competitor/DROGAL/3.jpg',
        isPrimary: true,
      },
    ]);
  });

  it('uploads in chunks of UPLOAD_CONCURRENCY (5)', async () => {
    productRows = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      ean: String(i),
      origin: CompetitorOrigin.DROGAL,
    }));
    const release: Array<(url: string) => void> = [];
    uploadFromUrl.mockImplementation(
      () => new Promise<string>((resolve) => release.push(resolve)),
    );

    const projecting = service.project(
      em,
      Array.from({ length: 7 }, (_, i) => scrape(String(i))),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(uploadFromUrl).toHaveBeenCalledTimes(5);

    release.splice(0).forEach((resolve) => resolve('https://r2/x.jpg'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(uploadFromUrl).toHaveBeenCalledTimes(7);

    release.splice(0).forEach((resolve) => resolve('https://r2/x.jpg'));
    await projecting;
    expect(imageRepo.insert).toHaveBeenCalledTimes(1);
  });
});
