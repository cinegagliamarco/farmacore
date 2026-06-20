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

import { PipelineStartConsumer } from './consumers/pipeline-start.consumer';
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
import { MigrateTenantConsumer } from './consumers/migrate-tenant.consumer';
import { BaseProductProjector } from './base-product.projector';

const STEPS = [
  SyncBaseProductStep,
  SyncBaseProductStockStep,
  SyncOfferBooksInfoStep,
  ImportCompetitorProductsStep,
  CalcBaseProductMetricsStep,
  UpdateBaseProductPropertiesStep,
  BaseProductProjector,
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
