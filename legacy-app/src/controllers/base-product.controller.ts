import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CsvHeaderInterceptor } from '../common/csv-header.interceptor';
import {
  GENERATE_BASE_PRODUCT_DESCRIPTION_USE_CASE,
  GENERATE_BASE_PRODUCT_IMAGES_USE_CASE,
  IMPORT_BASE_PRODUCTS_CSV_USE_CASE,
  SYNCHRONIZE_ACTIVE_INGREDIENTS_USE_CASE,
  SYNCHRONIZE_BASE_PRODUCT_METRICS_USE_CASE,
  SYNCHRONIZE_BASE_PRODUCT_STOCK_USE_CASE,
  SYNCHRONIZE_BASE_PRODUCT_USE_CASE,
  GENERATE_BASE_PRODUCT_PROPERTIES_USE_CASE
} from '../common/import.events';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { CreateOfferBodyDto } from '../dto/create-offer-body.dto';
import { GetBaseProductStockMetricsQueryParamDto } from '../dto/get-base-product-stock-metrics-query-param.dto';
import { GetBaseProductStockQueryParamDto } from '../dto/get-base-product-stock-query-param.dto';
import { GetBaseProductsQueryParamDto } from '../dto/get-base-products-query-param.dto';
import { GetCrossedProductsQueryParamDto } from '../dto/get-crossed-products-query-param.dto';
import { GetGenericMissingActiveIngredientsQueryParamDto } from '../dto/get-generic-missing-active-ingredients-query-param.dto';
import { GetProductsByActiveIngredientQueryParamDto } from '../dto/get-products-by-active-ingredient-query-param.dto';
import { GetStrategicPriceQueryParamDto } from '../dto/get-strategic-price-query-param.dto';
import { UpdateBaseProductBodyDto } from '../dto/update-base-product-body.dto';
import { UpdateGenericMissingActiveIngredientsBodyDto } from '../dto/update-generic-missing-active-ingredients-body.dto';
import { UpdatePriceBodyDto } from '../dto/update-price-body.dto';
import { BucketService } from '../services/bucket.service';
import { ImportManagerService } from '../services/import-manager.service';
import { GetActiveIngredientsUseCase } from '../use-cases/get-active-ingredients.use-case';
import { GetBaseProductStockMetricsUseCase } from '../use-cases/get-base-product-stock-metrics.use-case';
import { GetBaseProductStockUseCase } from '../use-cases/get-base-product-stock.use-case';
import { GetBaseProductsUseCase } from '../use-cases/get-base-products.use-case';
import { GetCrossedProductsUseCase } from '../use-cases/get-crossed-products.use-case';
import { GetGenericMissingActiveIngredientsUseCase } from '../use-cases/get-generic-missing-active-ingredients.use-case';
import { GetProductsByActiveIngredientUseCase } from '../use-cases/get-products-by-active-ingredient.use-case';
import { GetStrategicPriceUseCase } from '../use-cases/get-strategic-price.use-case';
import { RemoveOfferUseCase } from '../use-cases/remove-offer.use-case';
import { UpdateGenericMissingActiveIngredientsUseCase } from '../use-cases/update-generic-missing-active-ingredients.use-case';
import { UpdateBaseProductUseCase } from '../use-cases/update-base-product.use-case';
import { UpdateOfferPriceUseCase } from '../use-cases/update-price-for-offer.use-case';
import { UpdateBaseProductPriceUseCase } from '../use-cases/update-price.use-case';
import { BaseProductTypeormEntity } from '../database/entities/base-product.entity';
import { DeleteBaseProductUseCase } from '../use-cases/delete-base-product.use-case';
import { GenerateBaseProductDescriptionsByIdsUseCase } from '../use-cases/generate-base-product-descriptions-by-ids.use-case';
import { GenerateDescriptionsBodyDto } from '../dto/generate-descriptions-body.dto';
import { DailyRoutinesCron } from '../cron/daily-routines.cron';

@Controller('products/base')
export class BaseProductController {
  constructor(
    private readonly importManagerService: ImportManagerService,
    private readonly baseProductRepository: BaseProductRepository,
    private readonly bucketService: BucketService,
    private readonly getCrossedProductsUseCase: GetCrossedProductsUseCase,
    private readonly getStrategicPriceUseCase: GetStrategicPriceUseCase,
    private readonly updateOfferPriceUseCase: UpdateOfferPriceUseCase,
    private readonly removeOffersUseCase: RemoveOfferUseCase,
    private readonly changePricesUseCase: UpdateBaseProductPriceUseCase,
    private readonly getBaseProductStockUseCase: GetBaseProductStockUseCase,
    private readonly getBaseProductStockMetricsUseCase: GetBaseProductStockMetricsUseCase,
    private readonly getBaseProductsUseCase: GetBaseProductsUseCase,
    private readonly getActiveIngredientsUseCase: GetActiveIngredientsUseCase,
    private readonly getGenericMissingActiveIngredientsUseCase: GetGenericMissingActiveIngredientsUseCase,
    private readonly updateGenericMissingActiveIngredientsUseCase: UpdateGenericMissingActiveIngredientsUseCase,
    private readonly getProductsByActiveIngredientUseCase: GetProductsByActiveIngredientUseCase,
    private readonly updateBaseProductUseCase: UpdateBaseProductUseCase,
    private readonly deleteBaseProductUseCase: DeleteBaseProductUseCase,
    private readonly generateBaseProductDescriptionsByIdsUseCase: GenerateBaseProductDescriptionsByIdsUseCase,
    private readonly dailyRoutinesCron: DailyRoutinesCron
  ) {}

  @Get()
  public getBaseProducts(@Query() qp: GetBaseProductsQueryParamDto) {
    return this.getBaseProductsUseCase.execute(qp);
  }

  @Get('/crossed')
  public getCrossedProducts(@Query() qp: GetCrossedProductsQueryParamDto) {
    return this.getCrossedProductsUseCase.execute(qp);
  }

  @Get('/strategic-price')
  public getStrategicPrice(@Query() qp: GetStrategicPriceQueryParamDto) {
    return this.getStrategicPriceUseCase.execute(qp);
  }

  @Get('/stock')
  public getBaseProductStock(@Query() qp: GetBaseProductStockQueryParamDto) {
    return this.getBaseProductStockUseCase.execute(qp);
  }

  @Get('/stock-metrics')
  public getBaseProductStockMetrics(@Query() qp: GetBaseProductStockMetricsQueryParamDto) {
    return this.getBaseProductStockMetricsUseCase.execute(qp);
  }

  @Get('/active-ingredients')
  public getActiveIngredients() {
    return this.getActiveIngredientsUseCase.execute();
  }

  @Get('/generic-missing-active-ingredients')
  public getGenericMissingActiveIngredients(@Query() qp: GetGenericMissingActiveIngredientsQueryParamDto) {
    return this.getGenericMissingActiveIngredientsUseCase.execute(qp);
  }

  @Patch('/generic-missing-active-ingredients/:id')
  public updateGenericMissingActiveIngredients(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateGenericMissingActiveIngredientsBodyDto) {
    return this.updateGenericMissingActiveIngredientsUseCase.execute(id, body);
  }

  @Get('/active-ingredients/crossed')
  public getProductsByActiveIngredient(@Query() qp: GetProductsByActiveIngredientQueryParamDto) {
    return this.getProductsByActiveIngredientUseCase.execute(qp);
  }

  @Post('/import/csv')
  @UseInterceptors(FileInterceptor('file'), new CsvHeaderInterceptor([['EAN', 'Curva', 'Mat', 'Generico']]))
  public importCsv(@UploadedFile() file: Express.Multer.File) {
    return this.importManagerService.startProcess(IMPORT_BASE_PRODUCTS_CSV_USE_CASE, file.buffer.toString());
  }

  @Delete('/reset')
  public async resetAll() {
    this.bucketService.deleteAllImages().catch(console.error); // don't wait for this to finish
    await this.baseProductRepository.resetAll();
  }

  @Delete('/reset-images')
  public async resetBaseProductImages() {
    this.bucketService.deleteAllImages().catch(console.error); // don't wait for this to finish
    await this.baseProductRepository.resetBaseProductImages();
  }

  @Post('/generate-description')
  public generateDescription() {
    return this.importManagerService.startProcess(GENERATE_BASE_PRODUCT_DESCRIPTION_USE_CASE);
  }

  @Post('/generate-description/by-ids')
  public generateDescriptionByIds(@Body() body: GenerateDescriptionsBodyDto) {
    return this.generateBaseProductDescriptionsByIdsUseCase.execute(body.baseProductIds);
  }

  @Post('/generate-images')
  public generateImages() {
    return this.importManagerService.startProcess(GENERATE_BASE_PRODUCT_IMAGES_USE_CASE);
  }

  @Post('/generate-properties')
  public generateProperties() {
    return this.importManagerService.startProcess(GENERATE_BASE_PRODUCT_PROPERTIES_USE_CASE);
  }

  @Post('/synchronize')
  public synchronize() {
    return this.importManagerService.startProcess(SYNCHRONIZE_BASE_PRODUCT_USE_CASE);
  }

  @Post('/run-daily-pipeline')
  public runDailyPipeline(): void {
    this.dailyRoutinesCron.execute();
  }

  @Post('/synchronize-stock')
  public synchronizeStock() {
    return this.importManagerService.startProcess(SYNCHRONIZE_BASE_PRODUCT_STOCK_USE_CASE);
  }

  @Post('/synchronize-metrics')
  public synchronizeMetrics() {
    return this.importManagerService.startProcess(SYNCHRONIZE_BASE_PRODUCT_METRICS_USE_CASE);
  }

  @Post('/synchronize-active-ingredients')
  public synchronizeActiveIngredients() {
    return this.importManagerService.startProcess(SYNCHRONIZE_ACTIVE_INGREDIENTS_USE_CASE);
  }

  @Post('/offers/:id')
  public createOrUpdateOffers(@Param('id', ParseIntPipe) id: number, @Body() body: CreateOfferBodyDto): Promise<void> {
    return this.updateOfferPriceUseCase.execute(id, body.priceForOffer);
  }

  @Delete('/offers/:id')
  public removeOffers(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.removeOffersUseCase.execute(id);
  }

  @Post('/price/:id')
  public changePrices(@Param('id', ParseIntPipe) id: number, @Body() body: UpdatePriceBodyDto): Promise<void> {
    return this.changePricesUseCase.execute(id, body.newPrice);
  }

  @Get('/:id')
  public getBaseProductById(@Param('id', ParseIntPipe) id: number): Promise<BaseProductTypeormEntity> {
    return this.baseProductRepository.findById(id);
  }

  @Patch('/:id')
  public updateBaseProduct(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateBaseProductBodyDto): Promise<BaseProductTypeormEntity> {
    return this.updateBaseProductUseCase.execute(id, body);
  }

  @Delete('/:id')
  public delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.deleteBaseProductUseCase.execute(id);
  }
}
