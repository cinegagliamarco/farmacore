import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ListProductsQueryDto } from './dto/list-products.query';

export interface Paginated<T> {
  rows: T[];
  count: number;
  page: number;
  perPage: number;
}

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 200;

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
