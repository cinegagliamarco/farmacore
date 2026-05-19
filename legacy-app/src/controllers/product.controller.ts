import { Controller, DefaultValuePipe, Get, Param, ParseBoolPipe, ParseIntPipe, Post, Query, Res, ValidationPipe } from '@nestjs/common';
import { Response } from 'express';
import {
  IMPORT_DROGAL_STOCK_USE_CASE,
  IMPORT_DROGASIL_STOCK_USE_CASE,
  IMPORT_PRODUCTS_DROGAL_USE_CASE,
  IMPORT_PRODUCTS_DROGASIL_USE_CASE
} from '../common/import.events';
import { ImportManagerService } from '../services/import-manager.service';
import { ExportProductsUseCase } from '../use-cases/export-products.use-case';
import { GetSingleProductUseCase } from '../use-cases/get-single-product.use-case';
import { ExportProductsQueryParamDto } from '../dto/export-products-query-param.dto';

@Controller('products')
export class ProductController {
  constructor(
    private readonly exportProductsUseCase: ExportProductsUseCase,
    private readonly importManagerService: ImportManagerService,
    private readonly getSingleProductUseCase: GetSingleProductUseCase
  ) {}

  @Post('/import/drogasil')
  public importDrogasil(@Query('force', new DefaultValuePipe(false), ParseBoolPipe) force: boolean) {
    return this.importManagerService.startProcess(IMPORT_PRODUCTS_DROGASIL_USE_CASE, { force });
  }

  @Post('/import/drogal')
  public importDrogal(@Query('force', new DefaultValuePipe(false), ParseBoolPipe) force: boolean) {
    return this.importManagerService.startProcess(IMPORT_PRODUCTS_DROGAL_USE_CASE, { force });
  }

  @Post('/import/drogal/stock')
  public importDrogalStock() {
    return this.importManagerService.startProcess(IMPORT_DROGAL_STOCK_USE_CASE);
  }

  @Post('/import/drogasil/stock')
  public importDrogasilStock() {
    return this.importManagerService.startProcess(IMPORT_DROGASIL_STOCK_USE_CASE);
  }

  @Get('/details/:ean')
  public getByEan(
    @Param('ean', ParseIntPipe) ean: number,
    @Query('withDescription', new DefaultValuePipe(false), ParseBoolPipe) withDescription: boolean,
    @Query('withImages', new DefaultValuePipe(false), ParseBoolPipe) withImages: boolean
  ) {
    return this.getSingleProductUseCase.execute(ean, withDescription, withImages);
  }

  @Get('/export')
  public async export(@Res() response: Response, @Query(new ValidationPipe({ transform: true })) query: ExportProductsQueryParamDto) {
    const csvContent = await this.exportProductsUseCase.execute(query.columns);
    if (!csvContent) return response.send();

    // Set response headers for CSV download
    response.setHeader('Content-Type', 'text/csv');
    response.setHeader('Content-Disposition', 'attachment; filename="combined-products.csv"');
    return response.send(csvContent);
  }
}
