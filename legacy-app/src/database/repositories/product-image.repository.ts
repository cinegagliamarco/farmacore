import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ProductImageTypeormEntity } from '../entities/product-image.entity';

@Injectable()
export class ProductImageRepository {
  constructor(private readonly repository: Repository<ProductImageTypeormEntity>) {}

  public findProductImagesByEan(ean: number): Promise<ProductImageTypeormEntity[]> {
    return this.repository
      .createQueryBuilder('productImage')
      .innerJoin('productImage.product', 'product')
      .addSelect('product.origin')
      .where('product.ean = :ean', { ean })
      .orderBy('product.origin', 'ASC')
      .take(10)
      .getMany();
  }
}
