import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { resolveTenantId } from '../../tenant/tenant-lookup';
import {
  buildClassificationIndex,
  type ClassificationIndex,
} from '../classification/classification-index';
import { ClassificationsService } from '../config/classifications.service';
import { PriceRoundingService } from '../config/price-rounding.service';
import { ClustersService } from './clusters.service';
import {
  applyCascadePriority,
  originPriorities,
  ruleParticipates,
} from './pricing-rules.util';
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
  classificationId: string | null;
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

export type SuggestedPriceMap = Map<
  string,
  { target: SuggestionTarget; price: number }
>;

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
 *
 * Multiloja: com `?store=` (id externo, loja ATIVA — senão 400), preço/custo/
 * oferta/caderno vêm do `product_item` da loja (fallback aos globais quando a
 * loja ainda não tem linha) e só participam regras com a loja em `storeIds`
 * (vazio = todas). Sem `?store=`, visão base: globais + regras sem escopo de
 * loja — uma regra escopada nunca precifica a visão base.
 */
@Injectable()
export class PricingSuggestionsService {
  constructor(
    private readonly rules: SuggestionRulesService,
    private readonly clusters: ClustersService,
    private readonly priceRounding: PriceRoundingService,
    private readonly classifications: ClassificationsService,
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

    const storeUuid = await this.storeUuid(em, slug, q.store);
    const origins = await this.enabledOrigins(em, slug);
    const allRows = await this.loadProducts(
      em,
      origins,
      q.name,
      q.classification,
      storeUuid,
    );
    const availableBooks = this.availableBooks(allRows);
    const bookSet = new Set(books);
    const productRows = bookSet.size
      ? allRows.filter((p) => bookSet.has((p.book ?? '').trim()))
      : allRows;

    const ctx = await this.ruleContext(em, slug, overrideRules, storeUuid);
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
   * Sugestão por EAN em UMA passada (load + compute uma vez). Usado pelo
   * recálculo do agendamento — evita reescanear o catálogo por página como
   * faria paginar `suggestions()`. Carrega o `target` ESCOLHIDO pelo motor
   * (venda vs oferta), não o do item agendado. Com `storeUuid`, computa sobre
   * os preços da loja e só com as regras participantes dela. `eans` limita a
   * varredura aos produtos pedidos (o cron paga um passe POR LOJA — sem o
   * filtro seria catálogo inteiro × lojas a cada disparo).
   */
  public async priceMap(
    em: EntityManager,
    slug: string,
    storeUuid: string | null,
    eans?: string[],
  ): Promise<SuggestedPriceMap> {
    const origins = await this.enabledOrigins(em, slug);
    const allRows = await this.loadProducts(
      em,
      origins,
      undefined,
      undefined,
      storeUuid,
      eans,
    );
    const ctx = await this.ruleContext(em, slug, undefined, storeUuid);
    const map: SuggestedPriceMap = new Map();
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
   *  membership de cluster + faixas de arredondamento — o contexto do cálculo.
   *  Com loja: participa a regra sem escopo ou que lista a loja; sem loja:
   *  só regras sem escopo (a visão base não aplica regra de loja). */
  private async ruleContext(
    em: EntityManager,
    slug: string,
    overrideRules?: SuggestionRuleApi[],
    storeUuid?: string | null,
  ): Promise<{
    activeRules: SuggestionRuleApi[];
    clusterRules: SuggestionRuleApi[];
    classRules: SuggestionRuleApi[];
    membership: Map<string, string[]>;
    roundingRanges: PriceRoundingRange[];
    classificationIndex: ClassificationIndex;
  }> {
    let activeRules = (overrideRules ?? (await this.rules.list(em))).filter(
      (r) => r.active && ruleParticipates(r, storeUuid ?? null),
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
      classificationIndex: await this.classificationIndex(em),
    };
  }

  private async classificationIndex(
    em: EntityManager,
  ): Promise<ClassificationIndex> {
    const rows = await this.classifications.list(em);
    return buildClassificationIndex(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parentId,
      })),
    );
  }

  private computeRow(
    product: ResponseProduct,
    ctx: {
      clusterRules: SuggestionRuleApi[];
      classRules: SuggestionRuleApi[];
      membership: Map<string, string[]>;
      roundingRanges: PriceRoundingRange[];
      classificationIndex: ClassificationIndex;
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
    const classRule = findRuleForProduct(
      sp,
      ctx.classRules,
      clusterIds,
      ctx.classificationIndex,
    );
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

  /** Resolve o id externo (`?store=`) para o uuid da loja ATIVA. Sugestão com
   *  loja desconhecida/inativa é 400 — diferente das grades do catalog (que
   *  caem no global): aqui o resultado alimenta o apply por loja, e computar
   *  globais achando que são da loja é risco de dinheiro. */
  private async storeUuid(
    em: EntityManager,
    slug: string,
    store?: string,
  ): Promise<string | null> {
    if (!store) return null;
    if (!/^\d{1,18}$/.test(store)) {
      throw new BadRequestException('store must be a numeric store id');
    }
    const tenantId = await resolveTenantId(em, slug);
    const rows: Array<{ id: string }> = await em.query(
      `SELECT id FROM core.tenant_store
        WHERE tenant_id = $1 AND external_id = $2::bigint
          AND active = true AND deleted_at IS NULL`,
      [tenantId, store],
    );
    if (!rows.length) {
      throw new BadRequestException(`store ${store} unknown or inactive`);
    }
    return rows[0].id;
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
   *
   * Com `storeUuid`, preço/custo vêm do product_item da loja (fallback global
   * quando a loja não tem linha); a oferta e o caderno são OS DA LOJA — linha
   * presente com oferta NULL significa "sem oferta nesta loja", sem cair no
   * global. A margem é recalculada sobre os efetivos (mesma fórmula do catalog).
   */
  private async loadProducts(
    em: EntityManager,
    origins: CompetitorOrigin[],
    name?: string,
    classification?: string,
    storeUuid?: string | null,
    eans?: string[],
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

    const params: unknown[] = [];
    let piJoin = '';
    let cost = 'p.cost';
    let price = 'p.price';
    let offer = 'ob.target_price';
    let book = 'ob.description';
    let margin = 'p.margin';
    if (storeUuid) {
      params.push(storeUuid);
      piJoin = `LEFT JOIN product_item pi ON pi.product_id = p.id AND pi.store_id = $${params.length}::uuid`;
      cost = 'COALESCE(pi.cost, p.cost)';
      price = 'COALESCE(pi.price, p.price)';
      offer =
        'CASE WHEN pi.id IS NULL THEN ob.target_price ELSE pi.price_offer END';
      book =
        'CASE WHEN pi.id IS NULL THEN ob.description ELSE pi.offer_description END';
      const base = `COALESCE(NULLIF(${offer}, 0), ${price})`;
      margin = `CASE WHEN ${base} > 0
           THEN ROUND(((${base} - COALESCE(${cost}, 0)) / ${base}) * 100, 4)
           ELSE NULL END`;
    }

    const where: string[] = [`(${cost} > 0 OR ${price} > 0 OR ${offer} > 0)`];
    if (eans?.length) {
      params.push(eans);
      where.push(`p.ean = ANY($${params.length}::bigint[])`);
    }
    if (name) {
      params.push(`%${name}%`);
      where.push(`p.name ILIKE $${params.length}`);
    }
    if (classification) {
      params.push(`%${classification}%`);
      where.push(`c.name ILIKE $${params.length}`);
    }

    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT p.ean, p.name, p.supplier, p.classification_id AS "classificationId",
              c.name AS classification,
              ${cost} AS cost, ${price} AS "priceForSell",
              ${offer} AS "priceForOffer",
              ${book} AS book, ${margin} AS margin,
              p.average_variation AS "averageVariation", p.status
              ${selects.length ? ',' + selects.join(',') : ''}
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         LEFT JOIN offer_book ob ON ob.ean = p.ean
         ${piJoin}
         ${joins.join('\n         ')}
        WHERE ${where.join(' AND ')}
        ORDER BY p.ean`,
      params,
    );

    return rows.map((r) => ({
      ean: String(r.ean),
      name: (r.name as string) ?? '',
      supplier: (r.supplier as string) ?? null,
      classificationId: (r.classificationId as string | null) ?? null,
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
      classificationId: p.classificationId,
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
