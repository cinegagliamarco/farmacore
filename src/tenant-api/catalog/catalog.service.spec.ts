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

/** Recording em: returns [{count:'0'}] for any count query, [] otherwise,
 *  while keeping every (sql, params) call on the jest.fn for inspection. */
const recordingEm = (): {
  em: EntityManager;
  query: jest.Mock;
} => {
  const query = jest.fn((sql: string) =>
    sql.includes('count(*)') ? [{ count: '0' }] : [],
  );
  return { em: { query } as unknown as EntityManager, query };
};

/** The (sql, params) of the paginated data query — matched by its `LIMIT $`
 *  tail (a positive marker; negating `count(*)` would misfire on stockMetrics,
 *  whose data query itself uses count(*) FILTER). */
const dataCall = (query: jest.Mock): [string, unknown[]] => {
  const call = query.mock.calls.find((c: [string, unknown[]]) =>
    c[0].includes('LIMIT $'),
  );
  if (!call) throw new Error('no data query recorded');
  return call as [string, unknown[]];
};

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

describe('CatalogService.buildFilters (via .list/.crossed)', () => {
  it('active=true → p.active = $N with boolean true in params', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().list(em, q({ active: 'true' }));
    const [sql, params] = dataCall(query);
    expect(sql).toContain('WHERE p.active = $1');
    expect(params).toContain(true);
    expect(params[0]).toBe(true);
  });

  it('active=false → boolean false in params', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().list(em, q({ active: 'false' }));
    const [sql, params] = dataCall(query);
    expect(sql).toContain('WHERE p.active = $1');
    expect(params[0]).toBe(false);
  });

  it('receiptFrom → p.receipt_date >= $N with the date in params', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().list(em, q({ receiptFrom: '2026-01-01' }));
    const [sql, params] = dataCall(query);
    expect(sql).toContain('WHERE p.receipt_date >= $1');
    expect(params[0]).toBe('2026-01-01');
  });

  it('receiptTo → p.receipt_date <= $N with the date in params', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().list(em, q({ receiptTo: '2026-12-31' }));
    const [sql, params] = dataCall(query);
    expect(sql).toContain('WHERE p.receipt_date <= $1');
    expect(params[0]).toBe('2026-12-31');
  });

  it('receiptFrom + receiptTo → both clauses ANDed', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().list(
      em,
      q({ receiptFrom: '2026-01-01', receiptTo: '2026-12-31' }),
    );
    const [sql, params] = dataCall(query);
    expect(sql).toContain(
      'WHERE p.receipt_date >= $1 AND p.receipt_date <= $2',
    );
    expect(params[0]).toBe('2026-01-01');
    expect(params[1]).toBe('2026-12-31');
  });

  it('monitored=true → p.monitored = $N with boolean true', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().list(em, q({ monitored: 'true' }));
    const [sql, params] = dataCall(query);
    expect(sql).toContain('WHERE p.monitored = $1');
    expect(params[0]).toBe(true);
  });

  it('monitored=false → boolean false', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().list(em, q({ monitored: 'false' }));
    const [sql, params] = dataCall(query);
    expect(sql).toContain('WHERE p.monitored = $1');
    expect(params[0]).toBe(false);
  });

  it('status csv → p.status = ANY($N) with the split array', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().list(em, q({ status: 'OK,ATENCAO' }));
    const [sql, params] = dataCall(query);
    expect(sql).toContain('WHERE p.status = ANY($1)');
    expect(params[0]).toEqual(['OK', 'ATENCAO']);
  });

  it('eans csv → p.ean = ANY($N::bigint[]) with the split array', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().list(em, q({ eans: '111, 222' }));
    const [sql, params] = dataCall(query);
    expect(sql).toContain('WHERE p.ean = ANY($1::bigint[])');
    expect(params[0]).toEqual(['111', '222']);
  });

  it('name → p.name ILIKE with the percent-wrapped value', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().list(em, q({ name: 'dipirona' }));
    const [sql, params] = dataCall(query);
    expect(sql).toContain('WHERE p.name ILIKE $1');
    expect(params[0]).toBe('%dipirona%');
  });

  it('supplier → p.supplier ILIKE with the percent-wrapped value', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().list(em, q({ supplier: 'EMS' }));
    const [sql, params] = dataCall(query);
    expect(sql).toContain('WHERE p.supplier ILIKE $1');
    expect(params[0]).toBe('%EMS%');
  });

  it('classification → c.name ILIKE with the percent-wrapped value', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().list(em, q({ classification: 'Analgésico' }));
    const [sql, params] = dataCall(query);
    expect(sql).toContain('WHERE c.name ILIKE $1');
    expect(params[0]).toBe('%Analgésico%');
  });

  it('multiple filters keep buildFilters order and increment placeholders', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().list(
      em,
      q({ name: 'dipirona', active: 'true', receiptFrom: '2026-01-01' }),
    );
    const [sql, params] = dataCall(query);
    expect(sql).toContain(
      'WHERE p.name ILIKE $1 AND p.active = $2 AND p.receipt_date >= $3',
    );
    expect(params.slice(0, 3)).toEqual(['%dipirona%', true, '2026-01-01']);
  });

  it('no filters → empty WHERE (params only carry paginate)', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().list(em, q({}));
    const [sql, params] = dataCall(query);
    expect(sql).not.toContain('WHERE');
    // only LIMIT/OFFSET params
    expect(params).toEqual([50, 0]);
  });

  it('filters reach .crossed() the same way', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().crossed(em, q({ active: 'false' }));
    const [sql, params] = dataCall(query);
    expect(sql).toContain('WHERE p.active = $1');
    expect(params[0]).toBe(false);
  });
});

describe('CatalogService.paginate (via .list)', () => {
  it('clamps perPage above MAX_PER_PAGE to 200 (returned + LIMIT param)', async () => {
    const { em, query } = recordingEm();
    const out = await new CatalogService().list(em, q({ perPage: 500 }));
    expect(out.perPage).toBe(200);
    const [sql, params] = dataCall(query);
    expect(sql).toContain('LIMIT $1 OFFSET $2');
    expect(params).toEqual([200, 0]);
  });

  it('defaults perPage to 50', async () => {
    const { em, query } = recordingEm();
    const out = await new CatalogService().list(em, q({}));
    expect(out.perPage).toBe(50);
    const [, params] = dataCall(query);
    expect(params).toEqual([50, 0]);
  });

  it('offset = (page-1)*perPage is passed as the OFFSET param', async () => {
    const { em, query } = recordingEm();
    const out = await new CatalogService().list(em, q({ page: 3, perPage: 20 }));
    expect(out.page).toBe(3);
    const [, params] = dataCall(query);
    expect(params).toEqual([20, 40]);
  });
});

describe('CatalogService.crossed', () => {
  it('selects the active flag and the competitor price columns', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().crossed(em, q({}));
    const [sql] = dataCall(query);
    expect(sql).toContain('p.active');
    expect(sql).toContain(`dg.price AS "drogalPrice"`);
    expect(sql).toContain(`ds.price AS "drogasilPrice"`);
    expect(sql).toContain(`mi.price AS "michelassiPrice"`);
  });

  it('normalizes ean to string in the returned rows', async () => {
    const em = makeEm([
      ['count(*)::int AS count', [{ count: '1' }]],
      [`dg.price AS "drogalPrice"`, [{ ean: 7891234567890, name: 'X' }]],
    ]);
    const out = await new CatalogService().crossed(em, q({}));
    expect(out.rows[0].ean).toBe('7891234567890');
  });
});

describe('CatalogService.strategicPrice', () => {
  const STRATEGIC_COND =
    `(dg.metadata->>'observation' IS NOT NULL` +
    ` OR ds.metadata->>'observation' IS NOT NULL` +
    ` OR (p.deals IS NOT NULL AND p.deals <> '{}'::jsonb))`;

  it('with no filters starts the condition with WHERE', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().strategicPrice(em, q({}));
    const [sql, params] = dataCall(query);
    expect(sql).toContain(`WHERE ${STRATEGIC_COND}`);
    expect(sql).not.toContain('AND (dg.metadata');
    expect(params).toEqual([50, 0]);
  });

  it('with filters appends the condition with AND', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().strategicPrice(em, q({ active: 'true' }));
    const [sql, params] = dataCall(query);
    expect(sql).toContain(`WHERE p.active = $1 AND ${STRATEGIC_COND}`);
    expect(params[0]).toBe(true);
  });

  it('returns rows normalized with the count from the count query', async () => {
    const em = makeEm([
      ['count(*)::int AS count', [{ count: '4' }]],
      [`p.deals,`, [{ ean: 123, name: 'Y' }]],
    ]);
    const out = await new CatalogService().strategicPrice(em, q({}));
    expect(out.count).toBe(4);
    expect(out.rows[0].ean).toBe('123');
  });
});

describe('CatalogService.genericMissing', () => {
  it('appends the generic-missing predicate with WHERE when no filters', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().genericMissing(em, q({}));
    const [sql] = dataCall(query);
    expect(sql).toContain(
      'WHERE p.generic IS TRUE AND p.active_ingredient IS NULL',
    );
  });

  it('appends the predicate with AND when filters are present', async () => {
    const { em, query } = recordingEm();
    await new CatalogService().genericMissing(em, q({ supplier: 'EMS' }));
    const [sql, params] = dataCall(query);
    expect(sql).toContain(
      'WHERE p.supplier ILIKE $1 AND p.generic IS TRUE AND p.active_ingredient IS NULL',
    );
    expect(params[0]).toBe('%EMS%');
  });

  it('returns the count and normalized rows', async () => {
    const em = makeEm([
      ['count(*)::int AS count', [{ count: '2' }]],
      ['SELECT p.ean, p.name, p.supplier', [{ ean: 999, name: 'Z' }]],
    ]);
    const out = await new CatalogService().genericMissing(em, q({}));
    expect(out.count).toBe(2);
    expect(out.rows[0].ean).toBe('999');
  });
});

describe('CatalogService.stockMetrics', () => {
  it('coerces the single aggregated row to numbers', async () => {
    const em = makeEm([
      [
        '"ownWithStock"',
        [
          {
            total: '120',
            ownWithStock: '80',
            drogalWithStock: '40',
            drogasilWithStock: '30',
            michelassiWithStock: '10',
          },
        ],
      ],
    ]);
    const out = await new CatalogService().stockMetrics(em, q({}));
    expect(out).toEqual({
      total: 120,
      ownWithStock: 80,
      drogalWithStock: 40,
      drogasilWithStock: 30,
      michelassiWithStock: 10,
    });
  });

  it('defaults to zeros when no row comes back', async () => {
    const em = makeEm([]);
    const out = await new CatalogService().stockMetrics(em, q({}));
    expect(out).toEqual({
      total: 0,
      ownWithStock: 0,
      drogalWithStock: 0,
      drogasilWithStock: 0,
      michelassiWithStock: 0,
    });
  });
});
