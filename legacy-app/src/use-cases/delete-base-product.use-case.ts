import { Injectable } from '@nestjs/common';
import { BaseProductRepository } from '../database/repositories/base-product.repository';

@Injectable()
export class DeleteBaseProductUseCase {
  constructor(private readonly baseProductRepository: BaseProductRepository) {}

  public async execute(id: number): Promise<void | never> {
    await this.baseProductRepository.deleteById(id);
  }
}
