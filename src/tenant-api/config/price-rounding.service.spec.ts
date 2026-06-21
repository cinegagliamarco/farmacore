import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { PriceRoundingService } from './price-rounding.service';

/** Dispatches em.query by SQL fragment so the service's reads/writes resolve. */
const makeEm = (
  handlers: Record<string, unknown>,
): { em: EntityManager; query: jest.Mock } => {
  const query = jest.fn((sql: string) => {
    if (sql.includes('FROM core.tenant')) return [{ id: 't1' }];
    for (const [fragment, result] of Object.entries(handlers))
      if (sql.includes(fragment)) return result;
    return [];
  });
  return { em: { query } as unknown as EntityManager, query };
};

describe('PriceRoundingService.list', () => {
  it('returns an empty list when the tenant has no ranges', async () => {
    const { em } = makeEm({ 'FROM core.price_rounding_range': [] });
    expect(await new PriceRoundingService().list(em, 's')).toEqual([]);
  });

  it('coerces numerics and groups each range with its rules', async () => {
    const { em } = makeEm({
      'FROM core.price_rounding_range': [
        { id: 'r1', priceMin: '0.00', priceMax: '10.00' },
      ],
      'FROM core.price_rounding_rule': [
        {
          rangeId: 'r1',
          decimalMin: '0.00',
          decimalMax: '0.49',
          roundTo: '0.49',
        },
        {
          rangeId: 'r1',
          decimalMin: '0.50',
          decimalMax: '0.99',
          roundTo: '0.99',
        },
      ],
    });
    expect(await new PriceRoundingService().list(em, 's')).toEqual([
      {
        id: 'r1',
        priceMin: 0,
        priceMax: 10,
        rules: [
          { decimalMin: 0, decimalMax: 0.49, roundTo: 0.49 },
          { decimalMin: 0.5, decimalMax: 0.99, roundTo: 0.99 },
        ],
      },
    ]);
  });
});

describe('PriceRoundingService.get', () => {
  it('404s when the range is not the tenant', async () => {
    const { em } = makeEm({ 'AND id = $2': [] });
    await expect(new PriceRoundingService().get(em, 's', 'r1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('PriceRoundingService.create', () => {
  it('rejects an inverted price band before inserting anything', async () => {
    const { em, query } = makeEm({});
    await expect(
      new PriceRoundingService().create(em, 's', {
        priceMin: 10,
        priceMax: 5,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(
      false,
    );
  });

  it('rejects a rule whose decimalMin exceeds decimalMax', async () => {
    const { em } = makeEm({
      'INSERT INTO core.price_rounding_range': [{ id: 'r1' }],
    });
    await expect(
      new PriceRoundingService().create(em, 's', {
        priceMin: 0,
        priceMax: 10,
        rules: [{ decimalMin: 0.9, decimalMax: 0.1, roundTo: 0.5 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('PriceRoundingService.update', () => {
  const range = [{ id: 'r1', priceMin: '0.00', priceMax: '10.00' }];
  const deletedRules = (query: jest.Mock): boolean =>
    query.mock.calls.some(([sql]) =>
      sql.includes('DELETE FROM core.price_rounding_rule'),
    );

  it('re-validates the band against the stored value when a bound is omitted', async () => {
    const { em } = makeEm({ 'AND id = $2': range });
    // priceMax omitted → validated against the stored 10; 20 > 10 → 400.
    await expect(
      new PriceRoundingService().update(em, 's', 'r1', { priceMin: 20 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('replaces the rules wholesale when dto.rules is provided', async () => {
    const { em, query } = makeEm({ 'AND id = $2': range });
    await new PriceRoundingService().update(em, 's', 'r1', {
      rules: [{ decimalMin: 0, decimalMax: 0.49, roundTo: 0.49 }],
    });
    expect(deletedRules(query)).toBe(true);
  });

  it('leaves the rules untouched when dto.rules is omitted', async () => {
    const { em, query } = makeEm({ 'AND id = $2': range });
    await new PriceRoundingService().update(em, 's', 'r1', { priceMin: 5 });
    expect(deletedRules(query)).toBe(false);
  });
});

describe('PriceRoundingService.remove', () => {
  it('404s when the range is not the tenant', async () => {
    const { em } = makeEm({ 'AND id = $2': [] });
    await expect(
      new PriceRoundingService().remove(em, 's', 'r1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('deletes the range and reports it', async () => {
    const { em, query } = makeEm({
      'AND id = $2': [{ id: 'r1', priceMin: '0', priceMax: '10' }],
    });
    expect(await new PriceRoundingService().remove(em, 's', 'r1')).toEqual({
      id: 'r1',
      deleted: true,
    });
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('DELETE FROM core.price_rounding_range'),
      ),
    ).toBe(true);
  });
});
