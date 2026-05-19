import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OfferBookTypeormEntity } from '../database/entities/offer-book.entity';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { OfferBookRepository } from '../database/repositories/offer-book.repository';
import { A7PharmaApiService } from '../services/a7-pharma-api.service';

const DEFAULT_OFFER_BOOK_EXTERNAL_ID = 100006091838;
const DEFAULT_OFFER_BOOK_NAME = 'INTEGRACAO PRECOS';

@Injectable()
export class UpdateOfferPriceUseCase {
  constructor(
    private readonly baseProductRepository: BaseProductRepository,
    private readonly offerBookRepository: OfferBookRepository,
    private readonly a7PharmaApiService: A7PharmaApiService
  ) {}

  public async execute(id: number, priceForOffer: number): Promise<void> {
    const baseProduct = await this.baseProductRepository.findById(id);
    if (!baseProduct) throw new NotFoundException(`BaseProduct with id ${id} not found`);
    if (!baseProduct.externalId) throw new BadRequestException(`BaseProduct ${id} has no externalId`);

    const existingOfferBooks = await this.offerBookRepository.findByBaseProductId(baseProduct.id);
    const firstOfferBook = existingOfferBooks[0];

    const offerBookExternalId = firstOfferBook?.externalId ?? DEFAULT_OFFER_BOOK_EXTERNAL_ID;
    const offerBookName = firstOfferBook?.name ?? DEFAULT_OFFER_BOOK_NAME;

    const offerBook = firstOfferBook ?? new OfferBookTypeormEntity();
    offerBook.baseProductId = baseProduct.id;
    offerBook.externalId = offerBookExternalId;
    offerBook.name = offerBookName;
    offerBook.priceForOffer = priceForOffer;
    offerBook.active = true;

    await this.offerBookRepository.save(offerBook);

    await this.a7PharmaApiService.createOrUpdateOffers({
      idCadernoOferta: offerBookExternalId,
      items: [{ idEmbalagem: baseProduct.externalId, precoOferta: priceForOffer }]
    });
  }
}
