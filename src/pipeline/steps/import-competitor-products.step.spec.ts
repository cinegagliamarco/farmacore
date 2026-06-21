import type { EntityManager } from 'typeorm';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { SharedProductRepository } from '../../database/repositories/shared-catalog/product.repository';
import { ProductStockRepository } from '../../database/repositories/shared-catalog/product-stock.repository';
import type { CompetitorImageService } from '../../storage/competitor-image.service';
import type {
  ProductScraper,
  ScrapedProduct,
  StockScraper,
} from '../../scrapers/types';
import { ImportCompetitorProductsStep } from './import-competitor-products.step';

jest.mock('../../database/repositories/shared-catalog/product.repository');
jest.mock(
  '../../database/repositories/shared-catalog/product-stock.repository',
);

type ProductMock = ProductScraper & { scrapeProduct: jest.Mock };
type StockMock = StockScraper & ProductMock & { scrapeStock: jest.Mock };

const productScraper = (origin: CompetitorOrigin): ProductMock => ({
  origin,
  scrapeProduct: jest.fn(
    (ean: string): Promise<ScrapedProduct> =>
      Promise.resolve({ ean, origin, found: true, sku: 'SKU-1' }),
  ),
});

const stockScraper = (origin: CompetitorOrigin): StockMock => ({
  ...productScraper(origin),
  scrapeStock: jest.fn().mockResolvedValue([]),
});

const build = () => {
  const scrapers = {
    drogal: stockScraper(CompetitorOrigin.DROGAL),
    drogasil: stockScraper(CompetitorOrigin.DROGASIL),
    michelassi: productScraper(CompetitorOrigin.MICHELASSI),
    pagueMenos: productScraper(CompetitorOrigin.PAGUE_MENOS),
    ikesaki: productScraper(CompetitorOrigin.IKESAKI),
    pacheco: productScraper(CompetitorOrigin.PACHECO),
    saoPaulo: productScraper(CompetitorOrigin.SAO_PAULO),
    venancio: productScraper(CompetitorOrigin.VENANCIO),
    indiana: productScraper(CompetitorOrigin.INDIANA),
  };
  const images = { project: jest.fn() } as unknown as CompetitorImageService;
  const step = new ImportCompetitorProductsStep(
    scrapers.drogal,
    scrapers.drogasil,
    scrapers.michelassi,
    scrapers.pagueMenos,
    scrapers.ikesaki,
    scrapers.pacheco,
    scrapers.saoPaulo,
    scrapers.venancio,
    scrapers.indiana,
    images,
  );
  return { step, scrapers, images, em: {} as EntityManager };
};

beforeEach(() => jest.clearAllMocks());

describe('ImportCompetitorProductsStep.run', () => {
  it('does nothing for an empty EAN slice', async () => {
    const { step, scrapers, em } = build();
    await step.run(em, CompetitorOrigin.PACHECO, []);
    expect(scrapers.pacheco.scrapeProduct).not.toHaveBeenCalled();
    expect(SharedProductRepository).not.toHaveBeenCalled();
  });

  it.each([
    ['pacheco', CompetitorOrigin.PACHECO],
    ['saoPaulo', CompetitorOrigin.SAO_PAULO],
    ['venancio', CompetitorOrigin.VENANCIO],
    ['indiana', CompetitorOrigin.INDIANA],
  ] as const)(
    'routes %s EANs to its scraper and skips the stock step',
    async (key, origin) => {
      const { step, scrapers, em } = build();
      await step.run(em, origin, ['789']);
      expect(scrapers[key].scrapeProduct).toHaveBeenCalledWith('789');
      expect(scrapers.drogal.scrapeProduct).not.toHaveBeenCalled();
      expect(SharedProductRepository).toHaveBeenCalledTimes(1);
      expect(ProductStockRepository).not.toHaveBeenCalled();
    },
  );

  it('runs the stock step for stock-bearing origins (Drogal)', async () => {
    const { step, scrapers, em } = build();
    await step.run(em, CompetitorOrigin.DROGAL, ['789']);
    expect(scrapers.drogal.scrapeStock).toHaveBeenCalledWith([
      { ean: '789', sku: 'SKU-1' },
    ]);
    expect(ProductStockRepository).toHaveBeenCalledTimes(1);
  });

  it('persists scrapes and re-hosts images for every origin', async () => {
    const { step, images, em } = build();
    await step.run(em, CompetitorOrigin.INDIANA, ['789']);
    expect(SharedProductRepository).toHaveBeenCalledTimes(1);
    expect(images.project).toHaveBeenCalledTimes(1);
  });
});
