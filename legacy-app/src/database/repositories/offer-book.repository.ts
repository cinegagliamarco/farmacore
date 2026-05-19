import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { OfferBookTypeormEntity } from '../entities/offer-book.entity';

@Injectable()
export class OfferBookRepository {
  constructor(private readonly repository: Repository<OfferBookTypeormEntity>) {}

  public async findAll(): Promise<OfferBookTypeormEntity[]> {
    return this.repository.find();
  }

  public async findById(id: number): Promise<OfferBookTypeormEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  public async findByBaseProductId(baseProductId: number): Promise<OfferBookTypeormEntity[]> {
    return this.repository.find({ where: { baseProductId } });
  }

  public async findByExternalId(externalId: number): Promise<OfferBookTypeormEntity | null> {
    return this.repository.findOne({ where: { externalId } });
  }

  public async findByBaseProductIdAndExternalId(baseProductId: number, externalId: number): Promise<OfferBookTypeormEntity | null> {
    return this.repository.findOne({ where: { baseProductId, externalId } });
  }

  public async findActiveByBaseProductId(baseProductId: number): Promise<OfferBookTypeormEntity | null> {
    return this.repository.findOne({ where: { baseProductId, active: true } });
  }

  public async save(entity: OfferBookTypeormEntity): Promise<OfferBookTypeormEntity> {
    return this.repository.save(entity);
  }

  public async saveOrUpdate(entity: OfferBookTypeormEntity): Promise<OfferBookTypeormEntity> {
    const existing = await this.repository.findOne({
      where: { baseProductId: entity.baseProductId, externalId: entity.externalId }
    });

    if (existing) {
      entity.id = existing.id;
    }

    return this.repository.save(entity);
  }

  public async count(): Promise<number> {
    return this.repository.count();
  }

  public async deleteByBaseProductId(baseProductId: number): Promise<void> {
    await this.repository.delete({ baseProductId });
  }

  public async deleteAll(): Promise<void> {
    await this.repository.query('DELETE FROM "offer_book"');
  }

  /**
   * Bulk insert offer books in chunks. Skips the per-row findOne/save round trips that
   * `saveOrUpdate` performs, suitable when the table has just been wiped via deleteAll.
   */
  public async bulkInsert(entities: OfferBookTypeormEntity[]): Promise<void> {
    if (entities.length === 0) return;

    const chunkSize = 500;
    for (let i = 0; i < entities.length; i += chunkSize) {
      const chunk = entities.slice(i, i + chunkSize);
      await this.repository.insert(chunk);
    }
  }
}
