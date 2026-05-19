import { Injectable, NotFoundException } from '@nestjs/common';
import { OfferBookRulesRepository } from '../database/repositories/offer-book-rules.repository';
import { OfferBookRulesTypeormEntity } from '../database/entities/offer-book-rules.entity';

@Injectable()
export class GetOfferBookRulesUseCase {
  constructor(private readonly offerBookRulesRepository: OfferBookRulesRepository) {}

  public async execute(id: number): Promise<OfferBookRulesTypeormEntity> {
    const rules = await this.offerBookRulesRepository.findById(id);
    if (!rules) {
      throw new NotFoundException(`OfferBookRules with id ${id} not found`);
    }
    return rules;
  }
}
