import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SYNCHRONIZE_BASE_PRODUCT_STOCK_USE_CASE } from '../common/import.events';
import { EmbalagemRepository } from '../database/integration-repositories/embalagem.repository';
import { EstoqueRepository } from '../database/integration-repositories/estoque.repository';
import { BaseProductStockRepository } from '../database/repositories/base-product-stock.repository';
import { BaseProductRepository } from '../database/repositories/base-product.repository';

@Injectable()
export class SynchronizeBaseProductStockUseCase {
  private BATCH_SIZE = 1000;

  constructor(
    private readonly embalagemRepository: EmbalagemRepository,
    private readonly estoqueRepository: EstoqueRepository,
    private readonly baseProductRepository: BaseProductRepository,
    private readonly baseProductStockRepository: BaseProductStockRepository
  ) {}

  @OnEvent(SYNCHRONIZE_BASE_PRODUCT_STOCK_USE_CASE)
  public async execute(): Promise<void> {
    console.log('Starting stock synchronization from estoque table');

    try {
      const totalEmbalagens = await this.embalagemRepository.countValid();
      console.log(`Total embalagem records to process for stocks: ${totalEmbalagens}`);

      let processedCount = 0;
      let skippedCount = 0;
      let offset = 0;

      // Process embalagem in batches
      while (offset < totalEmbalagens) {
        console.log(`Fetching embalagem batch for stocks: ${offset} to ${offset + this.BATCH_SIZE}`);

        const embalagemRecords = await this.embalagemRepository.findAllValidWithPagination(offset, this.BATCH_SIZE);

        // Fetch stocks for this batch of embalagens
        const embalagemIds = embalagemRecords.map((e) => Number(e.id));
        const estoqueRecords = await this.estoqueRepository.findByEmbalagemIds(embalagemIds);

        // Group stocks by embalagemId -> subsidiaryId -> quantity
        const stockMap: Record<string, Record<string, number>> = {};
        for (const record of estoqueRecords) {
          const embalagemId = String(record.embalagemid);
          const subsidiaryId = String(record.unidadenegocioid);

          stockMap[embalagemId] ??= {};
          stockMap[embalagemId][subsidiaryId] ??= 0;
          stockMap[embalagemId][subsidiaryId] += Number(record.estoque);
        }

        // Process each embalagem in this batch
        for (const embalagem of embalagemRecords) {
          try {
            const ean = this.parseEan(embalagem.codigobarras);

            if (!ean) {
              skippedCount++;
              continue;
            }

            const baseProduct = await this.baseProductRepository.findOne(ean);

            if (!baseProduct) {
              console.error(`Base product not found for EAN: ${ean}`);
              skippedCount++;
              continue;
            }

            // Delete existing stock for this product (to keep it up to date)
            await this.baseProductStockRepository.deleteByBaseProductId(baseProduct.id);

            const stockBySubsidiary = stockMap[String(embalagem.id)];
            if (!stockBySubsidiary) continue;

            for (const [subsidiaryId, quantity] of Object.entries(stockBySubsidiary)) {
              if (quantity > 0) {
                await this.baseProductStockRepository.upsert(baseProduct.id, Math.floor(quantity), Number(subsidiaryId));
              }
            }

            processedCount++;
          } catch (error) {
            console.error(`Error processing stock for embalagem ${embalagem.id}: ${error.message}`);
          }
        }

        console.log(`Processed ${processedCount} stock records...`);
        offset += this.BATCH_SIZE;
      }

      console.log(`Stock synchronization completed. Processed: ${processedCount}, Skipped: ${skippedCount}`);
    } catch (error) {
      console.error(`Error during stock synchronization: ${error.message}`);
      throw error;
    }
  }

  private parseEan(codigobarras: string): number | null {
    if (!codigobarras) return null;

    // Remove non-numeric characters and pad with zeros if needed
    const cleaned = codigobarras.replace(/\D/g, '');

    if (!cleaned.length || cleaned.length > 14) return null;

    // Pad with zeros to make it 13 digits (standard EAN-13)
    const padded = cleaned.padStart(13, '0');
    const ean = parseInt(padded, 10);

    return isNaN(ean) ? null : ean;
  }
}
