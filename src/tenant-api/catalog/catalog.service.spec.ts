import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { CatalogService, deriveDecision } from './catalog.service';
import type { ListProductsQueryDto } from './dto/list-products.query';

const q = (extra: Partial<ListProductsQueryDto>): ListProductsQueryDto => extra;

/** em.query mock that dispatches by SQL fragment. */
const makeEm = (handlers: Array<[string, unknown]>): EntityManager =>
  ({
    query: jest.fn((sql: string) => {
      for (const [fragment, result] of handlers)
        if (sql.includes(fragment)) return result;
      return [];
    }),
  }) as unknown as EntityManager;

const base = {
  combate: { price: 10, cost: 5 },
  lowestCost: 5,
  competitorPrice: 10,
  tolerance: 0,
};

describe('deriveDecision', () => {
  it('sem-estoque when no in-stock variant (no combate)', () => {
    expect(deriveDecision({ ...base, combate: null })).toBe('sem-estoque');
  });

  it('mix when the combate is not the lowest-cost variant', () => {
    expect(
      deriveDecision({
        ...base,
        combate: { price: 10, cost: 7 },
        lowestCost: 5,
      }),
    ).toBe('mix');
  });

  it('mix has precedence over an otherwise-ok price', () => {
    expect(
      deriveDecision({
        combate: { price: 10, cost: 7 },
        lowestCost: 5,
        competitorPrice: 10, // price aligned → would be ok, but cost > min
        tolerance: 0,
      }),
    ).toBe('mix');
  });

  it('subir when combate is cheaper than competitor beyond tolerance', () => {
    expect(deriveDecision({ ...base, combate: { price: 8, cost: 5 } })).toBe(
      'subir',
    );
  });

  it('abaixar when combate is pricier than competitor beyond tolerance', () => {
    expect(deriveDecision({ ...base, combate: { price: 12, cost: 5 } })).toBe(
      'abaixar',
    );
  });

  it('ok when within the user tolerance band', () => {
    // combate 9.9 vs competitor 10 → 1% diff, tolerance 2% → ok
    expect(
      deriveDecision({
        combate: { price: 9.9, cost: 5 },
        lowestCost: 5,
        competitorPrice: 10,
        tolerance: 2,
      }),
    ).toBe('ok');
  });

  it('tolerance widens the band: same prices flip subir → ok', () => {
    const input = {
      combate: { price: 9.5, cost: 5 },
      lowestCost: 5,
      competitorPrice: 10,
    };
    expect(deriveDecision({ ...input, tolerance: 0 })).toBe('subir');
    expect(deriveDecision({ ...input, tolerance: 10 })).toBe('ok');
  });

  it('ok (ignores competitor compare) when no stocked competitor', () => {
    expect(deriveDecision({ ...base, competitorPrice: null })).toBe('ok');
  });

  it('mix still wins even when there is no competitor', () => {
    expect(
      deriveDecision({
        combate: { price: 10, cost: 7 },
        lowestCost: 5,
        competitorPrice: null,
        tolerance: 0,
      }),
    ).toBe('mix');
  });

  it('not mix when combate already is the lowest-cost variant', () => {
    expect(
      deriveDecision({
        combate: { price: 10, cost: 5 },
        lowestCost: 5,
        competitorPrice: 10,
        tolerance: 0,
      }),
    ).toBe('ok');
  });

  it('null combate cost never forces mix (unknown cost is not "higher")', () => {
    expect(
      deriveDecision({
        combate: { price: 8, cost: null },
        lowestCost: 5,
        competitorPrice: 10,
        tolerance: 0,
      }),
    ).toBe('subir'); // falls through mix → competitor compare
  });
});

const INGREDIENT_ROWS = [
  {
    ai: 'DIPIRONA',
    ean: 1,
    name: 'Dipirona 500mg',
    price: '10',
    cost: '5',
    margin: '50',
    drogalPrice: null,
    drogasilPrice: null,
    stockInSubsidiary: 3,
    competitorOrigin: 'DROGAL',
    competitorPrice: '12',
  },
  {
    ai: 'DIPIRONA',
    ean: 2,
    name: 'Dipirona 1g',
    price: '8',
    cost: '5',
    margin: '40',
    drogalPrice: null,
    drogasilPrice: null,
    stockInSubsidiary: 5,
    competitorOrigin: null,
    competitorPrice: null,
  },
];

describe('CatalogService.activeIngredientsCrossed', () => {
  it('builds the group: cheapest in-stock combate, lowest cost, competitor, decision', async () => {
    const em = makeEm([['p.active_ingredient AS ai', INGREDIENT_ROWS]]);
    const out = await new CatalogService().activeIngredientsCrossed(
      em,
      q({ subsidiary: '1', tolerance: 0 }),
    );
    expect(out.count).toBe(1);
    const g = out.rows[0];
    expect(g.activeIngredient).toBe('DIPIRONA');
    expect(g.combate).toEqual({
      ean: '2',
      name: 'Dipirona 1g',
      price: 8,
      cost: 5,
    });
    expect(g.lowestCost).toEqual({ ean: '1', cost: 5 });
    expect(g.competitorCombate).toEqual({ origin: 'DROGAL', price: 12 });
    expect(g.targetPrice).toBe(8);
    expect(g.decision).toBe('subir'); // combate 8 < competitor 12, tolerance 0
  });

  it('requires a numeric subsidiary', async () => {
    await expect(
      new CatalogService().activeIngredientsCrossed(makeEm([]), q({})),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('CatalogService.decisionCounts', () => {
  it('tallies the groups by decision with a total', async () => {
    const em = makeEm([['p.active_ingredient AS ai', INGREDIENT_ROWS]]);
    const counts = await new CatalogService().decisionCounts(
      em,
      q({ subsidiary: '1' }),
    );
    expect(counts).toEqual({
      total: 1,
      subir: 1,
      abaixar: 0,
      ok: 0,
      mix: 0,
      'sem-estoque': 0,
    });
  });
});

describe('CatalogService.stock', () => {
  it('derives the stock status from own vs competitor coverage', async () => {
    const em = makeEm([
      ['count(*)::int AS count', [{ count: '3' }]],
      [
        '"ownStock"',
        [
          { ean: 1, name: 'A', ownStock: 0, drogalStock: 5, drogasilStock: 3 },
          { ean: 2, name: 'B', ownStock: 0, drogalStock: 5, drogasilStock: 0 },
          { ean: 3, name: 'C', ownStock: 10, drogalStock: 0, drogasilStock: 0 },
        ],
      ],
    ]);
    const out = await new CatalogService().stock(em, q({}));
    expect(out.rows.map((r) => r.stockStatus)).toEqual([
      'ANALYZE_INCLUSION', // own 0, 2 competitors
      'POTENTIAL', // own 0, 1 competitor
      'OK', // own stock present
    ]);
  });
});

describe('CatalogService.exportCsv', () => {
  it('emits a header and escapes commas and quotes', async () => {
    const em = makeEm([
      [
        'AS drogal,',
        [
          {
            ean: 1,
            name: 'Tylenol, 750mg',
            supplier: 'EMS "best"',
            classification: 'Analgésico',
            cost: '5',
            price: '10',
            margin: '50',
            status: 'OK',
            drogal: '9',
            drogasil: null,
            michelassi: null,
          },
        ],
      ],
    ]);
    const csv = await new CatalogService().exportCsv(em, q({}));
    const [header, row] = csv.split('\n');
    expect(header).toBe(
      'ean,name,supplier,classification,cost,price,margin,status,drogal,drogasil,michelassi',
    );
    expect(row).toBe(
      '1,"Tylenol, 750mg","EMS ""best""",Analgésico,5,10,50,OK,9,,',
    );
  });
});
