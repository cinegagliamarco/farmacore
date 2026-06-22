import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import {
  CompetitorMode,
  PricingSuggestionRuleEntity,
  RuleCompetitor,
  SuggestionStrategy,
} from '../../database/entities/tenant/pricing-suggestion-rule.entity';
import { UpsertSuggestionRuleDto } from './dto/suggestion-rule.dto';

/** Regra como o HTTP a devolve e o motor a consome (numéricos como number). */
export interface SuggestionRuleApi {
  id: string;
  name: string;
  classifications: string[];
  clusterId: string | null;
  clusterName: string | null;
  excludeClusterIds: string[];
  strategy: SuggestionStrategy;
  minMargin: number;
  competitorMode: CompetitorMode;
  competitors: { competitor: CompetitorOrigin; weight: number }[];
  variationPct: number;
  noCompetitorMargin: number | null;
  priceControlled: boolean;
  ignorePbm: boolean;
  applyRounding: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const VALID_ORIGINS = new Set<string>(Object.values(CompetitorOrigin));

interface RuleRow {
  id: string;
  name: string;
  classifications: string[];
  clusterId: string | null;
  clusterName: string | null;
  excludeClusterIds: string[];
  strategy: SuggestionStrategy;
  minMargin: string;
  competitorMode: CompetitorMode;
  competitors: RuleCompetitor[];
  variationPct: string;
  noCompetitorMargin: string | null;
  priceControlled: boolean;
  ignorePbm: boolean;
  applyRounding: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * CRUD das regras de sugestão (`pricing_suggestion_rule`, schema do tenant).
 * Espelha a validação do pricy-shelf `pricing-suggestion-rules-store.ts`; o
 * cálculo da sugestão fica no motor.
 */
@Injectable()
export class SuggestionRulesService {
  public async list(em: EntityManager): Promise<SuggestionRuleApi[]> {
    const rows: RuleRow[] = await em.query(
      `SELECT r.id, r.name, r.classifications,
              r.cluster_id AS "clusterId", cl.name AS "clusterName",
              r.exclude_cluster_ids AS "excludeClusterIds",
              r.strategy, r.min_margin AS "minMargin",
              r.competitor_mode AS "competitorMode", r.competitors,
              r.variation_pct AS "variationPct",
              r.no_competitor_margin AS "noCompetitorMargin",
              r.price_controlled AS "priceControlled", r.ignore_pbm AS "ignorePbm",
              r.apply_rounding AS "applyRounding", r.active,
              r.created_at AS "createdAt", r.updated_at AS "updatedAt"
         FROM pricing_suggestion_rule r
         LEFT JOIN product_cluster cl ON cl.id = r.cluster_id
        WHERE r.deleted_at IS NULL
        ORDER BY r.updated_at DESC`,
    );
    return rows.map((r) => this.toApi(r));
  }

  public async create(
    em: EntityManager,
    dto: UpsertSuggestionRuleDto,
  ): Promise<SuggestionRuleApi> {
    const values = this.validate(dto);
    const repo = em.getRepository(PricingSuggestionRuleEntity);
    const saved = await this.runOrMapFk(() => repo.save(repo.create(values)));
    return this.get(em, saved.id);
  }

  public async update(
    em: EntityManager,
    id: string,
    dto: UpsertSuggestionRuleDto,
  ): Promise<SuggestionRuleApi> {
    const values = this.validate(dto);
    const repo = em.getRepository(PricingSuggestionRuleEntity);
    const res = await this.runOrMapFk(() => repo.update({ id }, values));
    if (!res.affected) throw new NotFoundException(`rule ${id} not found`);
    return this.get(em, id);
  }

  /** FK cluster_id violada (23503): cluster apagado/inexistente → 400 claro. */
  private async runOrMapFk<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string }).code === '23503'
      ) {
        throw new BadRequestException(
          'Cluster da regra não existe (pode ter sido removido).',
        );
      }
      throw err;
    }
  }

  public async remove(
    em: EntityManager,
    id: string,
  ): Promise<{ id: string; deleted: boolean }> {
    const res = await em
      .getRepository(PricingSuggestionRuleEntity)
      .softDelete({ id });
    if (!res.affected) throw new NotFoundException(`rule ${id} not found`);
    return { id, deleted: true };
  }

  private async get(em: EntityManager, id: string): Promise<SuggestionRuleApi> {
    const rule = (await this.list(em)).find((r) => r.id === id);
    if (!rule) throw new NotFoundException(`rule ${id} not found`);
    return rule;
  }

  private toApi(r: RuleRow): SuggestionRuleApi {
    return {
      id: r.id,
      name: r.name,
      classifications: r.classifications,
      clusterId: r.clusterId,
      clusterName: r.clusterName,
      excludeClusterIds: r.excludeClusterIds,
      strategy: r.strategy,
      minMargin: Number(r.minMargin),
      competitorMode: r.competitorMode,
      competitors: r.competitors,
      variationPct: Number(r.variationPct),
      noCompetitorMargin:
        r.noCompetitorMargin == null ? null : Number(r.noCompetitorMargin),
      priceControlled: r.priceControlled,
      ignorePbm: r.ignorePbm,
      applyRounding: r.applyRounding,
      active: r.active,
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    };
  }

  /** Valida + normaliza (espelha pricy-shelf `validate()`). */
  private validate(
    dto: UpsertSuggestionRuleDto,
  ): Partial<PricingSuggestionRuleEntity> {
    const classifications = [
      ...new Set(
        (dto.classifications ?? []).map((c) => c.trim()).filter(Boolean),
      ),
    ];
    if (classifications.some((c) => c.length > 200)) {
      throw new BadRequestException(
        'Classificação inválida (máximo 200 caracteres).',
      );
    }

    const clusterId = dto.clusterId ? dto.clusterId.trim() : null;
    if (clusterId && classifications.length > 0) {
      throw new BadRequestException(
        'Uma regra mira classificação OU cluster, nunca os dois.',
      );
    }

    const excludeClusterIds = [
      ...new Set(
        (dto.excludeClusterIds ?? []).map((c) => c.trim()).filter(Boolean),
      ),
    ];
    if (clusterId && excludeClusterIds.includes(clusterId)) {
      throw new BadRequestException(
        'A regra não pode excluir o próprio cluster que ela mira.',
      );
    }

    const strategy = dto.strategy ?? 'margem';
    const competitorMode = dto.competitorMode ?? 'weighted';

    const seen = new Set<string>();
    const competitors: RuleCompetitor[] = [];
    for (const raw of dto.competitors ?? []) {
      if (!VALID_ORIGINS.has(raw.competitor)) {
        throw new BadRequestException(
          `Concorrente inválido: ${raw.competitor}.`,
        );
      }
      // weighted usa o peso %; cascade/lowest não usam (grava 1).
      let weight = 1;
      if (competitorMode === 'weighted') {
        if (raw.weight == null || raw.weight <= 0 || raw.weight > 100) {
          throw new BadRequestException(
            'Peso de concorrente precisa ser maior que 0 e até 100.',
          );
        }
        weight = raw.weight;
      }
      if (seen.has(raw.competitor)) continue;
      seen.add(raw.competitor);
      competitors.push({ competitor: raw.competitor, weight });
    }
    if (strategy === 'concorrencia' && competitors.length === 0) {
      throw new BadRequestException(
        'Estratégia de concorrência precisa de pelo menos um concorrente.',
      );
    }

    // noCompetitorMargin só faz sentido em concorrência; fora dela coage null.
    const noCompetitorMargin =
      strategy === 'concorrencia' && dto.noCompetitorMargin != null
        ? dto.noCompetitorMargin.toFixed(2)
        : null;

    return {
      name: dto.name.trim(),
      classifications,
      clusterId,
      excludeClusterIds,
      strategy,
      minMargin: dto.minMargin.toFixed(2),
      competitorMode,
      competitors,
      variationPct: (dto.variationPct ?? 0).toFixed(2),
      noCompetitorMargin,
      priceControlled: dto.priceControlled ?? false,
      ignorePbm: dto.ignorePbm ?? false,
      applyRounding: dto.applyRounding ?? true,
      active: dto.active ?? true,
    };
  }
}
