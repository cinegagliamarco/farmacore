import { Injectable, NotFoundException } from '@nestjs/common';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { UpdateGenericMissingActiveIngredientsBodyDto } from '../dto/update-generic-missing-active-ingredients-body.dto';

@Injectable()
export class UpdateGenericMissingActiveIngredientsUseCase {
  constructor(private readonly baseProductRepository: BaseProductRepository) {}

  public async execute(id: number, body: UpdateGenericMissingActiveIngredientsBodyDto): Promise<Record<string, unknown>> {
    const baseProduct = await this.baseProductRepository.findById(id);
    if (!baseProduct) throw new NotFoundException('Base product not found');

    baseProduct.activeIngredient = body.activeIngredient;
    await this.baseProductRepository.save(baseProduct);

    const updatedBaseProduct = await this.baseProductRepository.findById(id);
    return {
      id: updatedBaseProduct.id,
      ean: updatedBaseProduct.ean,
      name: updatedBaseProduct.name || '-',
      supplier: updatedBaseProduct.supplier || '-',
      mat: updatedBaseProduct.mat || 0,
      curve: updatedBaseProduct.curve || '-',
      updatedDate: updatedBaseProduct.updatedDate
    };
  }
}
