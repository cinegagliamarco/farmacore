import { Injectable } from '@nestjs/common';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { GetBaseProductStockMetricsQueryParamDto } from '../dto/get-base-product-stock-metrics-query-param.dto';

export interface BaseProductStockMetrics {
  total: number;
  stock: Record<string, number>;
  drogalStock: Record<string, number>;
  drogasilStock: Record<string, number>;
  michelassiStock: Record<string, number>;
}

@Injectable()
export class GetBaseProductStockMetricsUseCase {
  constructor(private readonly baseProductRepository: BaseProductRepository) {}

  public async execute(filters: GetBaseProductStockMetricsQueryParamDto): Promise<BaseProductStockMetrics> {
    return this.baseProductRepository.findAllStockMetrics(filters);
  }
}
