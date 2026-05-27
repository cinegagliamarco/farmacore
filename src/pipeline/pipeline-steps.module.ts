import { DynamicModule, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';

import { PipelineJoinService } from './pipeline-join.service';
import { AdminPipelineService } from './admin-pipeline.service';
import { DailyPipelineCron } from './daily-pipeline.cron';

import { SyncBaseProductStep } from './steps/sync-base-product.step';
import { SyncBaseProductStockStep } from './steps/sync-base-product-stock.step';
import { SyncOfferBooksInfoStep } from './steps/sync-offer-books-info.step';
import { ImportCompetitorProductsStep } from './steps/import-competitor-products.step';
import { ImportCompetitorStockStep } from './steps/import-competitor-stock.step';
import { CalcBaseProductMetricsStep } from './steps/calc-base-product-metrics.step';
import { UpdateBaseProductPropertiesStep } from './steps/update-base-product-properties.step';
import { UpdateActiveIngredientMatStep } from './steps/update-active-ingredient-mat.step';

import { PipelineStartConsumer } from './consumers/pipeline-start.consumer';
import { SyncBaseProductDispatchConsumer } from './consumers/sync-base-product.dispatch.consumer';
import { SyncBaseProductBatchConsumer } from './consumers/sync-base-product.batch.consumer';
import { SyncBaseProductStockDispatchConsumer } from './consumers/sync-base-product-stock.dispatch.consumer';
import { SyncBaseProductStockBatchConsumer } from './consumers/sync-base-product-stock.batch.consumer';
import { SyncOfferBooksInfoConsumer } from './consumers/sync-offer-books-info.consumer';
import { ImportCompetitorProductsConsumer } from './consumers/import-competitor-products.consumer';
import { ImportCompetitorStockConsumer } from './consumers/import-competitor-stock.consumer';
import { CalcBaseProductMetricsConsumer } from './consumers/calc-base-product-metrics.consumer';
import { UpdateBaseProductPropertiesConsumer } from './consumers/update-base-product-properties.consumer';
import { UpdateActiveIngredientMatConsumer } from './consumers/update-active-ingredient-mat.consumer';
import { MigrateTenantConsumer } from './consumers/migrate-tenant.consumer';

const STEPS = [
  SyncBaseProductStep,
  SyncBaseProductStockStep,
  SyncOfferBooksInfoStep,
  ImportCompetitorProductsStep,
  ImportCompetitorStockStep,
  CalcBaseProductMetricsStep,
  UpdateBaseProductPropertiesStep,
  UpdateActiveIngredientMatStep,
];

const CONSUMERS = [
  PipelineStartConsumer,
  SyncBaseProductDispatchConsumer,
  SyncBaseProductBatchConsumer,
  SyncBaseProductStockDispatchConsumer,
  SyncBaseProductStockBatchConsumer,
  SyncOfferBooksInfoConsumer,
  ImportCompetitorProductsConsumer,
  ImportCompetitorStockConsumer,
  CalcBaseProductMetricsConsumer,
  UpdateBaseProductPropertiesConsumer,
  UpdateActiveIngredientMatConsumer,
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
