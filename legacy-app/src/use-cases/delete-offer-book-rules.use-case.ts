import { Injectable, NotFoundException } from '@nestjs/common';
import { OfferBookRulesRepository } from '../database/repositories/offer-book-rules.repository';

@Injectable()
export class DeleteOfferBookRulesUseCase {
  constructor(private readonly offerBookRulesRepository: OfferBookRulesRepository) {}

  public async execute(id: number): Promise<void> {
    const existingRules = await this.offerBookRulesRepository.findById(id);
    if (!existingRules) {
      throw new NotFoundException(`OfferBookRules with id ${id} not found`);
    }

    await this.offerBookRulesRepository.delete(id);
  }
}
