import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { resolveTenantId } from '../../tenant/tenant-lookup';
import {
  CreatePriceRoundingRuleDto,
  DecimalRangeDto,
  UpdatePriceRoundingRuleDto,
} from './dto/config.dto';

interface RuleRow {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  ranges: DecimalRangeDto[];
}

/**
 * Price-rounding rules — per-tenant control-plane config in core. Each rule
 * owns a set of decimal-range buckets; writes replace the buckets wholesale.
 */
@Injectable()
export class PriceRoundingService {
  public async list(em: EntityManager, slug: string): Promise<RuleRow[]> {
    const tenantId = await resolveTenantId(em, slug);
    const rules: Array<Omit<RuleRow, 'ranges'>> = await em.query(
      `SELECT id, name, enabled, priority
         FROM core.price_rounding_rule
        WHERE tenant_id = $1
        ORDER BY priority ASC, name ASC`,
      [tenantId],
    );
    if (!rules.length) return [];
    const ranges = await this.rangesFor(
      em,
      rules.map((r) => r.id),
    );
    return rules.map((r) => ({ ...r, ranges: ranges.get(r.id) ?? [] }));
  }

  public async get(
    em: EntityManager,
    slug: string,
    id: string,
  ): Promise<RuleRow> {
    const tenantId = await resolveTenantId(em, slug);
    const rows: Array<Omit<RuleRow, 'ranges'>> = await em.query(
      `SELECT id, name, enabled, priority
         FROM core.price_rounding_rule
        WHERE tenant_id = $1 AND id = $2
        LIMIT 1`,
      [tenantId, id],
    );
    if (!rows.length) throw new NotFoundException(`rule ${id} not found`);
    const ranges = await this.rangesFor(em, [id]);
    return { ...rows[0], ranges: ranges.get(id) ?? [] };
  }

  public async create(
    em: EntityManager,
    slug: string,
    dto: CreatePriceRoundingRuleDto,
  ): Promise<RuleRow> {
    const tenantId = await resolveTenantId(em, slug);
    const [{ id }]: Array<{ id: string }> = await em.query(
      `INSERT INTO core.price_rounding_rule (tenant_id, name, enabled, priority)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, dto.name, dto.enabled ?? true, dto.priority ?? 100],
    );
    await this.insertRanges(em, tenantId, id, dto.ranges ?? []);
    return this.get(em, slug, id);
  }

  public async update(
    em: EntityManager,
    slug: string,
    id: string,
    dto: UpdatePriceRoundingRuleDto,
  ): Promise<RuleRow> {
    const tenantId = await resolveTenantId(em, slug);
    await this.get(em, slug, id); // 404 if not this tenant's rule
    await em.query(
      `UPDATE core.price_rounding_rule
          SET name = COALESCE($1, name),
              enabled = COALESCE($2, enabled),
              priority = COALESCE($3, priority),
              updated_at = now()
        WHERE id = $4`,
      [dto.name ?? null, dto.enabled ?? null, dto.priority ?? null, id],
    );
    if (dto.ranges !== undefined) {
      await em.query(
        `DELETE FROM core.price_rounding_decimal_range WHERE rule_id = $1`,
        [id],
      );
      await this.insertRanges(em, tenantId, id, dto.ranges);
    }
    return this.get(em, slug, id);
  }

  public async remove(
    em: EntityManager,
    slug: string,
    id: string,
  ): Promise<{ id: string; deleted: boolean }> {
    await this.get(em, slug, id);
    await em.query(`DELETE FROM core.price_rounding_rule WHERE id = $1`, [id]);
    return { id, deleted: true };
  }

  private async insertRanges(
    em: EntityManager,
    tenantId: string,
    ruleId: string,
    ranges: DecimalRangeDto[],
  ): Promise<void> {
    for (const r of ranges)
      await em.query(
        `INSERT INTO core.price_rounding_decimal_range
           (tenant_id, rule_id, min_decimal, max_decimal, target_decimal)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, ruleId, r.minDecimal, r.maxDecimal, r.targetDecimal],
      );
  }

  private async rangesFor(
    em: EntityManager,
    ruleIds: string[],
  ): Promise<Map<string, DecimalRangeDto[]>> {
    const rows: Array<{
      ruleId: string;
      minDecimal: string;
      maxDecimal: string;
      targetDecimal: string;
    }> = await em.query(
      `SELECT rule_id AS "ruleId",
              min_decimal AS "minDecimal",
              max_decimal AS "maxDecimal",
              target_decimal AS "targetDecimal"
         FROM core.price_rounding_decimal_range
        WHERE rule_id = ANY($1)
        ORDER BY min_decimal ASC`,
      [ruleIds],
    );
    const map = new Map<string, DecimalRangeDto[]>();
    for (const r of rows) {
      const range: DecimalRangeDto = {
        minDecimal: Number(r.minDecimal),
        maxDecimal: Number(r.maxDecimal),
        targetDecimal: Number(r.targetDecimal),
      };
      const list = map.get(r.ruleId);
      if (list) list.push(range);
      else map.set(r.ruleId, [range]);
    }
    return map;
  }
}
