import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PriceRoundingRuleTypeormEntity } from '../entities/price-rounding-rule.entity';

@Injectable()
export class PriceRoundingRuleRepository {
  constructor(private readonly repository: Repository<PriceRoundingRuleTypeormEntity>) {}

  public async findById(id: number): Promise<PriceRoundingRuleTypeormEntity | null> {
    return this.repository.findOne({
      where: { id },
      relations: ['decimalRanges']
    });
  }

  public async findAllActive(): Promise<PriceRoundingRuleTypeormEntity[]> {
    return this.repository.find({
      where: { active: true },
      relations: ['decimalRanges'],
      order: { priceRangeMin: 'ASC' }
    });
  }

  public async findPaginated(page: number, perPage: number, filters: { active?: boolean }): Promise<[PriceRoundingRuleTypeormEntity[], number]> {
    const queryBuilder = this.repository.createQueryBuilder('rule').leftJoinAndSelect('rule.decimalRanges', 'decimalRanges');

    if (filters.active !== undefined) {
      queryBuilder.andWhere('rule.active = :active', { active: filters.active });
    }

    queryBuilder
      .skip(((page <= 0 ? 1 : page) - 1) * perPage)
      .take(perPage)
      .orderBy('rule.id', 'DESC');

    return queryBuilder.getManyAndCount();
  }

  public async findOverlappingRules(priceRangeMin: number, priceRangeMax: number, excludeId?: number): Promise<PriceRoundingRuleTypeormEntity[]> {
    const queryBuilder = this.repository
      .createQueryBuilder('rule')
      .where('rule.priceRangeMin <= :priceRangeMax', { priceRangeMax })
      .andWhere('rule.priceRangeMax >= :priceRangeMin', { priceRangeMin });

    if (excludeId !== undefined) {
      queryBuilder.andWhere('rule.id != :excludeId', { excludeId });
    }

    return queryBuilder.getMany();
  }

  public async save(entity: PriceRoundingRuleTypeormEntity): Promise<PriceRoundingRuleTypeormEntity> {
    return this.repository.save(entity);
  }

  public async create(entity: Partial<PriceRoundingRuleTypeormEntity>): Promise<PriceRoundingRuleTypeormEntity> {
    const newEntity = this.repository.create(entity);
    return this.repository.save(newEntity);
  }

  public async delete(id: number): Promise<void> {
    await this.repository.delete(id);
  }

  public async deleteDecimalRangesByRuleId(ruleId: number): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .delete()
      .from('price_rounding_decimal_range')
      .where('price_rounding_rule_id = :ruleId', { ruleId })
      .execute();
  }
}
