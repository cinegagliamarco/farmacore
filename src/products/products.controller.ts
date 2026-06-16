import { BadRequestException, Controller, Param, Post } from '@nestjs/common';
import { ProductDetailsView, ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /**
   * Live-scrape every competitor origin for one EAN, persist into
   * shared_catalog, and return the merged cross-origin view. JWT-guarded
   * (global guard); not tenant-scoped — the shared catalog is global.
   */
  @Post(':ean/import')
  public import(@Param('ean') ean: string): Promise<ProductDetailsView> {
    if (!/^\d+$/.test(ean)) {
      throw new BadRequestException('ean must be numeric');
    }
    return this.products.importProduct(ean);
  }
}
