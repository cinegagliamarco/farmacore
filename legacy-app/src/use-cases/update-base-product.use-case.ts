import { Injectable, NotFoundException } from '@nestjs/common';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { UpdateBaseProductBodyDto } from '../dto/update-base-product-body.dto';
import { BaseProductTypeormEntity } from '../database/entities/base-product.entity';

function applyDefinedProperties<T extends object, U extends Partial<T>>(target: T, source: U): T {
  for (const key of Object.keys(source) as Array<keyof U>) {
    if (source[key] !== undefined) {
      (target as Record<keyof U, unknown>)[key] = source[key];
    }
  }
  return target;
}

@Injectable()
export class UpdateBaseProductUseCase {
  constructor(private readonly baseProductRepository: BaseProductRepository) {}

  public async execute(id: number, dto: UpdateBaseProductBodyDto): Promise<BaseProductTypeormEntity> {
    const baseProduct = await this.baseProductRepository.findById(id);
    if (!baseProduct) throw new NotFoundException(`BaseProduct with id ${id} not found`);

    applyDefinedProperties(baseProduct, dto);

    return this.baseProductRepository.save(baseProduct);
  }
}
