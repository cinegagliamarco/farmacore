import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import {
  CompetitorMode,
  SuggestionStrategy,
} from '../../database/entities/tenant/pricing-suggestion-rule.entity';

/**
 * Motor de sugestão de preços — TS puro, sem dependências (port quase-verbatim
 * do pricy-shelf `pricing-suggestion-engine.ts`). Única diferença: os preços de
 * concorrente são um mapa por origem (`competitorPrices`) em vez dos 3 campos
 * fixos drogal/drogasil/michelassi, para generalizar às N origens do tenant.
 * Toda a lógica (estratégias, modos de concorrência, cluster, arredondamento,
 * 7 motivos) é preservada. É a rede de segurança do port — coberto por
 * `pricing-suggestion.engine.spec.ts`.
 */

export type SuggestionTarget = 'precoVenda' | 'precoOferta';

export interface SuggestionProduct {
  id: number;
  ean: string;
  nome: string;
  fabricante: string;
  classificacao: string;
  cadernoOferta: string;
  custo: number;
  precoVenda: number;
  precoOferta: number;
  /** Preço de cada origem de concorrente (0 = sem preço). */
  competitorPrices: Partial<Record<CompetitorOrigin, number>>;
  margem: number;
  pbm: boolean;
}

/** Regra como o motor a consome (numéricos podem chegar como string do DB). */
export interface SuggestionRule {
  id: string;
  name: string;
  classifications: string[];
  clusterId: string | null;
  clusterName?: string | null;
  excludeClusterIds: string[];
  strategy: SuggestionStrategy;
  minMargin: number | string;
  competitorMode: CompetitorMode;
  competitors: { competitor: string; weight: number | string }[];
  variationPct: number | string;
  noCompetitorMargin: number | string | null;
  priceControlled: boolean;
  ignorePbm: boolean;
  applyRounding: boolean;
  active: boolean;
  createdAt: string;
}

export interface PriceRoundingRule {
  decimal_min: number;
  decimal_max: number;
  round_to: number;
}

export interface PriceRoundingRange {
  price_min: number;
  price_max: number;
  active?: boolean;
  rules: PriceRoundingRule[];
}

export interface PriceSuggestion {
  price: number;
  margin: number;
  rule: SuggestionRule;
  target: SuggestionTarget;
  basis: 'concorrencia' | 'margem_minima' | 'margem_sem_concorrente';
  lockApplied: boolean;
  priceComposition:
    | { competitor: string; price: number; weight: number }[]
    | null;
}

export type NoSuggestionReason =
  | 'sem_regra'
  | 'sem_custo'
  | 'margem_ok'
  | 'sem_concorrente'
  | 'pbm'
  | 'acima_do_venda'
  | 'ja_no_alvo';

export type SuggestionResult =
  | { kind: 'suggestion'; suggestion: PriceSuggestion }
  | { kind: 'none'; reason: NoSuggestionReason; rule?: SuggestionRule };

const CLASSIFICATION_DELIMITERS = [' > ', ' / ', ' - '];

const round2 = (n: number): number => Math.round(n * 100) / 100;

const toFiniteNumber = (
  value: number | string | null,
  fallback = 0,
): number => {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : fallback;
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value.replace('%', '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const competitorPrice = (
  product: SuggestionProduct,
  competitor: string,
): number =>
  Number(product.competitorPrices[competitor as CompetitorOrigin] ?? 0);

function classificationMatches(
  productClass: string,
  ruleClass: string,
): boolean {
  const p = productClass.trim().toUpperCase();
  const r = ruleClass.trim().toUpperCase();
  if (!p || !r) return false;
  if (p === r) return true;
  return CLASSIFICATION_DELIMITERS.some((d) => p.startsWith(r + d));
}

/** Regra subtrai os clusters em `excludeClusterIds`: produto em qualquer um fica fora. */
function isExcluded(
  rule: SuggestionRule,
  productClusterIds: string[],
): boolean {
  return (
    rule.excludeClusterIds.length > 0 &&
    rule.excludeClusterIds.some((id) => productClusterIds.includes(id))
  );
}

export function findRuleForProduct(
  product: SuggestionProduct,
  rules: SuggestionRule[],
  productClusterIds: string[] = [],
): SuggestionRule | null {
  let best: SuggestionRule | null = null;
  let bestLen = -1;
  for (const rule of rules) {
    if (!rule.active) continue;
    if (isExcluded(rule, productClusterIds)) continue;
    let matchLen = -1;
    const classifications = Array.isArray(rule.classifications)
      ? rule.classifications
      : [];
    if (classifications.length === 0) {
      matchLen = 0;
    } else {
      for (const c of classifications) {
        if (
          c.length > matchLen &&
          classificationMatches(product.classificacao, c)
        ) {
          matchLen = c.length;
        }
      }
    }
    if (matchLen < 0) continue;
    const winsTie =
      matchLen === bestLen &&
      best !== null &&
      (rule.createdAt < best.createdAt ||
        (rule.createdAt === best.createdAt && rule.id < best.id));
    if (matchLen > bestLen || winsTie) {
      best = rule;
      bestLen = matchLen;
    }
  }
  return best;
}

/**
 * Vencedor entre as regras de CLUSTER que cobrem o produto. Recebe só regras de
 * cluster (`clusterId != null`, particionadas no service). Desempate igual ao da
 * classificação: createdAt asc → id asc. Regra inativa é pulada.
 */
export function findClusterRuleForProduct(
  clusterRules: SuggestionRule[],
  clusterIds: string[],
): SuggestionRule | null {
  let best: SuggestionRule | null = null;
  for (const rule of clusterRules) {
    if (!rule.active) continue;
    if (!rule.clusterId || !clusterIds.includes(rule.clusterId)) continue;
    if (isExcluded(rule, clusterIds)) continue;
    const beats =
      best === null ||
      rule.createdAt < best.createdAt ||
      (rule.createdAt === best.createdAt && rule.id < best.id);
    if (beats) best = rule;
  }
  return best;
}

/**
 * Cluster vence em definitivo: se há regra de cluster, ela governa — mesmo que
 * compute `none`, a regra de classificação não volta. `overrodeRule` = a regra
 * de classificação que teria vencido (para a badge "Origem"); null sem sobreposição.
 */
export function resolveWinner(
  clusterRule: SuggestionRule | null,
  classRule: SuggestionRule | null,
): { winner: SuggestionRule | null; overrodeRule: SuggestionRule | null } {
  if (clusterRule) return { winner: clusterRule, overrodeRule: classRule };
  return { winner: classRule, overrodeRule: null };
}

export function priceForMargin(custo: number, marginPct: number): number {
  return custo / (1 - marginPct / 100);
}

export function applyPriceRounding(
  price: number,
  ranges: PriceRoundingRange[],
  minPrice?: number,
): number {
  const range = ranges.find(
    (r) => price >= r.price_min && price <= r.price_max,
  );
  if (!range) return price;
  const integer = Math.floor(price);
  const decimal = round2(price - integer);
  const rule = range.rules.find(
    (r) => decimal >= r.decimal_min && decimal <= r.decimal_max,
  );
  if (!rule) return price;
  let rounded = round2(integer + rule.round_to);
  if (minPrice !== undefined && rounded < minPrice) {
    rounded = round2(integer + 1 + rule.round_to);
  }
  return rounded;
}

export function computeSuggestion(
  product: SuggestionProduct,
  rule: SuggestionRule,
  roundingRanges: PriceRoundingRange[] = [],
): SuggestionResult {
  const { custo } = product;
  const basePrice =
    product.precoOferta > 0 ? product.precoOferta : product.precoVenda;
  const minMargin = toFiniteNumber(rule.minMargin, 0);
  const variationPct = toFiniteNumber(rule.variationPct, 0);
  if (custo <= 0 || basePrice <= 0 || minMargin >= 100) {
    return { kind: 'none', reason: 'sem_custo', rule };
  }

  // Preço PBM do concorrente é subsidiado, não preço de gôndola — a estratégia
  // concorrência nunca segue. ignorePbm desconsidera o produto em QUALQUER
  // estratégia (inclusive margem).
  if (product.pbm && (rule.strategy === 'concorrencia' || rule.ignorePbm)) {
    return { kind: 'none', reason: 'pbm', rule };
  }

  const floor = priceForMargin(custo, minMargin);
  let target: number | null = null;
  let basis: PriceSuggestion['basis'] = 'margem_minima';
  let lockApplied = false;
  let priceComposition: PriceSuggestion['priceComposition'] = null;

  if (rule.strategy === 'concorrencia') {
    const competitors = Array.isArray(rule.competitors) ? rule.competitors : [];
    let alvo: number | null = null;

    if (rule.competitorMode === 'cascade') {
      // Cascata: usa o primeiro concorrente DA ORDEM DO ARRAY (a ordem que o
      // operador definiu em rule.competitors) que tiver preço. Não reordena por
      // priority de tenant_competitor_origin (decisão em aberto — plano §17.6).
      for (const c of competitors) {
        const price = competitorPrice(product, c.competitor);
        if (price > 0) {
          alvo = price * (1 + variationPct / 100);
          priceComposition = [{ competitor: c.competitor, price, weight: 1 }];
          break;
        }
      }
    } else if (rule.competitorMode === 'lowest') {
      // Menor preço entre os concorrentes selecionados que têm preço.
      let cheapest: { competitor: string; price: number } | null = null;
      for (const c of competitors) {
        const price = competitorPrice(product, c.competitor);
        if (price > 0 && (cheapest === null || price < cheapest.price)) {
          cheapest = { competitor: c.competitor, price };
        }
      }
      if (cheapest !== null) {
        alvo = cheapest.price * (1 + variationPct / 100);
        priceComposition = [
          { competitor: cheapest.competitor, price: cheapest.price, weight: 1 },
        ];
      }
    } else {
      // Média ponderada dos concorrentes com preço (renormaliza quem faltou).
      const quotes = competitors
        .map((c) => ({
          competitor: c.competitor,
          price: competitorPrice(product, c.competitor),
          weight: toFiniteNumber(c.weight, 0),
        }))
        .filter((qt) => qt.price > 0 && qt.weight > 0);
      if (quotes.length > 0) {
        const totalWeight = quotes.reduce((acc, qt) => acc + qt.weight, 0);
        const weightedAvg =
          quotes.reduce((acc, qt) => acc + qt.price * qt.weight, 0) /
          totalWeight;
        alvo = weightedAvg * (1 + variationPct / 100);
        priceComposition = quotes.map((qt) => ({
          competitor: qt.competitor,
          price: qt.price,
          weight: qt.weight,
        }));
      }
    }

    if (alvo !== null) {
      basis = 'concorrencia';
      if (alvo < floor) {
        target = floor;
        lockApplied = true;
      } else {
        target = alvo;
      }
    }
  }

  if (target === null) {
    if (rule.strategy === 'concorrencia' && rule.noCompetitorMargin != null) {
      // Concorrência sem nenhum preço coletado, mas a regra tem margem-alvo de
      // "sem concorrência": mira essa margem (sobe ou baixa). Trava de margem
      // mínima continua sendo piso duro.
      const alvo = priceForMargin(
        custo,
        toFiniteNumber(rule.noCompetitorMargin, minMargin),
      );
      if (alvo < floor) {
        target = floor;
        lockApplied = true;
      } else {
        target = alvo;
      }
      basis = 'margem_sem_concorrente';
    } else {
      // Estratégia margem — ou concorrência sem preço e sem margem-alvo, que
      // degrada para garantia de margem mínima (só sobe quem está abaixo dela).
      const currentMargin = ((basePrice - custo) / basePrice) * 100;
      if (currentMargin >= minMargin) {
        return {
          kind: 'none',
          reason:
            rule.strategy === 'concorrencia' ? 'sem_concorrente' : 'margem_ok',
          rule,
        };
      }
      target = floor;
      basis = 'margem_minima';
    }
  }

  let price = round2(target);
  if (rule.applyRounding) {
    price = applyPriceRounding(price, roundingRanges, floor);
  }

  if (!Number.isFinite(price) || price <= 0) {
    return { kind: 'none', reason: 'sem_custo', rule };
  }

  if (Math.abs(price - basePrice) < 0.005) {
    return { kind: 'none', reason: 'ja_no_alvo', rule };
  }

  const suggestionTarget: SuggestionTarget =
    rule.priceControlled || product.precoOferta > 0
      ? 'precoOferta'
      : 'precoVenda';

  if (
    suggestionTarget === 'precoOferta' &&
    product.precoVenda > 0 &&
    price > product.precoVenda
  ) {
    return { kind: 'none', reason: 'acima_do_venda', rule };
  }

  return {
    kind: 'suggestion',
    suggestion: {
      price,
      margin: round2(((price - custo) / price) * 100),
      rule,
      target: suggestionTarget,
      basis,
      lockApplied,
      priceComposition,
    },
  };
}

export function suggestionDelta(
  product: SuggestionProduct,
  result: SuggestionResult,
): number | null {
  if (result.kind !== 'suggestion') return null;
  const base =
    product.precoOferta > 0 ? product.precoOferta : product.precoVenda;
  if (base <= 0) return null;
  const pct = ((result.suggestion.price - base) / base) * 100;
  return Math.abs(pct) < 0.05 ? null : pct;
}
