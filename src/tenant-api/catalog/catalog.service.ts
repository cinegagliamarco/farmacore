import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  buildCompetitorCrossJoins,
  mapCompetitorsFromRow,
  safeOrigins,
  stripCompetitorRowKeys,
} from '../../common/competitor-origin-sql';
import { buildMultiSortClause } from '../../common/multi-sort';
import { resolveTenantId } from '../../tenant/tenant-lookup';
import { CompetitorOriginsService } from '../pricing/competitor-origins.service';
import {
  ListProductsQueryDto,
  SortableColumn,
} from './dto/list-products.query';

export interface Paginated<T> {
  rows: T[];
  count: number;
  page: number;
  perPage: number;
}

export interface StockMetrics {
  total: number;
  ownWithStock: number;
}

/** One entry of the store selector (GET /products/stores). */
export interface StoreOption {
  /** core.tenant_store uuid — the storeId POST /products/:ean/price expects.
   *  Null (with null `active`) when the tenant doesn't know the store. */
  storeId: string | null;
  storeExternalId: string;
  label: string;
  active: boolean | null;
}

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 200;

export type Decision = 'subir' | 'abaixar' | 'ok' | 'mix' | 'sem-estoque';

const DECISIONS: Decision[] = ['subir', 'abaixar', 'ok', 'mix', 'sem-estoque'];

export interface DecisionInput {
  /** Cheapest in-stock variant in the store, or null when none has stock.
   *  cost can be null when the ERP hasn't loaded it yet. */
  combate: { price: number; cost: number | null } | null;
  /** Lowest cost in the whole group, regardless of price/stock. */
  lowestCost: number | null;
  /** Cheapest competitor across the group, or null. */
  competitorPrice: number | null;
  /** % the user wants to ignore vs the competitor (the "ok" band). */
  tolerance: number;
}

/**
 * Decision for an (active ingredient × store), derived from the data — no
 * manual field. Precedence: sem-estoque > mix > subir/abaixar/ok. `mix`
 * (combate isn't the lowest-cost variant) wins over the competitor compare
 * because fixing the mix changes the combate's price first.
 */
export function deriveDecision({
  combate,
  lowestCost,
  competitorPrice,
  tolerance,
}: DecisionInput): Decision {
  if (!combate) return 'sem-estoque';
  if (lowestCost !== null && combate.cost !== null && combate.cost > lowestCost)
    return 'mix';
  if (competitorPrice === null) return 'ok';
  const tol = tolerance / 100;
  if (combate.price < competitorPrice * (1 - tol)) return 'subir';
  if (combate.price > competitorPrice * (1 + tol)) return 'abaixar';
  return 'ok';
}

/** Parse a pg numeric (string|null) to a finite number, or null. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface VariantRow {
  ai: string;
  ean: string | number;
  name: string;
  price: string | null;
  cost: string | null;
  margin: string | null;
  stockInStore: number;
  competitorOrigin: string | null;
  competitorPrice: string | null;
  priceOffer: string | null;
  [key: string]: unknown;
}

export interface IngredientGroup {
  activeIngredient: string;
  decision: Decision;
  targetPrice: number | null;
  priceOffer: number | null;
  combate: {
    ean: string;
    name: string;
    price: number;
    cost: number | null;
  } | null;
  lowestCost: { ean: string; cost: number } | null;
  competitorCombate: { origin: string; price: number } | null;
  variants: Record<string, unknown>[];
}

/** Joins required wherever `priceOffer` is selected (offer_book + vigente campaign). */
const OFFER_BOOK_JOINS = `LEFT JOIN offer_book ob ON ob.ean = p.ean
         LEFT JOIN tenant_offer_campaign toc ON toc.external_id = ob.external_id`;

/** Identity facts (generic flag, princípio ativo) live in the internal
 *  cadastre (shared_catalog.base_product), curated via
 *  /admin/catalog/base-products — never ERP-synced. Tenant reads cross
 *  their EAN into it with this join. */
const BASE_PRODUCT_JOIN = `LEFT JOIN shared_catalog.base_product bp ON bp.ean = p.ean`;

/** precoOferta from offer_book — null when absent, zero, or linked to an expired/inactive caderno. */
const PRICE_OFFER_EXPR = `CASE
          WHEN ob.target_price IS NULL OR ob.target_price <= 0 THEN NULL
          WHEN ob.external_id IS NULL THEN ob.target_price
          WHEN toc.active = true
           AND (toc.start_date IS NULL OR toc.start_date <= now())
           AND (toc.expiration_date IS NULL OR toc.expiration_date > now())
          THEN ob.target_price
          ELSE NULL
        END`;

/** Per-store price/cost: `product_item` overrides the product's global value
 *  when the selected store has a row. Every grid query joins `pi` with
 *  `store_id = $n::uuid` bound to the resolved store — null when no `?store=`
 *  was given, so the join never matches and the global wins (one SQL shape,
 *  no branching). Margin mirrors calc-base-product-metrics: the base is the
 *  raw offer target when present, else the effective sell price. */
const EFF_PRICE = `COALESCE(pi.price, p.price)`;
const EFF_COST = `COALESCE(pi.cost, p.cost)`;
const EFF_BASE = `COALESCE(NULLIF(ob.target_price, 0), ${EFF_PRICE})`;
// ROUND(…, 4) keeps the wire format of the old stored p.margin (numeric(8,4)).
const EFF_MARGIN = `CASE WHEN ${EFF_BASE} > 0
          THEN ROUND(((${EFF_BASE} - COALESCE(${EFF_COST}, 0)) / ${EFF_BASE}) * 100, 4)
          ELSE NULL END`;

const productItemJoin = (param: number): string =>
  `LEFT JOIN product_item pi ON pi.product_id = p.id AND pi.store_id = $${param}::uuid`;

// sortBy → SQL expression. Keys must match SORTABLE_COLUMNS no DTO
// (TypeScript garante via Record<SortableColumn, string>).
const SORTABLE: Record<SortableColumn, string> = {
  ean: 'p.ean',
  name: 'p.name',
  supplier: 'p.supplier',
  classification: 'c.name',
  book: 'ob.description',
  cost: 'p.cost',
  price: 'p.price',
  margin: 'p.margin',
  averageVariation: 'p.average_variation',
  status: 'p.status',
  priceOffer: PRICE_OFFER_EXPR,
  receiptDate: 'p.receipt_date',
};

// Grid queries join pi + ob/toc, so price-ish sorts follow the per-store values.
const SORTABLE_EFFECTIVE: Record<SortableColumn, string> = {
  ...SORTABLE,
  cost: EFF_COST,
  price: EFF_PRICE,
  margin: EFF_MARGIN,
};

// stock() joins neither offer_book nor tenant_offer_campaign; dropping the
// offer-ish keys makes those sorts no-ops (buildMultiSortClause skips missing
// keys) instead of a missing-alias 500.
const SORTABLE_STOCK: Record<string, string> = { ...SORTABLE };
delete SORTABLE_STOCK.book;
delete SORTABLE_STOCK.priceOffer;

interface Filters {
  where: string;
  params: unknown[];
}

/**
 * Tenant catalog reads. Runs against the request's tenant-scoped
 * EntityManager (search_path = tenant schema + shared_catalog), so
 * unqualified `product`/`offer_book`/`classification` resolve to the
 * caller's tenant schema while `shared_catalog.product` is the shared
 * competitor data — the same cross as calc-base-product-metrics.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly competitorOrigins: CompetitorOriginsService) {}

  /** Plain tenant catalog list (no competitor cross). */
  public async list(
    em: EntityManager,
    slug: string,
    q: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>>> {
    const { page, perPage, offset } = this.paginate(q);
    const storeUuid = await this.storeUuid(em, slug, q.store);
    const f = this.buildFilters(q);
    const order = this.orderBy(q, SORTABLE_EFFECTIVE);

    const count = await this.count(em, f);
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT p.ean, p.name, p.active, p.supplier,
              ${EFF_PRICE} AS price, ${EFF_COST} AS cost, ${EFF_MARGIN} AS margin,
              p.average_variation AS "averageVariation", p.status,
              p.monitored, COALESCE(bp.generic, false) AS generic,
              p.receipt_date AS "receiptDate",
              c.name AS classification
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         ${BASE_PRODUCT_JOIN}
         ${OFFER_BOOK_JOINS}
         ${productItemJoin(f.params.length + 1)}
        ${f.where}
        ORDER BY ${order}
        LIMIT $${f.params.length + 2} OFFSET $${f.params.length + 3}`,
      [...f.params, storeUuid, perPage, offset],
    );
    return { rows: rows.map((r) => this.normalize(r)), count, page, perPage };
  }

  /** Tenant products crossed with competitor prices/observations.
   *
   *  Competitors are DYNAMIC per tenant: each row carries a `competitors` array
   *  with one entry per origin the tenant has ENABLED in
   *  core.tenant_competitor_origin (ordered by priority), and the response's
   *  `origins` lists those enabled origins so the client can render a stable
   *  column per origin. */
  public async crossed(
    em: EntityManager,
    slug: string,
    q: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>> & { origins: string[] }> {
    const origins = await this.competitorOrigins.enabledOrigins(em, slug);
    const { page, perPage, offset } = this.paginate(q);
    const storeUuid = await this.storeUuid(em, slug, q.store);
    const f = this.buildFilters(q);
    const order = this.orderBy(q, SORTABLE_EFFECTIVE);
    const { joins, selects } = buildCompetitorCrossJoins(origins);

    const count = await this.count(em, f);
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT p.ean, p.name, p.supplier, c.name AS classification,
              ob.description AS book,
              ${EFF_COST} AS cost, ${EFF_PRICE} AS price, ${PRICE_OFFER_EXPR} AS "priceOffer",
              ${EFF_MARGIN} AS margin, p.average_variation AS "averageVariation", p.status,
              p.active, p.monitored, p.receipt_date AS "receiptDate"
              ${selects ? `,\n              ${selects}` : ''}
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         ${OFFER_BOOK_JOINS}
         ${productItemJoin(f.params.length + 1)}
         ${joins}
        ${f.where}
        ORDER BY ${order}
        LIMIT $${f.params.length + 2} OFFSET $${f.params.length + 3}`,
      [...f.params, storeUuid, perPage, offset],
    );
    return {
      rows: rows.map((r) =>
        this.normalize({
          ...stripCompetitorRowKeys(r, origins),
          competitors: mapCompetitorsFromRow(r, origins, {
            price: true,
            observation: true,
            isPbm: true,
            van: true,
          }),
        }),
      ),
      count,
      page,
      perPage,
      origins,
    };
  }

  /** Crossed products that are "strategic" — have a competitor deal
   *  (metadata.observation on any enabled origin) OR a tenant deal
   *  (product.deals). Surfaces the deals + the competitor deal text. */
  public async strategicPrice(
    em: EntityManager,
    slug: string,
    q: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>>> {
    const origins = await this.competitorOrigins.enabledOrigins(em, slug);
    const { page, perPage, offset } = this.paginate(q);
    const storeUuid = await this.storeUuid(em, slug, q.store);
    const f = this.buildFilters(q);
    const order = this.orderBy(q, SORTABLE_EFFECTIVE);
    const { joins, selects } = buildCompetitorCrossJoins(origins);
    const observationChecks = safeOrigins(origins).map(
      (origin, i) => `o_${i}.metadata->>'observation' IS NOT NULL`,
    );
    const cond =
      observationChecks.length > 0
        ? `(${observationChecks.join(' OR ')} OR (p.deals IS NOT NULL AND p.deals <> '{}'::jsonb))`
        : `(p.deals IS NOT NULL AND p.deals <> '{}'::jsonb)`;
    const where = f.where ? `${f.where} AND ${cond}` : `WHERE ${cond}`;
    const fromJoins = `FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         ${OFFER_BOOK_JOINS}
         ${productItemJoin(f.params.length + 1)}
         ${joins}`;
    const countRows: Array<{ count: string }> = await em.query(
      `SELECT count(*)::int AS count ${fromJoins} ${where}`,
      [...f.params, storeUuid],
    );
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT p.ean, p.name, p.supplier, c.name AS classification,
              ${EFF_COST} AS cost, ${EFF_PRICE} AS price, ${PRICE_OFFER_EXPR} AS "priceOffer", p.deals,
              ${EFF_MARGIN} AS margin, p.average_variation AS "averageVariation", p.status
              ${selects ? `,\n              ${selects}` : ''}
         ${fromJoins} ${where}
        ORDER BY ${order}
        LIMIT $${f.params.length + 2} OFFSET $${f.params.length + 3}`,
      [...f.params, storeUuid, perPage, offset],
    );
    return {
      rows: rows.map((r) =>
        this.normalize({
          ...stripCompetitorRowKeys(r, origins),
          competitors: mapCompetitorsFromRow(r, origins, {
            price: true,
            observation: true,
          }),
        }),
      ),
      count: Number(countRows[0]?.count ?? 0),
      page,
      perPage,
    };
  }

  /** Distinct active ingredients present in the tenant catalog. */
  public async activeIngredients(em: EntityManager): Promise<string[]> {
    const rows: Array<{ active_ingredient: string }> = await em.query(
      `SELECT DISTINCT bp.active_ingredient
         FROM product p
         ${BASE_PRODUCT_JOIN}
        WHERE bp.active_ingredient IS NOT NULL
        ORDER BY bp.active_ingredient`,
    );
    return rows.map((r) => r.active_ingredient);
  }

  /** Distinct stores that have stock, labelled from core.tenant_store
   *  (falling back to the id) — the UI's store selector. Deleted stores
   *  don't match the join and come back with null storeId/active. */
  public async stores(em: EntityManager, slug: string): Promise<StoreOption[]> {
    const tenantId = await resolveTenantId(em, slug);
    return em.query(
      `SELECT DISTINCT ts.id AS "storeId",
              ps.store_external_id::text AS "storeExternalId",
              COALESCE(ts.name, ps.store_external_id::text) AS label,
              ts.active
         FROM product_stock ps
         LEFT JOIN core.tenant_store ts
           ON ts.external_id = ps.store_external_id AND ts.tenant_id = $1
          AND ts.deleted_at IS NULL
        ORDER BY label, "storeExternalId"`,
      [tenantId],
    );
  }

  /** Products grouped by active ingredient for a store, each with its combate
   *  (cheapest in-stock variant), lowest-cost variant, cheapest competitor,
   *  and the derived decision (see deriveDecision). Optional `decision`
   *  filters the groups server-side; targetPrice/variants kept. */
  public async activeIngredientsCrossed(
    em: EntityManager,
    slug: string,
    q: ListProductsQueryDto,
  ): Promise<Paginated<IngredientGroup>> {
    const { page, perPage, offset } = this.paginate(q);
    const groups = await this.loadIngredientGroups(em, slug, q);
    const filtered = q.decision
      ? groups.filter((g) => g.decision === q.decision)
      : groups;
    return {
      rows: filtered.slice(offset, offset + perPage),
      count: filtered.length,
      page,
      perPage,
    };
  }

  /** Decision tally over the (active ingredient × store) groups — the filter
   *  chips. Honors `activeIngredient` when present. */
  public async decisionCounts(
    em: EntityManager,
    slug: string,
    q: ListProductsQueryDto,
  ): Promise<Record<Decision | 'total', number>> {
    const groups = await this.loadIngredientGroups(em, slug, q);
    const counts = Object.fromEntries(DECISIONS.map((d) => [d, 0])) as Record<
      Decision | 'total',
      number
    >;
    counts.total = groups.length;
    for (const g of groups) counts[g.decision]++;
    return counts;
  }

  /** Loads every active-ingredient group for the store (honoring
   *  activeIngredient), computing the decision per group. Shared by the
   *  crossed list (filter + paginate) and the decision counts. */
  private async loadIngredientGroups(
    em: EntityManager,
    slug: string,
    q: ListProductsQueryDto,
  ): Promise<IngredientGroup[]> {
    const origins = await this.competitorOrigins.enabledOrigins(em, slug);
    const store = this.requireStore(q);
    const storeUuid = await this.storeUuid(em, slug, store);
    const tolerance = q.tolerance ?? 0;
    const params: unknown[] = [store, storeUuid];
    const aiFilter = q.activeIngredient
      ? `AND bp.active_ingredient ILIKE $${params.push(`%${q.activeIngredient}%`)}`
      : '';
    const { joins, selects } = buildCompetitorCrossJoins(origins);
    const rows: VariantRow[] = await em.query(
      `SELECT bp.active_ingredient AS ai, p.ean, p.name,
              ${EFF_PRICE} AS price, ${EFF_COST} AS cost, ${EFF_MARGIN} AS margin,
              COALESCE(ps.quantity, 0) AS "stockInStore",
              cc.origin AS "competitorOrigin", cc.price AS "competitorPrice",
              ${PRICE_OFFER_EXPR} AS "priceOffer"
              ${selects ? `,\n              ${selects}` : ''}
         FROM product p
         ${BASE_PRODUCT_JOIN}
         ${joins}
         ${OFFER_BOOK_JOINS}
         ${productItemJoin(2)}
         LEFT JOIN product_stock ps
           ON ps.ean = p.ean AND ps.store_external_id = $1::bigint
         LEFT JOIN LATERAL (
           SELECT sp.origin, sp.price
             FROM shared_catalog.product sp
            WHERE sp.ean = p.ean AND sp.deleted_at IS NULL AND sp.price > 0
            ORDER BY sp.price ASC NULLS LAST LIMIT 1
         ) cc ON true
        WHERE bp.active_ingredient IS NOT NULL ${aiFilter}
        ORDER BY bp.active_ingredient, p.ean`,
      params,
    );
    const byIng = new Map<string, VariantRow[]>();
    for (const r of rows) {
      const list = byIng.get(r.ai) ?? [];
      list.push(r);
      byIng.set(r.ai, list);
    }
    return [...byIng].map(([ai, vs]) =>
      this.buildGroup(ai, vs, tolerance, origins),
    );
  }

  private buildGroup(
    ai: string,
    vs: VariantRow[],
    tolerance: number,
    origins: string[],
  ): IngredientGroup {
    let combate: VariantRow | null = null;
    let lowestCost: VariantRow | null = null;
    let competitor: { origin: string; price: number } | null = null;
    for (const v of vs) {
      // price 0 means "not loaded" here, same as targetPrice's `> 0` filter —
      // a zero-price variant must not become the combate or a competitor.
      const price = num(v.price);
      const cost = num(v.cost);
      if (price !== null && price > 0 && Number(v.stockInStore) > 0)
        if (!combate || price < (num(combate.price) ?? Infinity)) combate = v;
      if (cost !== null)
        if (!lowestCost || cost < (num(lowestCost.cost) ?? Infinity))
          lowestCost = v;
      const compPrice = num(v.competitorPrice);
      if (compPrice !== null && compPrice > 0 && v.competitorOrigin)
        if (!competitor || compPrice < competitor.price)
          competitor = { origin: v.competitorOrigin, price: compPrice };
    }
    const lowestCostValue = lowestCost ? num(lowestCost.cost) : null;
    const decision = deriveDecision({
      combate: combate
        ? { price: num(combate.price)!, cost: num(combate.cost) }
        : null,
      lowestCost: lowestCostValue,
      competitorPrice: competitor?.price ?? null,
      tolerance,
    });
    const prices = vs
      .map((v) => num(v.price))
      .filter((n): n is number => n !== null && n > 0);
    const combateOffer = combate ? num(combate.priceOffer) : null;
    return {
      activeIngredient: ai,
      decision,
      targetPrice: prices.length ? Math.min(...prices) : null,
      priceOffer:
        combateOffer !== null && combateOffer > 0 ? combateOffer : null,
      combate: combate
        ? {
            ean: String(combate.ean),
            name: combate.name,
            price: num(combate.price)!,
            cost: num(combate.cost),
          }
        : null,
      lowestCost: lowestCost
        ? { ean: String(lowestCost.ean), cost: lowestCostValue! }
        : null,
      competitorCombate: competitor,
      variants: vs.map((v) => ({
        ean: String(v.ean),
        name: v.name,
        price: num(v.price),
        cost: num(v.cost),
        margin: num(v.margin),
        priceOffer: num(v.priceOffer),
        stockInStore: Number(v.stockInStore) || 0,
        isCombate: combate?.ean === v.ean,
        competitors: mapCompetitorsFromRow(v, origins, { price: true }),
      })),
    };
  }

  private requireStore(q: ListProductsQueryDto): string {
    // up to 18 digits stays within Postgres bigint, so the `::bigint` cast
    // can't overflow into a 500.
    if (!q.store || !/^\d{1,18}$/.test(q.store))
      throw new BadRequestException('store is required (numeric store id)');
    return q.store;
  }

  /** Resolves a store external id to its core.tenant_store uuid — the pi
   *  join key. Null when no store was asked or it is unknown, deleted or
   *  inactive (the sync only maintains active stores, so an inactive store's
   *  product_item rows are frozen — falling back to the live globals is the
   *  honest read). */
  private async storeUuid(
    em: EntityManager,
    slug: string,
    store?: string,
  ): Promise<string | null> {
    if (!store) return null;
    if (!/^\d{1,18}$/.test(store))
      throw new BadRequestException('store must be a numeric store id');
    const tenantId = await resolveTenantId(em, slug);
    const rows: Array<{ id: string }> = await em.query(
      `SELECT id FROM core.tenant_store
        WHERE tenant_id = $1 AND external_id = $2::bigint
          AND active = true AND deleted_at IS NULL`,
      [tenantId, store],
    );
    return rows[0]?.id ?? null;
  }

  /** Crossed catalog as CSV (capped). */
  public async exportCsv(
    em: EntityManager,
    slug: string,
    q: ListProductsQueryDto,
  ): Promise<string> {
    const origins = await this.competitorOrigins.enabledOrigins(em, slug);
    const storeUuid = await this.storeUuid(em, slug, q.store);
    const f = this.buildFilters(q);
    const { joins, selects } = buildCompetitorCrossJoins(origins);
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT p.ean, p.name, p.supplier, c.name AS classification,
              ${EFF_COST} AS cost, ${EFF_PRICE} AS price, ${EFF_MARGIN} AS margin, p.status
              ${selects ? `,\n              ${selects}` : ''}
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         ${OFFER_BOOK_JOINS}
         ${productItemJoin(f.params.length + 1)}
         ${joins}
        ${f.where}
        ORDER BY p.ean LIMIT 50000`,
      [...f.params, storeUuid],
    );
    const cols = [
      'ean',
      'name',
      'supplier',
      'classification',
      'cost',
      'price',
      'margin',
      'status',
      ...safeOrigins(origins).map((o) => o.toLowerCase()),
    ];
    const esc = (v: unknown): string => {
      if (v == null) return '';
      const s =
        typeof v === 'string'
          ? v
          : typeof v === 'number' || typeof v === 'boolean'
            ? String(v)
            : JSON.stringify(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(',')];
    for (const r of rows) {
      const mapped = mapCompetitorsFromRow(r, origins, { price: true });
      const row: Record<string, unknown> = { ...r };
      for (const c of mapped) row[c.origin.toLowerCase()] = c.price;
      lines.push(cols.map((k) => esc(row[k])).join(','));
    }
    return lines.join('\n');
  }

  /** Per-product stock: the tenant's own ERP stock, by store. */
  public async stock(
    em: EntityManager,
    q: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>>> {
    const { page, perPage, offset } = this.paginate(q);
    const f = this.buildFilters(q);
    const order = this.orderBy(q, SORTABLE_STOCK);
    const count = await this.count(em, f);
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT p.ean, p.name, c.name AS classification,
              COALESCE(own.total, 0) AS "ownStock",
              own.by_sub AS "ownByStore"
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         LEFT JOIN LATERAL (
           SELECT SUM(quantity)::int AS total,
                  jsonb_object_agg(store_external_id, quantity) AS by_sub
             FROM product_stock ps WHERE ps.ean = p.ean
         ) own ON true
        ${f.where}
        ORDER BY ${order}
        LIMIT $${f.params.length + 1} OFFSET $${f.params.length + 2}`,
      [...f.params, perPage, offset],
    );
    return {
      rows: rows.map((r) => {
        const own = Number(r.ownStock) || 0;
        return {
          ...this.normalize(r),
          stockStatus: own > 0 ? 'OK' : 'OUT_OF_STOCK',
        };
      }),
      count,
      page,
      perPage,
    };
  }

  /** Aggregate own-stock coverage over the filtered set. */
  public async stockMetrics(
    em: EntityManager,
    q: ListProductsQueryDto,
  ): Promise<StockMetrics> {
    const f = this.buildFilters(q);
    const rows: Array<Record<string, string>> = await em.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE COALESCE(own.total,0) > 0)::int AS "ownWithStock"
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         LEFT JOIN LATERAL (
           SELECT SUM(quantity)::int AS total FROM product_stock ps WHERE ps.ean = p.ean
         ) own ON true
        ${f.where}`,
      f.params,
    );
    const r = rows[0] ?? {};
    return {
      total: Number(r.total ?? 0),
      ownWithStock: Number(r.ownWithStock ?? 0),
    };
  }

  private async count(em: EntityManager, f: Filters): Promise<number> {
    const rows: Array<{ count: string }> = await em.query(
      `SELECT count(*)::int AS count
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
        ${f.where}`,
      f.params,
    );
    return Number(rows[0]?.count ?? 0);
  }

  private buildFilters(q: ListProductsQueryDto): Filters {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      clauses.push(sql.replace('$?', `$${params.length}`));
    };

    const eans = this.csv(q.eans);
    if (eans.length) add('p.ean = ANY($?::bigint[])', eans);
    if (q.name) add('p.name ILIKE $?', `%${q.name}%`);
    if (q.supplier) add('p.supplier ILIKE $?', `%${q.supplier}%`);
    if (q.classification) add('c.name ILIKE $?', `%${q.classification}%`);
    const status = this.csv(q.status);
    if (status.length) add('p.status = ANY($?)', status);
    if (q.monitored === 'true') add('p.monitored = $?', true);
    if (q.monitored === 'false') add('p.monitored = $?', false);
    if (q.active === 'true') add('p.active = $?', true);
    if (q.active === 'false') add('p.active = $?', false);
    if (q.receiptFrom) add('p.receipt_date >= $?', q.receiptFrom);
    if (q.receiptTo) add('p.receipt_date <= $?', q.receiptTo);

    return {
      where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  private orderBy(
    q: ListProductsQueryDto,
    map: Record<string, string>,
  ): string {
    return buildMultiSortClause(q.sortBy, q.sortDirection, map, 'p.ean ASC');
  }

  private paginate(q: ListProductsQueryDto): {
    page: number;
    perPage: number;
    offset: number;
  } {
    const page = q.page ?? 1;
    const perPage = Math.min(q.perPage ?? DEFAULT_PER_PAGE, MAX_PER_PAGE);
    return { page, perPage, offset: (page - 1) * perPage };
  }

  private csv(v: string | undefined): string[] {
    return v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  }

  private normalize(r: Record<string, unknown>): Record<string, unknown> {
    const ean = r.ean;
    return {
      ...r,
      ean:
        typeof ean === 'string' || typeof ean === 'number' ? String(ean) : ean,
    };
  }
}
