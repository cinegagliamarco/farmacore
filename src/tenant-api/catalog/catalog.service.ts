import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { resolveTenantId } from '../../tenant/tenant-lookup';
import { ListProductsQueryDto } from './dto/list-products.query';

export interface Paginated<T> {
  rows: T[];
  count: number;
  page: number;
  perPage: number;
}

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 200;

export type Decision = 'subir' | 'abaixar' | 'ok' | 'mix' | 'sem-estoque';

const DECISIONS: Decision[] = ['subir', 'abaixar', 'ok', 'mix', 'sem-estoque'];

export interface DecisionInput {
  /** Cheapest in-stock variant in the store, or null when none has stock. */
  combate: { price: number; cost: number } | null;
  /** Lowest cost in the whole group, regardless of price/stock. */
  lowestCost: number | null;
  /** Cheapest stocked competitor across the group, or null. */
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
  if (lowestCost !== null && combate.cost > lowestCost) return 'mix';
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
  drogalPrice: string | null;
  drogasilPrice: string | null;
  stockInSubsidiary: number;
  competitorOrigin: string | null;
  competitorPrice: string | null;
}

export interface IngredientGroup {
  activeIngredient: string;
  decision: Decision;
  targetPrice: number | null;
  combate: { ean: string; name: string; price: number; cost: number } | null;
  lowestCost: { ean: string; cost: number } | null;
  competitorCombate: { origin: string; price: number } | null;
  variants: Record<string, unknown>[];
}

// sortBy → SQL expression (whitelist; anything else falls back to ean).
const SORTABLE: Record<string, string> = {
  ean: 'p.ean',
  name: 'p.name',
  supplier: 'p.supplier',
  classification: 'c.name',
  cost: 'p.cost',
  price: 'p.price',
  margin: 'p.margin',
  averageVariation: 'p.average_variation',
  status: 'p.status',
  targetPrice: 'ob.target_price',
  receiptDate: 'p.receipt_date',
};

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
  /** Plain tenant catalog list (no competitor cross). */
  public async list(
    em: EntityManager,
    q: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>>> {
    const { page, perPage, offset } = this.paginate(q);
    const f = this.buildFilters(q);
    const order = this.orderBy(q);

    const count = await this.count(em, f);
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT p.ean, p.name, p.active, p.supplier, p.price, p.cost,
              p.margin, p.average_variation AS "averageVariation", p.status,
              p.monitored, p.generic, p.receipt_date AS "receiptDate",
              c.name AS classification
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
        ${f.where}
        ORDER BY ${order}
        LIMIT $${f.params.length + 1} OFFSET $${f.params.length + 2}`,
      [...f.params, perPage, offset],
    );
    return { rows: rows.map((r) => this.normalize(r)), count, page, perPage };
  }

  /** Tenant products crossed with competitor prices/observations. */
  public async crossed(
    em: EntityManager,
    q: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>>> {
    const { page, perPage, offset } = this.paginate(q);
    const f = this.buildFilters(q);
    const order = this.orderBy(q);

    const count = await this.count(em, f);
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT p.ean, p.name, p.supplier, c.name AS classification,
              p.cost, p.price, ob.target_price AS "targetPrice",
              p.margin, p.average_variation AS "averageVariation", p.status,
              p.monitored, p.receipt_date AS "receiptDate",
              dg.price AS "drogalPrice", dg.metadata->>'observation' AS "drogalObservation",
              (dg.metadata->>'isPbm') = 'true' AS "drogalIsPbm", dg.metadata->>'van' AS "drogalVan",
              ds.price AS "drogasilPrice", ds.metadata->>'observation' AS "drogasilObservation",
              (ds.metadata->>'isPbm') = 'true' AS "drogasilIsPbm",
              mi.price AS "michelassiPrice"
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         LEFT JOIN offer_book ob ON ob.ean = p.ean
         LEFT JOIN shared_catalog.product dg ON dg.ean = p.ean AND dg.origin = 'DROGAL'
         LEFT JOIN shared_catalog.product ds ON ds.ean = p.ean AND ds.origin = 'DROGASIL'
         LEFT JOIN shared_catalog.product mi ON mi.ean = p.ean AND mi.origin = 'MICHELASSI'
        ${f.where}
        ORDER BY ${order}
        LIMIT $${f.params.length + 1} OFFSET $${f.params.length + 2}`,
      [...f.params, perPage, offset],
    );
    return { rows: rows.map((r) => this.normalize(r)), count, page, perPage };
  }

  /** Crossed products that are "strategic" — have a competitor deal
   *  (metadata.observation on DROGAL/DROGASIL) OR a tenant deal
   *  (product.deals). Surfaces the deals + the competitor deal text. */
  public async strategicPrice(
    em: EntityManager,
    q: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>>> {
    const { page, perPage, offset } = this.paginate(q);
    const f = this.buildFilters(q);
    const order = this.orderBy(q);
    const cond =
      `(dg.metadata->>'observation' IS NOT NULL` +
      ` OR ds.metadata->>'observation' IS NOT NULL` +
      ` OR (p.deals IS NOT NULL AND p.deals <> '{}'::jsonb))`;
    const where = f.where ? `${f.where} AND ${cond}` : `WHERE ${cond}`;
    const fromJoins = `FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         LEFT JOIN offer_book ob ON ob.ean = p.ean
         LEFT JOIN shared_catalog.product dg ON dg.ean = p.ean AND dg.origin = 'DROGAL'
         LEFT JOIN shared_catalog.product ds ON ds.ean = p.ean AND ds.origin = 'DROGASIL'`;
    const countRows: Array<{ count: string }> = await em.query(
      `SELECT count(*)::int AS count ${fromJoins} ${where}`,
      f.params,
    );
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT p.ean, p.name, p.supplier, c.name AS classification,
              p.cost, p.price, ob.target_price AS "targetPrice", p.deals,
              p.margin, p.average_variation AS "averageVariation", p.status,
              dg.price AS "drogalPrice", dg.metadata->>'observation' AS "drogalDeal",
              ds.price AS "drogasilPrice", ds.metadata->>'observation' AS "drogasilDeal"
         ${fromJoins} ${where}
        ORDER BY ${order}
        LIMIT $${f.params.length + 1} OFFSET $${f.params.length + 2}`,
      [...f.params, perPage, offset],
    );
    return {
      rows: rows.map((r) => this.normalize(r)),
      count: Number(countRows[0]?.count ?? 0),
      page,
      perPage,
    };
  }

  /** Distinct active ingredients present in the tenant catalog. */
  public async activeIngredients(em: EntityManager): Promise<string[]> {
    const rows: Array<{ active_ingredient: string }> = await em.query(
      `SELECT DISTINCT active_ingredient FROM product
        WHERE active_ingredient IS NOT NULL
        ORDER BY active_ingredient`,
    );
    return rows.map((r) => r.active_ingredient);
  }

  /** Distinct stores that have stock, labelled from core.tenant_subsidiary
   *  (falling back to the id) — the UI's store selector. */
  public async subsidiaries(
    em: EntityManager,
    slug: string,
  ): Promise<Array<{ subsidiaryExternalId: string; label: string }>> {
    const tenantId = await resolveTenantId(em, slug);
    return em.query(
      `SELECT DISTINCT ps.subsidiary_external_id::text AS "subsidiaryExternalId",
              COALESCE(ts.name, ps.subsidiary_external_id::text) AS label
         FROM product_stock ps
         LEFT JOIN core.tenant_subsidiary ts
           ON ts.external_id = ps.subsidiary_external_id AND ts.tenant_id = $1
        ORDER BY 1`,
      [tenantId],
    );
  }

  /** Products grouped by active ingredient for a store, each with its combate
   *  (cheapest in-stock variant), lowest-cost variant, cheapest stocked
   *  competitor, and the derived decision (see deriveDecision). Optional
   *  `decision` filters the groups server-side; targetPrice/variants kept. */
  public async activeIngredientsCrossed(
    em: EntityManager,
    q: ListProductsQueryDto,
  ): Promise<Paginated<IngredientGroup>> {
    const { page, perPage, offset } = this.paginate(q);
    const groups = await this.loadIngredientGroups(em, q);
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
    q: ListProductsQueryDto,
  ): Promise<Record<Decision | 'total', number>> {
    const groups = await this.loadIngredientGroups(em, q);
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
    q: ListProductsQueryDto,
  ): Promise<IngredientGroup[]> {
    const subsidiary = this.requireSubsidiary(q);
    const tolerance = q.tolerance ?? 0;
    const params: unknown[] = [subsidiary];
    const aiFilter = q.activeIngredient
      ? `AND p.active_ingredient ILIKE $${params.push(`%${q.activeIngredient}%`)}`
      : '';
    const rows: VariantRow[] = await em.query(
      `SELECT p.active_ingredient AS ai, p.ean, p.name, p.price, p.cost, p.margin,
              dg.price AS "drogalPrice", ds.price AS "drogasilPrice",
              COALESCE(ps.quantity, 0) AS "stockInSubsidiary",
              cc.origin AS "competitorOrigin", cc.price AS "competitorPrice"
         FROM product p
         LEFT JOIN shared_catalog.product dg ON dg.ean = p.ean AND dg.origin = 'DROGAL'
         LEFT JOIN shared_catalog.product ds ON ds.ean = p.ean AND ds.origin = 'DROGASIL'
         LEFT JOIN product_stock ps
           ON ps.ean = p.ean AND ps.subsidiary_external_id = $1::bigint
         LEFT JOIN LATERAL (
           SELECT sp.origin, sp.price
             FROM shared_catalog.product sp
             JOIN LATERAL (
               SELECT st.quantity FROM shared_catalog.product_stock st
                WHERE st.product_id = sp.id
                ORDER BY st.captured_at DESC LIMIT 1
             ) s ON true
            WHERE sp.ean = p.ean AND sp.deleted_at IS NULL AND s.quantity > 0
            ORDER BY sp.price ASC NULLS LAST LIMIT 1
         ) cc ON true
        WHERE p.active_ingredient IS NOT NULL ${aiFilter}
        ORDER BY p.active_ingredient, p.ean`,
      params,
    );
    const byIng = new Map<string, VariantRow[]>();
    for (const r of rows) {
      const list = byIng.get(r.ai) ?? [];
      list.push(r);
      byIng.set(r.ai, list);
    }
    return [...byIng].map(([ai, vs]) => this.buildGroup(ai, vs, tolerance));
  }

  private buildGroup(
    ai: string,
    vs: VariantRow[],
    tolerance: number,
  ): IngredientGroup {
    let combate: VariantRow | null = null;
    let lowestCost: VariantRow | null = null;
    let competitor: { origin: string; price: number } | null = null;
    for (const v of vs) {
      const price = num(v.price);
      const cost = num(v.cost);
      if (price !== null && Number(v.stockInSubsidiary) > 0)
        if (!combate || price < (num(combate.price) ?? Infinity)) combate = v;
      if (cost !== null)
        if (!lowestCost || cost < (num(lowestCost.cost) ?? Infinity))
          lowestCost = v;
      const compPrice = num(v.competitorPrice);
      if (compPrice !== null && v.competitorOrigin)
        if (!competitor || compPrice < competitor.price)
          competitor = { origin: v.competitorOrigin, price: compPrice };
    }
    const lowestCostValue = lowestCost ? num(lowestCost.cost) : null;
    const decision = deriveDecision({
      combate: combate
        ? { price: num(combate.price)!, cost: num(combate.cost)! }
        : null,
      lowestCost: lowestCostValue,
      competitorPrice: competitor?.price ?? null,
      tolerance,
    });
    const prices = vs
      .map((v) => num(v.price))
      .filter((n): n is number => n !== null && n > 0);
    return {
      activeIngredient: ai,
      decision,
      targetPrice: prices.length ? Math.min(...prices) : null,
      combate: combate
        ? {
            ean: String(combate.ean),
            name: combate.name,
            price: num(combate.price)!,
            cost: num(combate.cost)!,
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
        drogalPrice: num(v.drogalPrice),
        drogasilPrice: num(v.drogasilPrice),
        stockInSubsidiary: Number(v.stockInSubsidiary) || 0,
        isCombate: combate?.ean === v.ean,
      })),
    };
  }

  private requireSubsidiary(q: ListProductsQueryDto): string {
    if (!q.subsidiary || !/^\d+$/.test(q.subsidiary))
      throw new BadRequestException(
        'subsidiary is required (numeric store id)',
      );
    return q.subsidiary;
  }

  /** Generic products still missing an active ingredient (need manual fill). */
  public async genericMissing(
    em: EntityManager,
    q: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>>> {
    const { page, perPage, offset } = this.paginate(q);
    const f = this.buildFilters(q);
    const base = f.where
      ? `${f.where} AND p.generic IS TRUE AND p.active_ingredient IS NULL`
      : `WHERE p.generic IS TRUE AND p.active_ingredient IS NULL`;
    const countRows: Array<{ count: string }> = await em.query(
      `SELECT count(*)::int AS count FROM product p ${base}`,
      f.params,
    );
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT p.ean, p.name, p.supplier
         FROM product p ${base}
        ORDER BY p.ean
        LIMIT $${f.params.length + 1} OFFSET $${f.params.length + 2}`,
      [...f.params, perPage, offset],
    );
    return {
      rows: rows.map((r) => this.normalize(r)),
      count: Number(countRows[0]?.count ?? 0),
      page,
      perPage,
    };
  }

  /** Crossed catalog as CSV (capped). */
  public async exportCsv(
    em: EntityManager,
    q: ListProductsQueryDto,
  ): Promise<string> {
    const f = this.buildFilters(q);
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT p.ean, p.name, p.supplier, c.name AS classification,
              p.cost, p.price, p.margin, p.status,
              dg.price AS drogal, ds.price AS drogasil, mi.price AS michelassi
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         LEFT JOIN shared_catalog.product dg ON dg.ean = p.ean AND dg.origin = 'DROGAL'
         LEFT JOIN shared_catalog.product ds ON ds.ean = p.ean AND ds.origin = 'DROGASIL'
         LEFT JOIN shared_catalog.product mi ON mi.ean = p.ean AND mi.origin = 'MICHELASSI'
        ${f.where}
        ORDER BY p.ean LIMIT 50000`,
      f.params,
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
      'drogal',
      'drogasil',
      'michelassi',
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
    for (const r of rows) lines.push(cols.map((k) => esc(r[k])).join(','));
    return lines.join('\n');
  }

  /** Per-product stock: the tenant's own stock (by subsidiary) vs each
   *  competitor's latest stock snapshot, with a derived stock status. */
  public async stock(
    em: EntityManager,
    q: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>>> {
    const { page, perPage, offset } = this.paginate(q);
    const f = this.buildFilters(q);
    const order = this.orderBy(q);
    const count = await this.count(em, f);
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT p.ean, p.name, c.name AS classification,
              COALESCE(own.total, 0) AS "ownStock",
              own.by_sub AS "ownBySubsidiary",
              dg.q AS "drogalStock", ds.q AS "drogasilStock", mi.q AS "michelassiStock"
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         LEFT JOIN LATERAL (
           SELECT SUM(quantity)::int AS total,
                  jsonb_object_agg(subsidiary_external_id, quantity) AS by_sub
             FROM product_stock ps WHERE ps.ean = p.ean
         ) own ON true
         ${this.competitorStockLateral()}
        ${f.where}
        ORDER BY ${order}
        LIMIT $${f.params.length + 1} OFFSET $${f.params.length + 2}`,
      [...f.params, perPage, offset],
    );
    return {
      rows: rows.map((r) => {
        const own = Number(r.ownStock) || 0;
        const comp = [r.drogalStock, r.drogasilStock, r.michelassiStock].filter(
          (v) => Number(v) > 0,
        ).length;
        const stockStatus =
          own === 0 && comp >= 2
            ? 'ANALYZE_INCLUSION'
            : own === 0 && comp >= 1
              ? 'POTENTIAL'
              : 'OK';
        return { ...this.normalize(r), stockStatus };
      }),
      count,
      page,
      perPage,
    };
  }

  /** Aggregate stock coverage over the filtered set. */
  public async stockMetrics(
    em: EntityManager,
    q: ListProductsQueryDto,
  ): Promise<Record<string, number>> {
    const f = this.buildFilters(q);
    const rows: Array<Record<string, string>> = await em.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE COALESCE(own.total,0) > 0)::int AS "ownWithStock",
              count(*) FILTER (WHERE dg.q > 0)::int AS "drogalWithStock",
              count(*) FILTER (WHERE ds.q > 0)::int AS "drogasilWithStock",
              count(*) FILTER (WHERE mi.q > 0)::int AS "michelassiWithStock"
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         LEFT JOIN LATERAL (
           SELECT SUM(quantity)::int AS total FROM product_stock ps WHERE ps.ean = p.ean
         ) own ON true
         ${this.competitorStockLateral()}
        ${f.where}`,
      f.params,
    );
    const r = rows[0] ?? {};
    return {
      total: Number(r.total ?? 0),
      ownWithStock: Number(r.ownWithStock ?? 0),
      drogalWithStock: Number(r.drogalWithStock ?? 0),
      drogasilWithStock: Number(r.drogasilWithStock ?? 0),
      michelassiWithStock: Number(r.michelassiWithStock ?? 0),
    };
  }

  /** LATERAL joins for each competitor's latest stock snapshot (aliases
   *  dg/ds/mi each exposing `q`). */
  private competitorStockLateral(): string {
    const one = (alias: string, origin: string): string =>
      `LEFT JOIN LATERAL (
         SELECT st.quantity AS q
           FROM shared_catalog.product sp
           JOIN shared_catalog.product_stock st ON st.product_id = sp.id
          WHERE sp.ean = p.ean AND sp.origin = '${origin}'
          ORDER BY st.captured_at DESC LIMIT 1
       ) ${alias} ON true`;
    return [
      one('dg', 'DROGAL'),
      one('ds', 'DROGASIL'),
      one('mi', 'MICHELASSI'),
    ].join('\n         ');
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

    return {
      where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  private orderBy(q: ListProductsQueryDto): string {
    const col = (q.sortBy && SORTABLE[q.sortBy]) || 'p.ean';
    const dir = q.sortDirection?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    return `${col} ${dir}`;
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
