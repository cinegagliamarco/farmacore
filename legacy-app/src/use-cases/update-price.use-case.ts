import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { A7PharmaApiService } from '../services/a7-pharma-api.service';

@Injectable()
export class UpdateBaseProductPriceUseCase {
  constructor(
    private readonly baseProductRepository: BaseProductRepository,
    private readonly a7PharmaApiService: A7PharmaApiService
  ) {}

  public async execute(id: number, newPrice: number): Promise<void> {
    const baseProduct = await this.baseProductRepository.findById(id);
    if (!baseProduct) throw new NotFoundException(`BaseProduct with id ${id} not found`);
    if (!baseProduct.externalId) throw new BadRequestException(`BaseProduct ${id} has no externalId`);
    if (baseProduct.monitored) throw new BadRequestException(`BaseProduct ${id} is monitored and cannot have its price changed`);

    baseProduct.price = newPrice;
    await this.baseProductRepository.save(baseProduct);

    await this.a7PharmaApiService.changePrices({
      items: [{ idEmbalagem: baseProduct.externalId, precoVendaNovo: newPrice }]
    });
  }
}
