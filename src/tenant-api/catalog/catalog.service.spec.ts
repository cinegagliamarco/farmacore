import { deriveDecision } from './catalog.service';

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
});
