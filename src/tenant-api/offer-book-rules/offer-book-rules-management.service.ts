import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CalculationBaseType } from '../../database/enums/calculation-base-type.enum';
import { PriceBaseSource } from '../../database/enums/price-base-source.enum';
import { PricingActionType } from '../../database/enums/pricing-action-type.enum';
import {
  CreateOfferBookRuleDto,
  ListExecutionReportsQueryDto,
  ListOfferBookRulesQueryDto,
  UpdateOfferBookRuleDto,
} from './dto/offer-book-rule.dto';
import {
  CreatePriceLockDto,
  CreatePricingRuleDto,
  PaginatedPreviewResult,
  PreviewOfferBookRulesDto,
  PreviewProductResult,
} from './dto/preview-offer-book-rules.dto';
import { OfferBookRulesService } from './offer-book-rules.service';

export interface OfferBookRuleDetail {
  id: string;
  name: string;
  description: string | null;
  calculationBaseType: CalculationBaseType;
  priceBaseSources: PriceBaseSource[] | null;
  eans: string[] | null;
  classifications: string[] | null;
  applyPriceRounding: boolean;
  enabled: boolean;
  pricingRules: CreatePricingRuleDto[];
  priceLocks: CreatePriceLockDto[];
  createdAt: Date;
  updatedAt: Date;
}

const MAX_PAGE_SIZE = 1000;

/**
 * Persistence + reporting for saved offer-book rules. CRUD lives here; the
 * actual price math is delegated to OfferBookRulesService (the engine), reused
 * for both the saved preview and the product listing. Applying prices to the
 * ERP (execute) is intentionally NOT here — it has irreversible side effects
 * and lands in its own pass.
 */
@Injectable()
export class OfferBookRulesManagementService {
  constructor(private readonly engine: OfferBookRulesService) {}

  // ----- CRUD -----

  public async create(
    em: EntityManager,
    dto: CreateOfferBookRuleDto,
  ): Promise<OfferBookRuleDetail> {
    this.assertTarget(
      dto.eans,
      dto.classifications,
      dto.calculationBaseType,
      dto.priceBaseSources,
    );
    const pricingRules = this.engine.normalizePricingRules(dto.pricingRules);
    const priceLocks = this.engine.normalizePriceLocks(dto.priceLocks);
    this.engine.validateNonOverlappingPricingRules(pricingRules);
    this.engine.validateNonOverlappingPriceLocks(priceLocks);

    const [{ id }]: Array<{ id: string }> = await em.query(
      `INSERT INTO offer_book_rule
         (name, description, calculation_base_type, price_base_sources,
          target_classifications, apply_price_rounding, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        dto.name,
        dto.description ?? null,
        dto.calculationBaseType,
        dto.priceBaseSources ?? null,
        dto.classifications?.length ? dto.classifications : null,
        dto.applyPriceRounding ?? false,
        dto.enabled ?? true,
      ],
    );
    await this.insertChildren(em, id, pricingRules, priceLocks, dto.eans);
    return this.getById(em, id);
  }

  public async list(
    em: EntityManager,
    q: ListOfferBookRulesQueryDto,
  ): Promise<{ rows: Array<Record<string, unknown>>; count: number }> {
    const { pageSize, offset } = this.paginate(q.page, q.pageSize, 20);
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    if (q.name) {
      params.push(`%${q.name}%`);
      where.push(`name ILIKE $${params.length}`);
    }
    if (q.enabled !== undefined) {
      params.push(q.enabled);
      where.push(`enabled = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const [{ count }]: Array<{ count: number }> = await em.query(
      `SELECT count(*)::int AS count FROM offer_book_rule ${whereSql}`,
      params,
    );
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT id, name, description,
              calculation_base_type AS "calculationBaseType",
              price_base_sources AS "priceBaseSources",
              target_classifications AS "classifications",
              apply_price_rounding AS "applyPriceRounding", enabled,
              created_at AS "createdAt", updated_at AS "updatedAt"
         FROM offer_book_rule ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );
    return { rows, count };
  }

  public async getById(
    em: EntityManager,
    id: string,
  ): Promise<OfferBookRuleDetail> {
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT id, name, description,
              calculation_base_type AS "calculationBaseType",
              price_base_sources AS "priceBaseSources",
              target_classifications AS "classifications",
              apply_price_rounding AS "applyPriceRounding", enabled,
              created_at AS "createdAt", updated_at AS "updatedAt"
         FROM offer_book_rule WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!rows.length)
      throw new NotFoundException(`offer book rule ${id} not found`);
    const r = rows[0];

    const pricingRuleRows: Array<Record<string, unknown>> = await em.query(
      `SELECT classifications,
              price_range_min AS "priceRangeMin", price_range_max AS "priceRangeMax",
              margin_range_min AS "marginRangeMin", margin_range_max AS "marginRangeMax",
              action_type AS "actionType", percentage_value AS "percentageValue", active
         FROM offer_book_pricing_rule
        WHERE rule_id = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC`,
      [id],
    );
    const pricingRules = pricingRuleRows.map(toPricingRule);
    const priceLockRows: Array<Record<string, unknown>> = await em.query(
      `SELECT classifications, min_margin AS "minMargin", active
         FROM offer_book_price_lock
        WHERE rule_id = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC`,
      [id],
    );
    const priceLocks = priceLockRows.map(toPriceLock);
    const eanRows: Array<{ ean: string }> = await em.query(
      `SELECT ean FROM offer_book_rule_product
        WHERE rule_id = $1 AND deleted_at IS NULL ORDER BY ean ASC`,
      [id],
    );
    const eans = eanRows.map((e) => String(e.ean));

    return {
      id: r.id as string,
      name: r.name as string,
      description: (r.description as string | null) ?? null,
      calculationBaseType: r.calculationBaseType as CalculationBaseType,
      priceBaseSources:
        (r.priceBaseSources as PriceBaseSource[] | null) ?? null,
      eans: eans.length ? eans : null,
      classifications: (r.classifications as string[] | null) ?? null,
      applyPriceRounding: r.applyPriceRounding as boolean,
      enabled: r.enabled as boolean,
      pricingRules,
      priceLocks,
      createdAt: r.createdAt as Date,
      updatedAt: r.updatedAt as Date,
    };
  }

  public async update(
    em: EntityManager,
    id: string,
    dto: UpdateOfferBookRuleDto,
  ): Promise<OfferBookRuleDetail> {
    const current = await this.getById(em, id); // 404 if missing

    const calculationBaseType =
      dto.calculationBaseType ?? current.calculationBaseType;
    const priceBaseSources =
      dto.priceBaseSources !== undefined
        ? dto.priceBaseSources
        : (current.priceBaseSources ?? undefined);
    // Target: an update may switch eans<->classifications. Resolve the effective pair.
    const eans =
      dto.eans !== undefined
        ? dto.eans
        : dto.classifications !== undefined
          ? undefined
          : (current.eans ?? undefined);
    const classifications =
      dto.classifications !== undefined
        ? dto.classifications
        : dto.eans !== undefined
          ? undefined
          : (current.classifications ?? undefined);
    this.assertTarget(
      eans,
      classifications,
      calculationBaseType,
      priceBaseSources,
    );

    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown): void => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (dto.name !== undefined) set('name', dto.name);
    if (dto.description !== undefined) set('description', dto.description);
    if (dto.calculationBaseType !== undefined)
      set('calculation_base_type', dto.calculationBaseType);
    if (dto.priceBaseSources !== undefined)
      set('price_base_sources', dto.priceBaseSources ?? null);
    if (dto.applyPriceRounding !== undefined)
      set('apply_price_rounding', dto.applyPriceRounding);
    if (dto.enabled !== undefined) set('enabled', dto.enabled);
    if (dto.classifications !== undefined || dto.eans !== undefined)
      set(
        'target_classifications',
        classifications?.length ? classifications : null,
      );
    if (sets.length) {
      params.push(id);
      await em.query(
        `UPDATE offer_book_rule SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
        params,
      );
    }

    if (dto.pricingRules !== undefined) {
      const normalized = this.engine.normalizePricingRules(dto.pricingRules);
      this.engine.validateNonOverlappingPricingRules(normalized);
      await em.query(`DELETE FROM offer_book_pricing_rule WHERE rule_id = $1`, [
        id,
      ]);
      await this.insertPricingRules(em, id, normalized);
    }
    if (dto.priceLocks !== undefined) {
      const normalized = this.engine.normalizePriceLocks(dto.priceLocks);
      this.engine.validateNonOverlappingPriceLocks(normalized);
      await em.query(`DELETE FROM offer_book_price_lock WHERE rule_id = $1`, [
        id,
      ]);
      await this.insertPriceLocks(em, id, normalized);
    }
    if (dto.eans !== undefined || dto.classifications !== undefined) {
      await em.query(`DELETE FROM offer_book_rule_product WHERE rule_id = $1`, [
        id,
      ]);
      await this.insertProducts(em, id, eans);
    }

    return this.getById(em, id);
  }

  public async remove(
    em: EntityManager,
    id: string,
  ): Promise<{ id: string; deleted: boolean }> {
    await this.getById(em, id); // 404 if missing
    // FK ON DELETE CASCADE drops children + reports with the rule.
    await em.query(`DELETE FROM offer_book_rule WHERE id = $1`, [id]);
    return { id, deleted: true };
  }

  // ----- saved-rule views (reuse the engine) -----

  public async previewSaved(
    em: EntityManager,
    slug: string,
    id: string,
    page?: number,
    pageSize?: number,
  ): Promise<PaginatedPreviewResult> {
    const rule = await this.getById(em, id);
    return this.engine.preview(
      em,
      slug,
      this.toPreviewDto(rule, page, pageSize),
    );
  }

  public async getProducts(
    em: EntityManager,
    slug: string,
    id: string,
    page?: number,
    pageSize?: number,
  ): Promise<{
    rows: Array<
      Pick<
        PreviewProductResult,
        | 'ean'
        | 'name'
        | 'externalId'
        | 'classification'
        | 'currentPrice'
        | 'currentMargin'
        | 'cost'
      >
    >;
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const rule = await this.getById(em, id);
    // No rules/locks → finalPrice == currentPrice; we just want the target set.
    const dto = this.toPreviewDto(rule, page, pageSize);
    dto.pricingRules = [];
    dto.priceLocks = [];
    dto.applyPriceRounding = false;
    const res = await this.engine.preview(em, slug, dto);
    return {
      ...res,
      rows: res.rows.map((r) => ({
        ean: r.ean,
        name: r.name,
        externalId: r.externalId,
        classification: r.classification,
        currentPrice: r.currentPrice,
        currentMargin: r.currentMargin,
        cost: r.cost,
      })),
    };
  }

  public async downloadPreviewAdhoc(
    em: EntityManager,
    slug: string,
    dto: PreviewOfferBookRulesDto,
  ): Promise<string> {
    const res = await this.engine.preview(em, slug, {
      ...dto,
      page: 1,
      pageSize: MAX_PAGE_SIZE,
    });
    return toCsv(res.rows);
  }

  public async downloadPreviewSaved(
    em: EntityManager,
    slug: string,
    id: string,
  ): Promise<string> {
    const res = await this.previewSaved(em, slug, id, 1, MAX_PAGE_SIZE);
    return toCsv(res.rows);
  }

  // ----- execution reports (read) -----

  public async listReports(
    em: EntityManager,
    q: ListExecutionReportsQueryDto,
  ): Promise<{ rows: Array<Record<string, unknown>>; count: number }> {
    const { pageSize, offset } = this.paginate(q.page, q.pageSize, 20);
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    const add = (cond: string, val: unknown): void => {
      params.push(val);
      where.push(cond.replace('?', `$${params.length}`));
    };
    if (q.ruleId) add('rule_id = ?', q.ruleId);
    if (q.executionType) add('execution_type = ?', q.executionType);
    if (q.outcome) add('outcome = ?', q.outcome);
    if (q.startDate) add('started_at >= ?', q.startDate);
    if (q.endDate) add('started_at <= ?', q.endDate);
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const [{ count }]: Array<{ count: number }> = await em.query(
      `SELECT count(*)::int AS count FROM offer_book_rule_execution_report ${whereSql}`,
      params,
    );
    const rows: Array<Record<string, unknown>> = await em.query(
      `${REPORT_HEADER_SELECT} ${whereSql}
        ORDER BY started_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );
    return { rows, count };
  }

  public async listReportsByRule(
    em: EntityManager,
    ruleId: string,
    page?: number,
    pageSize?: number,
  ): Promise<{ rows: Array<Record<string, unknown>>; count: number }> {
    return this.listReports(em, { ruleId, page, pageSize });
  }

  public async getReport(
    em: EntityManager,
    id: string,
    page?: number,
    pageSize?: number,
    name?: string,
  ): Promise<Record<string, unknown>> {
    const headers: Array<Record<string, unknown>> = await em.query(
      `${REPORT_HEADER_SELECT} WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!headers.length)
      throw new NotFoundException(`execution report ${id} not found`);

    const p = this.paginate(page, pageSize, 50);
    const itemWhere: string[] = ['report_id = $1', 'deleted_at IS NULL'];
    const itemParams: unknown[] = [id];
    if (name) {
      itemParams.push(`%${name}%`);
      itemWhere.push(`name ILIKE $${itemParams.length}`);
    }
    const itemWhereSql = `WHERE ${itemWhere.join(' AND ')}`;
    const [{ count }]: Array<{ count: number }> = await em.query(
      `SELECT count(*)::int AS count FROM offer_book_rule_execution_report_item ${itemWhereSql}`,
      itemParams,
    );
    const items: Array<Record<string, unknown>> = await em.query(
      `${REPORT_ITEM_SELECT} ${itemWhereSql}
        ORDER BY ean ASC
        LIMIT $${itemParams.length + 1} OFFSET $${itemParams.length + 2}`,
      [...itemParams, p.pageSize, p.offset],
    );
    return {
      ...headers[0],
      items: { rows: items, count, page: p.page, pageSize: p.pageSize },
    };
  }

  // ----- helpers -----

  private toPreviewDto(
    rule: OfferBookRuleDetail,
    page?: number,
    pageSize?: number,
  ): PreviewOfferBookRulesDto {
    return {
      calculationBaseType: rule.calculationBaseType,
      priceBaseSources: rule.priceBaseSources ?? undefined,
      eans: rule.eans?.length ? rule.eans : undefined,
      classifications: rule.classifications?.length
        ? rule.classifications
        : undefined,
      pricingRules: rule.pricingRules,
      priceLocks: rule.priceLocks,
      applyPriceRounding: rule.applyPriceRounding,
      page,
      pageSize,
    };
  }

  private assertTarget(
    eans: string[] | undefined,
    classifications: string[] | undefined,
    calculationBaseType: CalculationBaseType,
    priceBaseSources: PriceBaseSource[] | undefined,
  ): void {
    const byEans = !!eans?.length;
    const byClassifications = !!classifications?.length;
    if (byEans === byClassifications)
      throw new BadRequestException(
        'Target the rule by either eans or classifications, but not both',
      );
    if (
      calculationBaseType === CalculationBaseType.COMPETITIVE_PRICE &&
      !priceBaseSources?.length
    )
      throw new BadRequestException(
        'priceBaseSources is required when calculationBaseType is COMPETITIVE_PRICE',
      );
  }

  private async insertChildren(
    em: EntityManager,
    ruleId: string,
    pricingRules: CreatePricingRuleDto[],
    priceLocks: CreatePriceLockDto[],
    eans: string[] | undefined,
  ): Promise<void> {
    await this.insertPricingRules(em, ruleId, pricingRules);
    await this.insertPriceLocks(em, ruleId, priceLocks);
    await this.insertProducts(em, ruleId, eans);
  }

  private async insertPricingRules(
    em: EntityManager,
    ruleId: string,
    rules: CreatePricingRuleDto[],
  ): Promise<void> {
    for (const r of rules) {
      await em.query(
        `INSERT INTO offer_book_pricing_rule
           (rule_id, classifications, price_range_min, price_range_max,
            margin_range_min, margin_range_max, action_type, percentage_value, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          ruleId,
          r.classifications?.length ? r.classifications : null,
          r.priceRangeMin ?? null,
          r.priceRangeMax ?? null,
          r.marginRangeMin ?? null,
          r.marginRangeMax ?? null,
          r.actionType,
          r.percentageValue,
          r.active ?? true,
        ],
      );
    }
  }

  private async insertPriceLocks(
    em: EntityManager,
    ruleId: string,
    locks: CreatePriceLockDto[],
  ): Promise<void> {
    for (const l of locks) {
      await em.query(
        `INSERT INTO offer_book_price_lock (rule_id, classifications, min_margin, active)
         VALUES ($1,$2,$3,$4)`,
        [
          ruleId,
          l.classifications?.length ? l.classifications : null,
          l.minMargin,
          l.active ?? true,
        ],
      );
    }
  }

  private async insertProducts(
    em: EntityManager,
    ruleId: string,
    eans: string[] | undefined,
  ): Promise<void> {
    if (!eans?.length) return;
    for (const ean of [...new Set(eans)]) {
      await em.query(
        `INSERT INTO offer_book_rule_product (rule_id, ean) VALUES ($1, $2)
         ON CONFLICT (rule_id, ean) DO NOTHING`,
        [ruleId, ean],
      );
    }
  }

  private paginate(
    page: number | undefined,
    pageSize: number | undefined,
    defaultSize: number,
  ): { page: number; pageSize: number; offset: number } {
    const p = page && page > 0 ? page : 1;
    const size = Math.min(
      pageSize && pageSize > 0 ? pageSize : defaultSize,
      MAX_PAGE_SIZE,
    );
    return { page: p, pageSize: size, offset: (p - 1) * size };
  }
}

const REPORT_HEADER_SELECT = `SELECT id, rule_id AS "ruleId",
  execution_type AS "executionType", calculation_base_type AS "calculationBaseType",
  started_at AS "startedAt", finished_at AS "finishedAt",
  total_products AS "totalProducts", products_updated AS "productsUpdated",
  products_skipped AS "productsSkipped", outcome, error_message AS "errorMessage"
  FROM offer_book_rule_execution_report`;

const REPORT_ITEM_SELECT = `SELECT ean, name, classification,
  base_sale_price AS "baseSalePrice", current_price AS "currentPrice",
  current_margin AS "currentMargin", cost, action_type AS "actionType",
  percentage_value AS "percentageValue", applied_percentage_value AS "appliedPercentageValue",
  final_price AS "finalPrice", new_margin AS "newMargin",
  price_lock_applied AS "priceLockApplied", discount_skipped AS "discountSkipped",
  skipped_no_competitor_price AS "skippedNoCompetitorPrice",
  skipped_price_exceeds_limit AS "skippedPriceExceedsLimit",
  price_rounding_applied AS "priceRoundingApplied", was_updated AS "wasUpdated"
  FROM offer_book_rule_execution_report_item`;

function numOrUndef(v: unknown): number | undefined {
  return v === null || v === undefined ? undefined : Number(v);
}

function toPricingRule(r: Record<string, unknown>): CreatePricingRuleDto {
  return {
    classifications: (r.classifications as string[] | null) ?? undefined,
    priceRangeMin: numOrUndef(r.priceRangeMin),
    priceRangeMax: numOrUndef(r.priceRangeMax),
    marginRangeMin: numOrUndef(r.marginRangeMin),
    marginRangeMax: numOrUndef(r.marginRangeMax),
    actionType: r.actionType as PricingActionType,
    percentageValue: Number(r.percentageValue),
    active: r.active as boolean,
  };
}

function toPriceLock(r: Record<string, unknown>): CreatePriceLockDto {
  return {
    classifications: (r.classifications as string[] | null) ?? undefined,
    minMargin: Number(r.minMargin),
    active: r.active as boolean,
  };
}

const CSV_COLUMNS: Array<[keyof PreviewProductResult, string]> = [
  ['ean', 'EAN'],
  ['name', 'Nome'],
  ['externalId', 'ID Externo'],
  ['classification', 'Classificacao'],
  ['baseSalePrice', 'Preco Venda'],
  ['baseOfferPrice', 'Preco Oferta'],
  ['currentPrice', 'Preco Base'],
  ['currentMargin', 'Margem Atual'],
  ['cost', 'Custo'],
  ['actionType', 'Acao'],
  ['percentageValue', 'Percentual'],
  ['appliedPercentageValue', 'Percentual Aplicado'],
  ['finalPrice', 'Preco Final'],
  ['newMargin', 'Nova Margem'],
  ['priceLockApplied', 'Trava Aplicada'],
  ['skippedNoCompetitorPrice', 'Sem Concorrente'],
  ['skippedPriceExceedsLimit', 'Acima do Preco de Venda'],
  ['priceRoundingApplied', 'Arredondado'],
];

function toCsv(rows: PreviewProductResult[]): string {
  const header = CSV_COLUMNS.map(([, label]) => label).join(',');
  const body = rows.map((row) =>
    CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(','),
  );
  return [header, ...body].join('\n');
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
