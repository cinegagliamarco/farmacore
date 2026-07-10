import { DynamicModule, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';
import { ScrapersModule } from '../scrapers/scrapers.module';
import { StorageModule } from '../storage/storage.module';

import { PipelineJoinService } from './pipeline-join.service';
import { AdminPipelineService } from './admin-pipeline.service';
import { DailyPipelineCron } from './daily-pipeline.cron';

import { SyncBaseProductStep } from './steps/sync-base-product.step';
import { SyncBaseProductStockStep } from './steps/sync-base-product-stock.step';
import { SyncOfferBooksInfoStep } from './steps/sync-offer-books-info.step';
import { ImportCompetitorProductsStep } from './steps/import-competitor-products.step';
import { CalcBaseProductMetricsStep } from './steps/calc-base-product-metrics.step';
import { UpdateBaseProductPropertiesStep } from './steps/update-base-product-properties.step';
import { ApplyPriceStep } from './steps/apply-price.step';
import { ExecuteOfferBookRuleStep } from './steps/execute-offer-book-rule.step';
import { SyncStoresStep } from './steps/sync-stores.step';
import { SyncProductItemsStep } from './steps/sync-product-items.step';
import { CatalogMutationService } from '../tenant-api/catalog/catalog-mutation.service';

import { PipelineStartConsumer } from './consumers/pipeline-start.consumer';
import { ApplyPriceDispatchConsumer } from './consumers/apply-price.dispatch.consumer';
import { ApplyPriceBatchConsumer } from './consumers/apply-price.batch.consumer';
import { SyncBaseProductDispatchConsumer } from './consumers/sync-base-product.dispatch.consumer';
import { SyncBaseProductBatchConsumer } from './consumers/sync-base-product.batch.consumer';
import { SyncBaseProductStockDispatchConsumer } from './consumers/sync-base-product-stock.dispatch.consumer';
import { SyncBaseProductStockBatchConsumer } from './consumers/sync-base-product-stock.batch.consumer';
import { SyncOfferBooksInfoConsumer } from './consumers/sync-offer-books-info.consumer';
import { ImportCompetitorProductsDispatchConsumer } from './consumers/import-competitor-products.dispatch.consumer';
import {
  ImportCompetitorProductsDrogalConsumer,
  ImportCompetitorProductsDrogasilConsumer,
  ImportCompetitorProductsMichelassiConsumer,
  ImportCompetitorProductsPagueMenosConsumer,
  ImportCompetitorProductsIkesakiConsumer,
  ImportCompetitorProductsPachecoConsumer,
  ImportCompetitorProductsSaoPauloConsumer,
  ImportCompetitorProductsVenancioConsumer,
  ImportCompetitorProductsIndianaConsumer,
} from './consumers/import-competitor-products.batch.consumers';
import { CalcBaseProductMetricsDispatchConsumer } from './consumers/calc-base-product-metrics.dispatch.consumer';
import { CalcBaseProductMetricsBatchConsumer } from './consumers/calc-base-product-metrics.batch.consumer';
import { UpdateBaseProductPropertiesDispatchConsumer } from './consumers/update-base-product-properties.dispatch.consumer';
import { UpdateBaseProductPropertiesBatchConsumer } from './consumers/update-base-product-properties.batch.consumer';
import { ExecuteOfferBookRuleConsumer } from './consumers/execute-offer-book-rule.consumer';
import { MigrateTenantConsumer } from './consumers/migrate-tenant.consumer';
import { SyncStoresConsumer } from './consumers/sync-stores.consumer';
import { SyncProductItemsDispatchConsumer } from './consumers/sync-product-items.dispatch.consumer';
import { SyncProductItemsBatchConsumer } from './consumers/sync-product-items.batch.consumer';
import { BaseProductProjector } from './base-product.projector';

const STEPS = [
  SyncBaseProductStep,
  SyncBaseProductStockStep,
  SyncOfferBooksInfoStep,
  ImportCompetitorProductsStep,
  CalcBaseProductMetricsStep,
  UpdateBaseProductPropertiesStep,
  BaseProductProjector,
  // apply em massa reusa o write-back por-EAN do ERP (deps globais).
  ApplyPriceStep,
  CatalogMutationService,
  // execução de regra de oferta: push em lote à A7 dirigido pelo ledger.
  ExecuteOfferBookRuleStep,
  SyncStoresStep,
  SyncProductItemsStep,
];

const CONSUMERS = [
  PipelineStartConsumer,
  SyncBaseProductDispatchConsumer,
  SyncBaseProductBatchConsumer,
  SyncBaseProductStockDispatchConsumer,
  SyncBaseProductStockBatchConsumer,
  SyncOfferBooksInfoConsumer,
  ImportCompetitorProductsDispatchConsumer,
  ImportCompetitorProductsDrogalConsumer,
  ImportCompetitorProductsDrogasilConsumer,
  ImportCompetitorProductsMichelassiConsumer,
  ImportCompetitorProductsPagueMenosConsumer,
  ImportCompetitorProductsIkesakiConsumer,
  ImportCompetitorProductsPachecoConsumer,
  ImportCompetitorProductsSaoPauloConsumer,
  ImportCompetitorProductsVenancioConsumer,
  ImportCompetitorProductsIndianaConsumer,
  CalcBaseProductMetricsDispatchConsumer,
  CalcBaseProductMetricsBatchConsumer,
  UpdateBaseProductPropertiesDispatchConsumer,
  UpdateBaseProductPropertiesBatchConsumer,
  MigrateTenantConsumer,
  ApplyPriceDispatchConsumer,
  ApplyPriceBatchConsumer,
  ExecuteOfferBookRuleConsumer,
  SyncStoresConsumer,
  SyncProductItemsDispatchConsumer,
  SyncProductItemsBatchConsumer,
];

@Module({})
export class PipelineStepsModule {
  public static forRoot(options: { withConsumers: boolean }): DynamicModule {
    return {
      module: PipelineStepsModule,
      imports: [
        ScheduleModule.forRoot(),
        TypeOrmModule.forFeature([PipelineRunEntity]),
        ScrapersModule,
        StorageModule,
      ],
      providers: [
        PipelineJoinService,
        AdminPipelineService,
        DailyPipelineCron,
        ...STEPS,
        ...(options.withConsumers ? CONSUMERS : []),
      ],
      exports: [AdminPipelineService, PipelineJoinService],
    };
  }
}
