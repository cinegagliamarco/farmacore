import type { EntityManager } from 'typeorm';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { SharedProductRepository } from '../../database/repositories/shared-catalog/product.repository';
import type { CompetitorImageService } from '../../storage/competitor-image.service';
import type { PipelineMetricsRegistry } from '../../observability/pipeline-metrics.registry';
import type { ProductScraper, ScrapedProduct } from '../../scrapers/types';
import { ImportCompetitorProductsStep } from './import-competitor-products.step';

jest.mock('../../database/repositories/shared-catalog/product.repository');

type ProductMock = ProductScraper & {
  scrapeProduct: jest.Mock;
  scrapeProducts: jest.Mock;
};

const productScraper = (origin: CompetitorOrigin): ProductMock => ({
  origin,
  scrapeProduct: jest.fn(
    (ean: string): Promise<ScrapedProduct> =>
      Promise.resolve({ ean, origin, found: true, sku: 'SKU-1' }),
  ),
  scrapeProducts: jest.fn(
    (eans: string[]): Promise<ScrapedProduct[]> =>
      Promise.all(
        eans.map((ean) =>
          Promise.resolve({ ean, origin, found: true, sku: 'SKU-1' }),
        ),
      ),
  ),
});

const build = () => {
  const scrapers = {
    drogal: productScraper(CompetitorOrigin.DROGAL),
    drogasil: productScraper(CompetitorOrigin.DROGASIL),
    michelassi: productScraper(CompetitorOrigin.MICHELASSI),
    pagueMenos: productScraper(CompetitorOrigin.PAGUE_MENOS),
    ikesaki: productScraper(CompetitorOrigin.IKESAKI),
    pacheco: productScraper(CompetitorOrigin.PACHECO),
    saoPaulo: productScraper(CompetitorOrigin.SAO_PAULO),
    venancio: productScraper(CompetitorOrigin.VENANCIO),
    indiana: productScraper(CompetitorOrigin.INDIANA),
  };
  const images = { project: jest.fn() } as unknown as CompetitorImageService;
  const metrics = {
    onScrapeBatch: jest.fn(),
  } as unknown as PipelineMetricsRegistry;
  // The step only uses scrapers through the ProductScraper interface,
  // but its constructor is typed with the concrete classes for DI.
  const args = Object.values(scrapers) as unknown as [
    never,
    never,
    never,
    never,
    never,
    never,
    never,
    never,
    never,
  ];
  const step = new ImportCompetitorProductsStep(...args, images, metrics);
  return { step, scrapers, images, em: {} as EntityManager };
};

const mockRepo = (notFound: Set<string> = new Set()) =>
  (SharedProductRepository as unknown as jest.Mock).mockImplementation(() => ({
    findNotFoundEans: jest.fn().mockResolvedValue(notFound),
    upsertScrapes: jest.fn().mockResolvedValue(undefined),
  }));

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo();
});

describe('ImportCompetitorProductsStep.run', () => {
  it('does nothing for an empty EAN slice', async () => {
    const { step, scrapers, em } = build();
    await step.run(em, 'acme', CompetitorOrigin.PACHECO, []);
    expect(scrapers.pacheco.scrapeProducts).not.toHaveBeenCalled();
    expect(SharedProductRepository).not.toHaveBeenCalled();
  });

  it.each([
    ['drogal', CompetitorOrigin.DROGAL],
    ['pacheco', CompetitorOrigin.PACHECO],
    ['saoPaulo', CompetitorOrigin.SAO_PAULO],
    ['venancio', CompetitorOrigin.VENANCIO],
    ['indiana', CompetitorOrigin.INDIANA],
  ] as const)('routes %s EANs to its scraper', async (key, origin) => {
    const { step, scrapers, em } = build();
    await step.run(em, 'acme', origin, ['789']);
    expect(scrapers[key].scrapeProducts).toHaveBeenCalledWith(['789']);
    expect(SharedProductRepository).toHaveBeenCalledTimes(1);
  });

  it('persists scrapes and re-hosts images for every origin', async () => {
    const { step, images, em } = build();
    await step.run(em, 'acme', CompetitorOrigin.INDIANA, ['789']);
    expect(SharedProductRepository).toHaveBeenCalledTimes(1);
    expect(images.project).toHaveBeenCalledTimes(1);
  });

  it('skips EANs already known not-found on this origin', async () => {
    const { step, scrapers, em } = build();
    mockRepo(new Set(['111']));
    await step.run(em, 'acme', CompetitorOrigin.PACHECO, ['111', '222']);
    expect(scrapers.pacheco.scrapeProducts).toHaveBeenCalledWith(['222']);
  });

  it('scrapes nothing when every EAN is already not-found', async () => {
    const { step, scrapers, images, em } = build();
    mockRepo(new Set(['111', '222']));
    await step.run(em, 'acme', CompetitorOrigin.PACHECO, ['111', '222']);
    expect(scrapers.pacheco.scrapeProducts).not.toHaveBeenCalled();
    expect(images.project).not.toHaveBeenCalled();
  });
});
