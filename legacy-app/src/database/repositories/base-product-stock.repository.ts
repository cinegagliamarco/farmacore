import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BaseProductStockTypeormEntity } from '../entities/base-product-stock.entity';
import { SubsidiaryMaping } from '../../common/subsidiary-name.enum';

@Injectable()
export class BaseProductStockRepository {
  constructor(private readonly repository: Repository<BaseProductStockTypeormEntity>) {}

  public async findByBaseProductId(baseProductId: number): Promise<BaseProductStockTypeormEntity | null> {
    return this.repository.findOne({ where: { baseProductId } });
  }

  public async upsert(baseProductId: number, quantity: number, subsidiaryId: number): Promise<BaseProductStockTypeormEntity> {
    const existingStock = await this.repository.findOne({
      where: { baseProductId, subsidiaryId }
    });

    if (existingStock) {
      await this.repository.update({ baseProductId }, { quantity });
      return this.repository.findOne({ where: { baseProductId } });
    }

    const subsidiary = SubsidiaryMaping.get(subsidiaryId);
    if (!subsidiary) {
      throw new Error(`Subsidiary not found for id: ${subsidiaryId}`);
    }
    return this.repository.save({
      baseProductId,
      quantity,
      subsidiaryId: subsidiary?.externalId,
      subsidiaryName: subsidiary?.name
    });
  }

  public async deleteObsolete(validBaseProductIds: number[]): Promise<void> {
    if (validBaseProductIds.length === 0) {
      return;
    }

    await this.repository
      .createQueryBuilder()
      .softDelete()
      .where('base_product_id NOT IN (:...validBaseProductIds)', { validBaseProductIds })
      .execute();
  }

  public async findAll(): Promise<BaseProductStockTypeormEntity[]> {
    return this.repository.find();
  }

  public async count(): Promise<number> {
    return this.repository.count();
  }

  public async deleteByBaseProductId(baseProductId: number): Promise<void> {
    await this.repository.delete({ baseProductId });
  }
}
