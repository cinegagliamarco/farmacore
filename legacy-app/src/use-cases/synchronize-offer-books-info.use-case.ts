import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SYNCHRONIZE_OFFER_BOOKS_INFO_USE_CASE } from '../common/import.events';
import { CadernoOfertaRepository } from '../database/integration-repositories/caderno-oferta.repository';
import { OfferBookInfoRepository } from '../database/repositories/offer-book-info.repository';

@Injectable()
export class SynchronizeOfferBooksInfoUseCase {
  private readonly BATCH_SIZE = 100;

  constructor(
    private readonly offerBookInfoRepository: OfferBookInfoRepository,
    private readonly cadernoOfertaRepository: CadernoOfertaRepository
  ) {}

  @OnEvent(SYNCHRONIZE_OFFER_BOOKS_INFO_USE_CASE)
  public async execute(): Promise<void> {
    console.log('Starting offer books info synchronization');

    try {
      let page = 0;
      let processedCount = 0;
      let hasMore = true;

      while (hasMore) {
        console.log(`Processing batch: page ${page}`);
        const [cadernoOfertas, total] = await this.cadernoOfertaRepository.findPaginated(page, this.BATCH_SIZE);

        if (cadernoOfertas.length === 0) {
          hasMore = false;
          continue;
        }

        const offerBookInfos = cadernoOfertas.map((cadernoOferta) => ({
          name: cadernoOferta.nome,
          active: cadernoOferta.status === 'A',
          externalId: cadernoOferta.id,
          expirationDate: cadernoOferta.datahorafinal
        }));

        await this.offerBookInfoRepository.upsertBatch(offerBookInfos);

        processedCount += cadernoOfertas.length;
        console.log(`Processed ${processedCount} of ${total} offer books info...`);

        if ((page + 1) * this.BATCH_SIZE >= total) {
          hasMore = false;
        } else {
          page++;
        }
      }

      console.log(`Offer books info synchronization completed. Total processed: ${processedCount}`);
    } catch (error) {
      console.error(`Error during offer books info synchronization: ${error.message}`);
      throw error;
    }
  }
}
