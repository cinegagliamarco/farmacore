import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { OfferBookRepository } from '../database/repositories/offer-book.repository';
import { A7PharmaApiService } from '../services/a7-pharma-api.service';

@Injectable()
export class RemoveOfferUseCase {
  constructor(
    private readonly baseProductRepository: BaseProductRepository,
    private readonly offerBookRepository: OfferBookRepository,
    private readonly a7PharmaApiService: A7PharmaApiService
  ) {}

  public async execute(id: number): Promise<void> {
    const baseProduct = await this.baseProductRepository.findById(id);
    if (!baseProduct) throw new NotFoundException(`BaseProduct with id ${id} not found`);
        if (!baseProduct.externalId) throw new BadRequestException(`BaseProduct ${id} has no externalId`);

    const offerBooks = await this.offerBookRepository.findByBaseProductId(baseProduct.id);
    const offerBookWithPrice = offerBooks.find((ob) => !!ob.priceForOffer);

    if (!offerBookWithPrice) throw new NotFoundException(`No offer book with priceForOffer found for baseProductId ${id}`);

    await this.offerBookRepository.deleteByBaseProductId(baseProduct.id);

    await this.a7PharmaApiService.createOrUpdateOffers({
      idCadernoOferta: offerBookWithPrice.externalId,
      items: [{ idEmbalagem: baseProduct.externalId, precoOferta: null }]
    });
  }
}

