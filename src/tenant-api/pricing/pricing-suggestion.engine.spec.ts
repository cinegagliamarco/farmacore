import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import {
  applyPriceRounding,
  computeSuggestion,
  findClusterRuleForProduct,
  findRuleForProduct,
  resolveWinner,
  suggestionDelta,
  type PriceRoundingRange,
  type SuggestionProduct,
  type SuggestionRule,
} from './pricing-suggestion.engine';

const DG = CompetitorOrigin.DROGAL;
const DS = CompetitorOrigin.DROGASIL;
const MI = CompetitorOrigin.MICHELASSI;

const product = (
  over: Partial<SuggestionProduct> & {
    competitorPrices?: Partial<Record<CompetitorOrigin, number>>;
  } = {},
): SuggestionProduct => ({
  id: 1,
  ean: '7891234567890',
  nome: 'Dipirona 500mg',
  fabricante: 'Lab X',
  classificacao: 'MEDICAMENTOS > GENÉRICOS > DOR',
  cadernoOferta: '',
  custo: 6,
  precoVenda: 8,
  precoOferta: 0,
  competitorPrices: {},
  margem: 25,
  pbm: false,
  ...over,
});

const margemRule: SuggestionRule = {
  id: 'r1',
  name: 'Piso geral',
  classifications: [],
  clusterId: null,
  excludeClusterIds: [],
  strategy: 'margem',
  competitorMode: 'weighted',
  minMargin: 30,
  competitors: [],
  variationPct: 0,
  noCompetitorMargin: null,
  priceControlled: false,
  ignorePbm: false,
  applyRounding: false,
  active: true,
  createdAt: '2026-06-01T00:00:00.000Z',
};

const concorrenciaRule: SuggestionRule = {
  ...margemRule,
  id: 'r2',
  name: 'Seguir Drogal',
  strategy: 'concorrencia',
  competitors: [{ competitor: DG, weight: 1 }],
};

describe('computeSuggestion — estratégia margem', () => {
  it('margem abaixo da trava → sobe pro piso (basis margem_minima)', () => {
    // custo 6, P. Venda 8 (margem 25%) < trava 30% → 6/0.7 = 8.57.
    const r = computeSuggestion(product(), margemRule);
    expect(r.kind).toBe('suggestion');
    if (r.kind !== 'suggestion') return;
    expect(r.suggestion.basis).toBe('margem_minima');
    expect(r.suggestion.price).toBeCloseTo(8.57, 2);
  });

  it('margem ok → margem_ok (não sugere)', () => {
    const r = computeSuggestion(product({ precoVenda: 12 }), margemRule);
    expect(r).toMatchObject({ kind: 'none', reason: 'margem_ok' });
  });

  it('custo zero → sem_custo', () => {
    const r = computeSuggestion(product({ custo: 0 }), margemRule);
    expect(r).toMatchObject({ kind: 'none', reason: 'sem_custo' });
  });
});

describe('computeSuggestion — PBM', () => {
  it('concorrência nunca segue produto PBM (bloqueio hard-coded)', () => {
    const r = computeSuggestion(
      product({ pbm: true, competitorPrices: { [DG]: 10 } }),
      concorrenciaRule,
    );
    expect(r).toMatchObject({ kind: 'none', reason: 'pbm' });
  });

  it('PBM não bloqueia margem quando a regra não desconsidera', () => {
    const r = computeSuggestion(product({ pbm: true }), margemRule);
    expect(r.kind).toBe('suggestion');
  });

  it('ignorePbm desconsidera PBM mesmo na margem', () => {
    const r = computeSuggestion(product({ pbm: true }), {
      ...margemRule,
      ignorePbm: true,
    });
    expect(r).toMatchObject({ kind: 'none', reason: 'pbm' });
  });
});

describe('computeSuggestion — concorrência: média ponderada', () => {
  it('dois concorrentes → média ponderada + composição', () => {
    const r = computeSuggestion(
      product({ competitorPrices: { [DG]: 10, [DS]: 14 } }),
      {
        ...concorrenciaRule,
        minMargin: 30,
        competitors: [
          { competitor: DG, weight: 50 },
          { competitor: DS, weight: 50 },
        ],
      },
    );
    expect(r.kind).toBe('suggestion');
    if (r.kind !== 'suggestion') return;
    expect(r.suggestion.basis).toBe('concorrencia');
    expect(r.suggestion.price).toBeCloseTo(12, 2);
    expect(r.suggestion.priceComposition).toEqual([
      { competitor: DG, price: 10, weight: 50 },
      { competitor: DS, price: 14, weight: 50 },
    ]);
  });

  it('concorrente sem preço sai da conta e renormaliza', () => {
    const r = computeSuggestion(
      product({ competitorPrices: { [DG]: 0, [DS]: 10, [MI]: 12 } }),
      {
        ...concorrenciaRule,
        minMargin: 30,
        competitors: [
          { competitor: DG, weight: 50 },
          { competitor: DS, weight: 25 },
          { competitor: MI, weight: 25 },
        ],
      },
    );
    expect(r.kind).toBe('suggestion');
    if (r.kind !== 'suggestion') return;
    expect(r.suggestion.price).toBeCloseTo(11, 2);
  });

  it('concorrente abaixo da trava → clampa no piso (lockApplied)', () => {
    const r = computeSuggestion(product({ competitorPrices: { [DG]: 5 } }), {
      ...concorrenciaRule,
      minMargin: 30,
    });
    expect(r.kind).toBe('suggestion');
    if (r.kind !== 'suggestion') return;
    expect(r.suggestion.lockApplied).toBe(true);
    expect(r.suggestion.price).toBeCloseTo(8.57, 2);
  });
});

describe('computeSuggestion — concorrência: cascade', () => {
  const cascadeRule: SuggestionRule = {
    ...concorrenciaRule,
    competitorMode: 'cascade',
    minMargin: 30,
    competitors: [
      { competitor: DG, weight: 1 },
      { competitor: DS, weight: 1 },
      { competitor: MI, weight: 1 },
    ],
  };

  it('usa o primeiro da ordem com preço', () => {
    const r = computeSuggestion(
      product({ competitorPrices: { [DG]: 10, [DS]: 14, [MI]: 20 } }),
      cascadeRule,
    );
    expect(r.kind).toBe('suggestion');
    if (r.kind !== 'suggestion') return;
    expect(r.suggestion.price).toBeCloseTo(10, 2);
    expect(r.suggestion.priceComposition).toEqual([
      { competitor: DG, price: 10, weight: 1 },
    ]);
  });

  it('primeiro sem preço → cai pro segundo', () => {
    const r = computeSuggestion(
      product({ competitorPrices: { [DS]: 14, [MI]: 20 } }),
      cascadeRule,
    );
    expect(r.kind).toBe('suggestion');
    if (r.kind !== 'suggestion') return;
    expect(r.suggestion.price).toBeCloseTo(14, 2);
  });
});

describe('computeSuggestion — concorrência: lowest', () => {
  const lowestRule: SuggestionRule = {
    ...concorrenciaRule,
    competitorMode: 'lowest',
    minMargin: 30,
    competitors: [
      { competitor: DG, weight: 1 },
      { competitor: DS, weight: 1 },
      { competitor: MI, weight: 1 },
    ],
  };

  it('usa o menor preço entre os selecionados', () => {
    const r = computeSuggestion(
      product({ competitorPrices: { [DG]: 14, [DS]: 10, [MI]: 18 } }),
      lowestRule,
    );
    expect(r.kind).toBe('suggestion');
    if (r.kind !== 'suggestion') return;
    expect(r.suggestion.price).toBeCloseTo(10, 2);
    expect(r.suggestion.priceComposition).toEqual([
      { competitor: DS, price: 10, weight: 1 },
    ]);
  });
});

describe('computeSuggestion — margem-alvo sem concorrência', () => {
  const sem = product({ competitorPrices: {} });

  it('abaixo do alvo → sobe e mira a margem-alvo', () => {
    const r = computeSuggestion(sem, {
      ...concorrenciaRule,
      minMargin: 30,
      noCompetitorMargin: 40,
    });
    expect(r.kind).toBe('suggestion');
    if (r.kind !== 'suggestion') return;
    expect(r.suggestion.basis).toBe('margem_sem_concorrente');
    expect(r.suggestion.price).toBeCloseTo(10, 2); // 6/0.6
  });

  it('null + margem ok → sem_concorrente', () => {
    const r = computeSuggestion(product({ precoVenda: 12 }), {
      ...concorrenciaRule,
      minMargin: 30,
      noCompetitorMargin: null,
    });
    expect(r).toMatchObject({ kind: 'none', reason: 'sem_concorrente' });
  });

  it('margem-alvo 0 (≠ null) entra no caminho sem-concorrência e clampa', () => {
    const r = computeSuggestion(product({ precoVenda: 12 }), {
      ...concorrenciaRule,
      minMargin: 30,
      noCompetitorMargin: 0,
    });
    expect(r.kind).toBe('suggestion');
    if (r.kind !== 'suggestion') return;
    expect(r.suggestion.basis).toBe('margem_sem_concorrente');
    expect(r.suggestion.lockApplied).toBe(true);
  });
});

describe('computeSuggestion — alvo oferta/venda e motivos', () => {
  it('precoOferta > 0 → mira oferta', () => {
    const r = computeSuggestion(
      product({ precoOferta: 7, precoVenda: 20 }),
      margemRule,
    );
    expect(r.kind).toBe('suggestion');
    if (r.kind !== 'suggestion') return;
    expect(r.suggestion.target).toBe('precoOferta');
  });

  it('oferta acima do P. Venda → acima_do_venda', () => {
    // custo 6, oferta 7 (base), venda 8; piso 6/0.7=8.57 > venda 8 → acima_do_venda.
    const r = computeSuggestion(
      product({ precoOferta: 7, precoVenda: 8 }),
      margemRule,
    );
    expect(r).toMatchObject({ kind: 'none', reason: 'acima_do_venda' });
  });

  it('já no alvo → ja_no_alvo', () => {
    // base 8.57 já é o piso → diff < 0.005.
    const r = computeSuggestion(product({ precoVenda: 8.57 }), margemRule);
    expect(r).toMatchObject({ kind: 'none', reason: 'ja_no_alvo' });
  });
});

describe('findRuleForProduct — classificação por prefixo', () => {
  const specific: SuggestionRule = {
    ...margemRule,
    id: 'spec',
    classifications: ['MEDICAMENTOS > GENÉRICOS'],
  };
  const catchAll: SuggestionRule = {
    ...margemRule,
    id: 'all',
    classifications: [],
  };

  it('mais específico vence o catch-all', () => {
    const r = findRuleForProduct(product(), [catchAll, specific]);
    expect(r?.id).toBe('spec');
  });

  it('prefixo sem delimitador não casa (MED ⊄ MEDICAMENTOS)', () => {
    const r = findRuleForProduct(product(), [
      { ...margemRule, id: 'x', classifications: ['MED'] },
    ]);
    expect(r).toBeNull();
  });

  it('desempate por createdAt asc → id asc', () => {
    const a = { ...specific, id: 'a', createdAt: '2026-01-01T00:00:00.000Z' };
    const b = { ...specific, id: 'b', createdAt: '2026-02-01T00:00:00.000Z' };
    expect(findRuleForProduct(product(), [b, a])?.id).toBe('a');
  });
});

describe('cluster — precedência e exclusão', () => {
  const classRule: SuggestionRule = {
    ...margemRule,
    id: 'class',
    classifications: ['MEDICAMENTOS > GENÉRICOS'],
  };
  const clusterRule: SuggestionRule = {
    ...concorrenciaRule,
    id: 'clu',
    clusterId: 'c1',
    competitors: [{ competitor: DG, weight: 1 }],
  };

  it('regra de cluster vence a de classificação (resolveWinner)', () => {
    const clu = findClusterRuleForProduct([clusterRule], ['c1']);
    const cls = findRuleForProduct(product(), [classRule], ['c1']);
    const { winner, overrodeRule } = resolveWinner(clu, cls);
    expect(winner?.id).toBe('clu');
    expect(overrodeRule?.id).toBe('class');
  });

  it('excludeClusterIds tira o produto da regra', () => {
    const excluding = { ...classRule, excludeClusterIds: ['c1'] };
    const r = findRuleForProduct(product(), [excluding], ['c1']);
    expect(r).toBeNull();
  });

  it('regra de cluster só vale para membros do cluster', () => {
    const r = findClusterRuleForProduct([clusterRule], ['outro']);
    expect(r).toBeNull();
  });
});

describe('applyPriceRounding', () => {
  const ranges: PriceRoundingRange[] = [
    {
      price_min: 0,
      price_max: 100,
      rules: [{ decimal_min: 0, decimal_max: 0.99, round_to: 0.99 }],
    },
  ];

  it('snap do decimal para round_to dentro da faixa', () => {
    expect(applyPriceRounding(8.57, ranges)).toBeCloseTo(8.99, 2);
  });

  it('respeita o piso de margem (sobe um inteiro)', () => {
    // 8.99 < piso 9 → sobe pro próximo inteiro + round_to = 9.99.
    expect(applyPriceRounding(8.57, ranges, 9)).toBeCloseTo(9.99, 2);
  });

  it('fora de qualquer faixa → preço inalterado', () => {
    expect(applyPriceRounding(200, ranges)).toBe(200);
  });
});

describe('suggestionDelta', () => {
  it('positivo quando o sugerido sobe', () => {
    const r = computeSuggestion(product(), margemRule); // 8 → 8.57
    expect(suggestionDelta(product(), r)).toBeGreaterThan(0);
  });

  it('null para resultado sem sugestão', () => {
    expect(
      suggestionDelta(product(), { kind: 'none', reason: 'margem_ok' }),
    ).toBeNull();
  });
});
