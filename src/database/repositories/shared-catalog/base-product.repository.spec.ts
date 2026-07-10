import { EntityManager } from 'typeorm';
import { BaseProductRepository } from './base-product.repository';

describe('BaseProductRepository missing-EAN queries', () => {
  let query: jest.Mock;
  let repo: BaseProductRepository;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([{ ean: '111' }, { ean: '222' }]);
    repo = new BaseProductRepository({ query } as unknown as EntityManager);
  });

  it('findEansMissingWeight scopes to the tenant catalog via the product join', async () => {
    const eans = await repo.findEansMissingWeight();

    expect(eans).toEqual(['111', '222']);
    const sql = query.mock.calls[0][0] as string;
    // Tenant scope: join with the tenant-schema `product` (resolved by the
    // caller EM's search_path), live rows only. Without it every tenant
    // would re-enqueue the whole shared catalog daily.
    expect(sql).toMatch(/JOIN product p ON p\.ean = bp\.ean/);
    expect(sql).toMatch(/p\.deleted_at IS NULL/);
    expect(sql).toContain('bp.weight IS NULL');
  });

  it('findEansMissingMeasures prefixes every predicate column with bp.', async () => {
    await repo.findEansMissingMeasures();

    const sql = query.mock.calls[0][0] as string;
    expect(sql).toMatch(/JOIN product p ON p\.ean = bp\.ean/);
    expect(sql).toMatch(/p\.deleted_at IS NULL/);
    expect(sql).toContain(
      'bp.height IS NULL AND bp.length IS NULL AND bp.width IS NULL',
    );
  });
});
