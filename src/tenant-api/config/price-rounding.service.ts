import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { resolveTenantId } from '../../tenant/tenant-lookup';
import {
  CreatePriceRoundingRangeDto,
  PriceRoundingRuleDto,
  UpdatePriceRoundingRangeDto,
} from './dto/config.dto';

interface RangeRow {
  id: string;
  priceMin: number;
  priceMax: number;
  rules: PriceRoundingRuleDto[];
}

/**
 * Price-rounding config — per-tenant control-plane in core. A price band
 * [priceMin, priceMax] owns decimal-bucket rules; writes replace the
 * buckets wholesale. Mirrors pricy-shelf's price_rounding_range/_rule.
 */
@Injectable()
export class PriceRoundingService {
  public async list(em: EntityManager, slug: string): Promise<RangeRow[]> {
    const tenantId = await resolveTenantId(em, slug);
    const ranges: Array<{ id: string; priceMin: string; priceMax: string }> =
      await em.query(
        `SELECT id, price_min AS "priceMin", price_max AS "priceMax"
           FROM core.price_rounding_range
          WHERE tenant_id = $1
          ORDER BY price_min ASC`,
        [tenantId],
      );
    if (!ranges.length) return [];
    const rules = await this.rulesFor(
      em,
      ranges.map((r) => r.id),
    );
    return ranges.map((r) => ({
      id: r.id,
      priceMin: Number(r.priceMin),
      priceMax: Number(r.priceMax),
      rules: rules.get(r.id) ?? [],
    }));
  }

  public async get(
    em: EntityManager,
    slug: string,
    id: string,
  ): Promise<RangeRow> {
    const tenantId = await resolveTenantId(em, slug);
    const rows: Array<{ id: string; priceMin: string; priceMax: string }> =
      await em.query(
        `SELECT id, price_min AS "priceMin", price_max AS "priceMax"
           FROM core.price_rounding_range
          WHERE tenant_id = $1 AND id = $2
          LIMIT 1`,
        [tenantId, id],
      );
    if (!rows.length) throw new NotFoundException(`range ${id} not found`);
    const rules = await this.rulesFor(em, [id]);
    return {
      id: rows[0].id,
      priceMin: Number(rows[0].priceMin),
      priceMax: Number(rows[0].priceMax),
      rules: rules.get(id) ?? [],
    };
  }

  public async create(
    em: EntityManager,
    slug: string,
    dto: CreatePriceRoundingRangeDto,
  ): Promise<RangeRow> {
    const tenantId = await resolveTenantId(em, slug);
    this.assertBand(dto.priceMin, dto.priceMax);
    const [{ id }]: Array<{ id: string }> = await em.query(
      `INSERT INTO core.price_rounding_range (tenant_id, price_min, price_max)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, dto.priceMin, dto.priceMax],
    );
    await this.insertRules(em, tenantId, id, dto.rules ?? []);
    return this.get(em, slug, id);
  }

  public async update(
    em: EntityManager,
    slug: string,
    id: string,
    dto: UpdatePriceRoundingRangeDto,
  ): Promise<RangeRow> {
    const tenantId = await resolveTenantId(em, slug);
    const current = await this.get(em, slug, id); // 404 if not this tenant's range
    this.assertBand(
      dto.priceMin ?? current.priceMin,
      dto.priceMax ?? current.priceMax,
    );
    await em.query(
      `UPDATE core.price_rounding_range
          SET price_min = COALESCE($1, price_min),
              price_max = COALESCE($2, price_max),
              updated_at = now()
        WHERE id = $3`,
      [dto.priceMin ?? null, dto.priceMax ?? null, id],
    );
    if (dto.rules !== undefined) {
      await em.query(
        `DELETE FROM core.price_rounding_rule WHERE range_id = $1`,
        [id],
      );
      await this.insertRules(em, tenantId, id, dto.rules);
    }
    return this.get(em, slug, id);
  }

  public async remove(
    em: EntityManager,
    slug: string,
    id: string,
  ): Promise<{ id: string; deleted: boolean }> {
    await this.get(em, slug, id);
    await em.query(`DELETE FROM core.price_rounding_range WHERE id = $1`, [id]);
    return { id, deleted: true };
  }

  private async insertRules(
    em: EntityManager,
    tenantId: string,
    rangeId: string,
    rules: PriceRoundingRuleDto[],
  ): Promise<void> {
    for (const r of rules) {
      if (r.decimalMin > r.decimalMax)
        throw new BadRequestException(
          `decimalMin (${r.decimalMin}) must be <= decimalMax (${r.decimalMax})`,
        );
      await em.query(
        `INSERT INTO core.price_rounding_rule
           (tenant_id, range_id, decimal_min, decimal_max, round_to)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, rangeId, r.decimalMin, r.decimalMax, r.roundTo],
      );
    }
  }

  private assertBand(priceMin: number, priceMax: number): void {
    if (priceMin > priceMax)
      throw new BadRequestException(
        `priceMin (${priceMin}) must be <= priceMax (${priceMax})`,
      );
  }

  private async rulesFor(
    em: EntityManager,
    rangeIds: string[],
  ): Promise<Map<string, PriceRoundingRuleDto[]>> {
    const rows: Array<{
      rangeId: string;
      decimalMin: string;
      decimalMax: string;
      roundTo: string;
    }> = await em.query(
      `SELECT range_id AS "rangeId",
              decimal_min AS "decimalMin",
              decimal_max AS "decimalMax",
              round_to AS "roundTo"
         FROM core.price_rounding_rule
        WHERE range_id = ANY($1)
        ORDER BY decimal_min ASC`,
      [rangeIds],
    );
    const map = new Map<string, PriceRoundingRuleDto[]>();
    for (const r of rows) {
      const rule: PriceRoundingRuleDto = {
        decimalMin: Number(r.decimalMin),
        decimalMax: Number(r.decimalMax),
        roundTo: Number(r.roundTo),
      };
      const list = map.get(r.rangeId);
      if (list) list.push(rule);
      else map.set(r.rangeId, [rule]);
    }
    return map;
  }
}
