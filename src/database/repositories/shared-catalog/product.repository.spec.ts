import { EntityManager } from 'typeorm';
import { SharedProductRepository } from './product.repository';
import { ScrapedProduct } from '../../../scrapers/types';
import { CompetitorOrigin } from '../../enums/competitor-origin.enum';

function makeRepo() {
  const upsert = jest.fn().mockResolvedValue(undefined);
  const em = { getRepository: () => ({ upsert }) } as unknown as EntityManager;
  return { repo: new SharedProductRepository(em), upsert };
}

const scrape = (over: Partial<ScrapedProduct>): ScrapedProduct => ({
  ean: '789',
  origin: CompetitorOrigin.PACHECO,
  found: true,
  ...over,
});

describe('SharedProductRepository.upsertScrapes', () => {
  it('skips transport-error scrapes so a 403/timeout keeps the last good price', async () => {
    const { repo, upsert } = makeRepo();
    await repo.upsertScrapes([
      scrape({ ean: '1', price: '9.90' }),
      scrape({
        ean: '2',
        found: false,
        error: 'Request failed with status code 403',
      }),
    ]);
    const rows = upsert.mock.calls[0][0] as Array<{ ean: string }>;
    expect(rows.map((r) => r.ean)).toEqual(['1']);
  });

  it('does not call upsert when every scrape errored', async () => {
    const { repo, upsert } = makeRepo();
    await repo.upsertScrapes([
      scrape({ found: false, error: 'ECONNRESET' }),
      scrape({ found: false, error: 'timeout' }),
    ]);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('still persists genuine not-found (found:false without error)', async () => {
    const { repo, upsert } = makeRepo();
    await repo.upsertScrapes([scrape({ found: false })]);
    const rows = upsert.mock.calls[0][0] as Array<{
      metadata: { found: boolean };
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.found).toBe(false);
  });
});
