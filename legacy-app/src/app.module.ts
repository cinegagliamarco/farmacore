import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './controllers/app.controller';
import { BaseProductController } from './controllers/base-product.controller';
import { ClassificationController } from './controllers/classification.controller';
import { ImportProcessController } from './controllers/import-process.controller';
import { OfferBookController } from './controllers/offer-book.controller';
import { OfferBookRulesController } from './controllers/offer-book-rules.controller';
import { ProductController } from './controllers/product.controller';
import { SchedulingController } from './controllers/scheduling.controller';
import { ConfigurationsController } from './controllers/configurations.controller';
import { StatusSettingsController } from './controllers/status-settings.controller';
import { DailyRoutinesCron } from './cron/daily-routines.cron';
import { PeriodicRoutinesCron } from './cron/periodic-routines.cron';
import { TypeormDatabaseModule } from './database/typeorm.database.module';
import { A7PharmaApiService } from './services/a7-pharma-api.service';
import { BucketService } from './services/bucket.service';
import { DrogalService } from './services/drogal.service';
import { DrogasilService } from './services/drogasil.service';
import { IkesakiService } from './services/ikesaki.service';
import { ImportManagerService } from './services/import-manager.service';
import { MichelassiService } from './services/michelassi.service';
import { OfferBookRulesService } from './services/offer-book-rules.service';
import { OpenAIService } from './services/openai.service';
import { PagueMenosService } from './services/pague-menos.service';
import { ExportProductsUseCase } from './use-cases/export-products.use-case';
import { GenerateBaseProductDescriptionUseCase } from './use-cases/generate-base-product-description.use-case';
import { GenerateBaseProductImagesUseCase } from './use-cases/generate-base-product-images.use-case';
import { GetActiveIngredientsUseCase } from './use-cases/get-active-ingredients.use-case';
import { GetBaseProductStockMetricsUseCase } from './use-cases/get-base-product-stock-metrics.use-case';
import { GetBaseProductStockUseCase } from './use-cases/get-base-product-stock.use-case';
import { GetBaseProductsUseCase } from './use-cases/get-base-products.use-case';
import { GetCrossedProductsUseCase } from './use-cases/get-crossed-products.use-case';
import { GetGenericMissingActiveIngredientsUseCase } from './use-cases/get-generic-missing-active-ingredients.use-case';
import { GetOfferBooksInfoUseCase } from './use-cases/get-offer-books-info.use-case';
import { GetProductsByActiveIngredientUseCase } from './use-cases/get-products-by-active-ingredient.use-case';
import { GetSingleProductUseCase } from './use-cases/get-single-product.use-case';
import { GetStrategicPriceUseCase } from './use-cases/get-strategic-price.use-case';
import { ImportBaseProductsCsvUseCase } from './use-cases/import-base-products-csv.use-case';
import { ImportCompetitorProductsUseCase } from './use-cases/import-competitor-products.use-case';
import { ImportCompetitorStockUseCase } from './use-cases/import-competitor-stock.use-case';
import { RemoveOfferUseCase } from './use-cases/remove-offer.use-case';
import { SynchronizeActiveIngredientUseCase } from './use-cases/synchronize-active-ingredient.use-case';
import { SynchronizeBaseProductMetricsUseCase } from './use-cases/synchronize-base-product-metrics.use-case';
import { SynchronizeBaseProductStockUseCase } from './use-cases/synchronize-base-product-stock.use-case';
import { SynchronizeBaseProductUseCase } from './use-cases/synchronize-base-product.use-case';
import { SynchronizeOfferBooksInfoUseCase } from './use-cases/synchronize-offer-books-info.use-case';
import { GenerateBaseProductPropertiesUseCase } from './use-cases/generate-base-product-properties.use-case';
import { UpdateGenericMissingActiveIngredientsUseCase } from './use-cases/update-generic-missing-active-ingredients.use-case';
import { UpdateOfferPriceUseCase } from './use-cases/update-price-for-offer.use-case';
import { UpdateBaseProductPriceUseCase } from './use-cases/update-price.use-case';
import { UpdateBaseProductUseCase } from './use-cases/update-base-product.use-case';
import { CreateOfferBookRulesUseCase } from './use-cases/create-offer-book-rules.use-case';
import { DeleteOfferBookRulesUseCase } from './use-cases/delete-offer-book-rules.use-case';
import { ExecuteOfferBookRulesUseCase } from './use-cases/execute-offer-book-rules.use-case';
import { GetOfferBookRulesUseCase } from './use-cases/get-offer-book-rules.use-case';
import { ListOfferBookRulesUseCase } from './use-cases/list-offer-book-rules.use-case';
import { PreviewOfferBookRulesUseCase } from './use-cases/preview-offer-book-rules.use-case';
import { PreviewSavedOfferBookRulesUseCase } from './use-cases/preview-saved-offer-book-rules.use-case';
import { UpdateOfferBookRulesUseCase } from './use-cases/update-offer-book-rules.use-case';
import { DeleteBaseProductUseCase } from './use-cases/delete-base-product.use-case';
import { GenerateBaseProductDescriptionsByIdsUseCase } from './use-cases/generate-base-product-descriptions-by-ids.use-case';
import { UpdateActiveIngredientMatUseCase } from './use-cases/update-active-ingredient-mat.use-case';
import { ListExecutionReportsUseCase } from './use-cases/list-execution-reports.use-case';
import { GetExecutionReportUseCase } from './use-cases/get-execution-report.use-case';
import { ListExecutionReportsByRulesUseCase } from './use-cases/list-execution-reports-by-rules.use-case';
import { GetClassificationsUseCase } from './use-cases/get-classifications.use-case';
import { GetClassificationsGroupedUseCase } from './use-cases/get-classifications-grouped.use-case';
import { DownloadPreviewOfferBookRulesUseCase } from './use-cases/download-preview-offer-book-rules.use-case';
import { DownloadPreviewSavedOfferBookRulesUseCase } from './use-cases/download-preview-saved-offer-book-rules.use-case';
import { CsvGeneratorService } from './services/csv-generator.service';
import { CreatePriceRoundingRuleUseCase } from './use-cases/create-price-rounding-rule.use-case';
import { GetPriceRoundingRuleUseCase } from './use-cases/get-price-rounding-rule.use-case';
import { ListPriceRoundingRulesUseCase } from './use-cases/list-price-rounding-rules.use-case';
import { UpdatePriceRoundingRuleUseCase } from './use-cases/update-price-rounding-rule.use-case';
import { DeletePriceRoundingRuleUseCase } from './use-cases/delete-price-rounding-rule.use-case';
import { GetStatusSettingsUseCase } from './use-cases/get-status-settings.use-case';
import { UpdateStatusSettingsUseCase } from './use-cases/update-status-settings.use-case';
import { GetOfferBookRuleProductsUseCase } from './use-cases/get-offer-book-rule-products.use-case';

@Module({
  imports: [
    HttpModule,
    TypeormDatabaseModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env'
    }),
    EventEmitterModule.forRoot({
      verboseMemoryLeak: true
    }),
    ScheduleModule.forRoot()
  ],
  controllers: [
    AppController,
    BaseProductController,
    ClassificationController,
    ProductController,
    ImportProcessController,
    OfferBookController,
    OfferBookRulesController,
    SchedulingController,
    ConfigurationsController,
    StatusSettingsController
  ],
  providers: [
    ImportBaseProductsCsvUseCase,
    ImportCompetitorProductsUseCase,
    ImportCompetitorStockUseCase,
    ExportProductsUseCase,
    GetSingleProductUseCase,
    GenerateBaseProductDescriptionUseCase,
    GenerateBaseProductImagesUseCase,
    SynchronizeBaseProductUseCase,
    SynchronizeBaseProductStockUseCase,
    SynchronizeOfferBooksInfoUseCase,
    GetCrossedProductsUseCase,
    SynchronizeBaseProductMetricsUseCase,
    GetStrategicPriceUseCase,
    UpdateOfferPriceUseCase,
    RemoveOfferUseCase,
    UpdateBaseProductPriceUseCase,
    ImportManagerService,
    DrogasilService,
    DrogalService,
    OpenAIService,
    BucketService,
    PagueMenosService,
    IkesakiService,
    MichelassiService,
    OfferBookRulesService,
    A7PharmaApiService,
    DailyRoutinesCron,
    PeriodicRoutinesCron,
    UpdateActiveIngredientMatUseCase,
    GetBaseProductStockUseCase,
    GetBaseProductStockMetricsUseCase,
    GetBaseProductsUseCase,
    GetActiveIngredientsUseCase,
    SynchronizeActiveIngredientUseCase,
    GetGenericMissingActiveIngredientsUseCase,
    UpdateGenericMissingActiveIngredientsUseCase,
    GetProductsByActiveIngredientUseCase,
    GenerateBaseProductPropertiesUseCase,
    GetOfferBooksInfoUseCase,
    UpdateBaseProductUseCase,
    CreateOfferBookRulesUseCase,
    DeleteOfferBookRulesUseCase,
    ExecuteOfferBookRulesUseCase,
    GetOfferBookRulesUseCase,
    ListOfferBookRulesUseCase,
    PreviewOfferBookRulesUseCase,
    PreviewSavedOfferBookRulesUseCase,
    UpdateOfferBookRulesUseCase,
    DeleteBaseProductUseCase,
    DeleteOfferBookRulesUseCase,
    DeleteBaseProductUseCase,
    GenerateBaseProductDescriptionsByIdsUseCase,
    ListExecutionReportsUseCase,
    GetExecutionReportUseCase,
    ListExecutionReportsByRulesUseCase,
    GetClassificationsUseCase,
    GetClassificationsGroupedUseCase,
    DownloadPreviewOfferBookRulesUseCase,
    DownloadPreviewSavedOfferBookRulesUseCase,
    GetOfferBookRuleProductsUseCase,
    CsvGeneratorService,
    CreatePriceRoundingRuleUseCase,
    GetPriceRoundingRuleUseCase,
    ListPriceRoundingRulesUseCase,
    UpdatePriceRoundingRuleUseCase,
    DeletePriceRoundingRuleUseCase,
    GetStatusSettingsUseCase,
    UpdateStatusSettingsUseCase
  ]
})
export class AppModule {}
