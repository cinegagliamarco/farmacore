import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { resolveTenantId } from '../../tenant/tenant-lookup';
import { PriceRoundingService } from '../config/price-rounding.service';
import { ClustersService } from './clusters.service';
import { applyCascadePriority, originPriorities } from './pricing-rules.util';
import { ListSuggestionsQueryDto } from './dto/list-suggestions.query';
import {
  computeSuggestion,
  findClusterRuleForProduct,
  findRuleForProduct,
  resolveWinner,
  suggestionDelta,
  type PriceRoundingRange,
  type SuggestionProduct,
  type SuggestionResult,
  type SuggestionTarget,
} from './pricing-suggestion.engine';
import {
  SuggestionRuleApi,
  SuggestionRulesService,
} from './suggestion-rules.service';
import { UpsertSuggestionRuleDto } from './dto/suggestion-rule.dto';

interface CompetitorView {
  origin: CompetitorOrigin;
  price: number | null;
  isPbm: boolean;
  van: string | null;
}

interface ResponseProduct {
  ean: string;
  name: string;
  supplier: string | null;
  classification: string | null;
  book: string | null;
  cost: number | null;
  priceForSell: number | null;
  priceForOffer: number | null;
  margin: number | null;
  averageVariation: number | null;
  status: string | null;
  competitors: CompetitorView[];
}

interface ClusterOrigin {
  clusterId: string;
  clusterName: string | null;
  overrodeRuleName: string | null;
}

interface ResponseRow {
  product: ResponseProduct;
  result: SuggestionResult;
  origem: ClusterOrigin | null;
}

export interface SuggestionsResponse {
  rows: ResponseRow[];
  count: number;
  suggestionCount: number;
  lockCount: number;
  activeRuleCount: number;
  availableBooks: { value: string; label: string }[];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const money = (v: unknown): number => num(v) ?? 0;

/**
 * `GET /pricing/suggestions` — produtos com sugestão calculada e filtros
 * server-side. Port de `pricing-suggestions-products.ts`: em vez do products-proxy
 * do ERP, faz o join direto no banco (modelo do `catalog.crossed()`), generalizado
 * para as origens habilitadas do tenant. Carrega tudo, calcula em memória e filtra/
 * pagina — `availableBooks` e contagens são sobre o conjunto inteiro (pré-paginação).
 */
@Injectable()
export class PricingSuggestionsService {
  constructor(
    private readonly rules: SuggestionRulesService,
    private readonly clusters: ClustersService,
    private readonly priceRounding: PriceRoundingService,
  ) {}

  /**
   * Dry-run de uma regra ainda não salva: calcula a sugestão de toda a base
   * usando SÓ essa regra transitória. Mesmo pipeline do `suggestions`.
   */
  public preview(
    em: EntityManager,
    slug: string,
    dto: UpsertSuggestionRuleDto,
    q: ListSuggestionsQueryDto,
  ): Promise<SuggestionsResponse> {
    return this.suggestions(em, slug, q, [this.rules.buildTransient(dto)]);
  }

  public async suggestions(
    em: EntityManager,
    slug: string,
    q: ListSuggestionsQueryDto,
    overrideRules?: SuggestionRuleApi[],
  ): Promise<SuggestionsResponse> {
    const page = Math.max(1, q.page ?? 1);
    const perPage = Math.min(1000, Math.max(1, q.perPage ?? 50));
    const onlyWithSuggestion = q.onlyWithSuggestion === 'true';
    const direction = q.direction ?? 'todas';
    const origemFilter = q.origem ?? 'todas';
    const books = (q.books ?? '')
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);

    const origins = await this.enabledOrigins(em, slug);
    const allRows = await this.loadProducts(
      em,
      origins,
      q.name,
      q.classification,
    );
    const availableBooks = this.availableBooks(allRows);
    const bookSet = new Set(books);
    const productRows = bookSet.size
      ? allRows.filter((p) => bookSet.has((p.book ?? '').trim()))
      : allRows;

    const ctx = await this.ruleContext(em, slug, overrideRules);
    const computed = productRows.map((p) => this.computeRow(p, ctx));

    let filtered = computed;
    if (onlyWithSuggestion) {
      filtered = filtered.filter((r) => r.result.kind === 'suggestion');
    }
    if (origemFilter === 'cluster') {
      filtered = filtered.filter((r) => r.origem !== null);
    } else if (origemFilter === 'classificacao') {
      filtered = filtered.filter(
        (r) => r.origem === null && this.resultHadRule(r.result),
      );
    }
    if (direction === 'subir' || direction === 'abaixar') {
      filtered = filtered.filter((r) => {
        const delta = suggestionDelta(r.sp, r.result);
        if (delta === null) return false;
        return direction === 'subir' ? delta > 0 : delta < 0;
      });
    }

    const suggestionCount = filtered.filter(
      (r) => r.result.kind === 'suggestion',
    ).length;
    const lockCount = filtered.filter(
      (r) => r.result.kind === 'suggestion' && r.result.suggestion.lockApplied,
    ).length;

    const start = (page - 1) * perPage;
    return {
      rows: filtered.slice(start, start + perPage).map((r) => ({
        product: r.product,
        result: r.result,
        origem: r.origem,
      })),
      count: filtered.length,
      suggestionCount,
      lockCount,
      activeRuleCount: ctx.activeRules.length,
      availableBooks,
    };
  }

  /**
   * Sugestão por EAN para TODO o catálogo, em UMA passada (load + compute uma
   * vez). Usado pelo recálculo do agendamento — evita reescanear o catálogo por
   * página como faria paginar `suggestions()`. Carrega o `target` ESCOLHIDO pelo
   * motor (venda vs oferta), não o do item agendado.
   */
  public async priceMap(
    em: EntityManager,
    slug: string,
  ): Promise<Map<string, { target: SuggestionTarget; price: number }>> {
    const origins = await this.enabledOrigins(em, slug);
    const allRows = await this.loadProducts(em, origins);
    const ctx = await this.ruleContext(em, slug);
    const map = new Map<string, { target: SuggestionTarget; price: number }>();
    for (const product of allRows) {
      const { result } = this.computeRow(product, ctx);
      if (result.kind === 'suggestion') {
        map.set(product.ean, {
          target: result.suggestion.target,
          price: result.suggestion.price,
        });
      }
    }
    return map;
  }

  /** Regras ativas (reordenadas por priority se houver cascadeByPriority) +
   *  membership de cluster + faixas de arredondamento — o contexto do cálculo. */
  private async ruleContext(
    em: EntityManager,
    slug: string,
    overrideRules?: SuggestionRuleApi[],
  ): Promise<{
    activeRules: SuggestionRuleApi[];
    clusterRules: SuggestionRuleApi[];
    classRules: SuggestionRuleApi[];
    membership: Map<string, string[]>;
    roundingRanges: PriceRoundingRange[];
  }> {
    let activeRules = (overrideRules ?? (await this.rules.list(em))).filter(
      (r) => r.active,
    );
    if (
      activeRules.some(
        (r) => r.competitorMode === 'cascade' && r.cascadeByPriority,
      )
    ) {
      activeRules = applyCascadePriority(
        activeRules,
        await originPriorities(em, slug),
      );
    }
    const usesClusters = activeRules.some(
      (r) => r.clusterId || r.excludeClusterIds.length > 0,
    );
    return {
      activeRules,
      clusterRules: activeRules.filter((r) => r.clusterId),
      classRules: activeRules.filter((r) => !r.clusterId),
      membership: usesClusters
        ? await this.clusters.loadActiveClusterMembership(em)
        : new Map<string, string[]>(),
      roundingRanges: activeRules.some((r) => r.applyRounding)
        ? await this.roundingRanges(em, slug)
        : [],
    };
  }

  private computeRow(
    product: ResponseProduct,
    ctx: {
      clusterRules: SuggestionRuleApi[];
      classRules: SuggestionRuleApi[];
      membership: Map<string, string[]>;
      roundingRanges: PriceRoundingRange[];
    },
  ): {
    product: ResponseProduct;
    sp: SuggestionProduct;
    result: SuggestionResult;
    origem: ClusterOrigin | null;
  } {
    const sp = this.toSuggestionProduct(product);
    const clusterIds = ctx.membership.get(product.ean) ?? [];
    const clusterRule = clusterIds.length
      ? findClusterRuleForProduct(ctx.clusterRules, clusterIds)
      : null;
    const classRule = findRuleForProduct(sp, ctx.classRules, clusterIds);
    const { winner, overrodeRule } = resolveWinner(clusterRule, classRule);
    const result: SuggestionResult = winner
      ? computeSuggestion(
          sp,
          winner,
          winner.applyRounding ? ctx.roundingRanges : [],
        )
      : { kind: 'none', reason: 'sem_regra' };
    const origem: ClusterOrigin | null = winner?.clusterId
      ? {
          clusterId: winner.clusterId,
          clusterName: winner.clusterName ?? null,
          overrodeRuleName: overrodeRule?.name ?? null,
        }
      : null;
    return { product, sp, result, origem };
  }

  private resultHadRule(r: SuggestionResult): boolean {
    return (
      r.kind === 'suggestion' || (r.kind === 'none' && r.reason !== 'sem_regra')
    );
  }

  /** Origens de concorrente habilitadas do tenant (core, fora do search_path). */
  private async enabledOrigins(
    em: EntityManager,
    slug: string,
  ): Promise<CompetitorOrigin[]> {
    const tenantId = await resolveTenantId(em, slug);
    const rows: Array<{ origin: CompetitorOrigin }> = await em.query(
      `SELECT origin FROM core.tenant_competitor_origin
        WHERE tenant_id = $1 AND enabled = true
        ORDER BY priority ASC, origin ASC`,
      [tenantId],
    );
    return rows
      .map((r) => r.origin)
      .filter((o): o is CompetitorOrigin =>
        Object.values(CompetitorOrigin).includes(o),
      );
  }

  /**
   * Catálogo do tenant cruzado com o preço/metadata de cada origem habilitada.
   * Modelo do `catalog.crossed()`, mas com um LEFT JOIN dinâmico por origem
   * (os valores vêm do enum CompetitorOrigin — seguro interpolar). Descarta
   * produto "só do concorrente" (custo, venda e oferta todos zerados).
   */
  private async loadProducts(
    em: EntityManager,
    origins: CompetitorOrigin[],
    name?: string,
    classification?: string,
  ): Promise<ResponseProduct[]> {
    const joins: string[] = [];
    const selects: string[] = [];
    origins.forEach((origin) => {
      const a = `o_${origin}`;
      joins.push(
        `LEFT JOIN shared_catalog.product ${a} ON ${a}.ean = p.ean AND ${a}.origin = '${origin}'`,
      );
      selects.push(
        `${a}.price AS "${origin}__price",
         (${a}.metadata->>'isPbm') = 'true' AS "${origin}__isPbm",
         ${a}.metadata->>'van' AS "${origin}__van"`,
      );
    });

    const where: string[] = [
      `(p.cost > 0 OR p.price > 0 OR ob.target_price > 0)`,
    ];
    const params: unknown[] = [];
    if (name) {
      params.push(`%${name}%`);
      where.push(`p.name ILIKE $${params.length}`);
    }
    if (classification) {
      params.push(`%${classification}%`);
      where.push(`c.name ILIKE $${params.length}`);
    }

    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT p.ean, p.name, p.supplier, c.name AS classification,
              p.cost, p.price AS "priceForSell", ob.target_price AS "priceForOffer",
              ob.description AS book, p.margin,
              p.average_variation AS "averageVariation", p.status
              ${selects.length ? ',' + selects.join(',') : ''}
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         LEFT JOIN offer_book ob ON ob.ean = p.ean
         ${joins.join('\n         ')}
        WHERE ${where.join(' AND ')}
        ORDER BY p.ean`,
      params,
    );

    return rows.map((r) => ({
      ean: String(r.ean),
      name: (r.name as string) ?? '',
      supplier: (r.supplier as string) ?? null,
      classification: (r.classification as string) ?? null,
      book: (r.book as string) ?? null,
      cost: num(r.cost),
      priceForSell: num(r.priceForSell),
      priceForOffer: num(r.priceForOffer),
      margin: num(r.margin),
      averageVariation: num(r.averageVariation),
      status: (r.status as string) ?? null,
      competitors: origins.map((origin) => ({
        origin,
        price: num(r[`${origin}__price`]),
        isPbm: r[`${origin}__isPbm`] === true,
        van: (r[`${origin}__van`] as string) ?? null,
      })),
    }));
  }

  private toSuggestionProduct(p: ResponseProduct): SuggestionProduct {
    const competitorPrices: Partial<Record<CompetitorOrigin, number>> = {};
    let pbm = false;
    for (const c of p.competitors) {
      if (c.price && c.price > 0) competitorPrices[c.origin] = c.price;
      if (c.isPbm) pbm = true;
    }
    return {
      id: 0,
      ean: p.ean,
      nome: p.name,
      fabricante: p.supplier ?? '',
      classificacao: p.classification ?? '',
      cadernoOferta: p.book ?? '',
      custo: money(p.cost),
      precoVenda: money(p.priceForSell),
      precoOferta: money(p.priceForOffer),
      competitorPrices,
      margem: money(p.margin),
      pbm,
    };
  }

  private async roundingRanges(
    em: EntityManager,
    slug: string,
  ): Promise<PriceRoundingRange[]> {
    const ranges = await this.priceRounding.list(em, slug);
    return ranges.map((r) => ({
      price_min: r.priceMin,
      price_max: r.priceMax,
      rules: r.rules.map((d) => ({
        decimal_min: d.decimalMin,
        decimal_max: d.decimalMax,
        round_to: d.roundTo,
      })),
    }));
  }

  private availableBooks(
    rows: ResponseProduct[],
  ): { value: string; label: string }[] {
    return [...new Set(rows.map((r) => (r.book ?? '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map((book) => ({ value: book, label: book }));
  }
}
