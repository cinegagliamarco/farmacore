import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AVAILABLE_ORIGINS } from '../common/constants/available-origins.constant';
import { ExecutionType } from '../common/execution-type.enum';
import { OfferBookRulesStatus } from '../common/offer-book-rules-status.enum';
import { Origin } from '../common/origin.enum';
import { SchedulingAction } from '../common/scheduling-action.enum';
import { requestRestartSimple } from '../common/graceful-shutdown.listener';
import { wait } from '../common/wait-for.helper';
import { SchedulingTypeormEntity } from '../database/entities/scheduling.entity';
import { ImportProcessRepository } from '../database/repositories/import-process.repository';
import { OfferBookRulesRepository } from '../database/repositories/offer-book-rules.repository';
import { ProductRepository } from '../database/repositories/product.repository';
import { SchedulingRepository } from '../database/repositories/scheduling.repository';
import { DrogalService } from '../services/drogal.service';
import { DrogasilService } from '../services/drogasil.service';
import { IkesakiService } from '../services/ikesaki.service';
import { MichelassiService } from '../services/michelassi.service';
import { PagueMenosService } from '../services/pague-menos.service';
import { ExecuteOfferBookRulesUseCase } from '../use-cases/execute-offer-book-rules.use-case';
import { UpdateBaseProductPriceUseCase } from '../use-cases/update-price.use-case';
import { UpdateOfferPriceUseCase } from '../use-cases/update-price-for-offer.use-case';

/**
 * Interval-driven jobs that run throughout the day on a repeating schedule.
 *
 * ┌──────────────────┬─────────────────────────────────────────────────────────────────┐
 * │ Interval         │ Handler                                                         │
 * ├──────────────────┼─────────────────────────────────────────────────────────────────┤
 * │ every 1 min      │ executeSchedulings — DB-driven price / offer-price updates      │
 * │ every 5 min      │ updateProductsWithErrorsOrOutdated — re-import failed products  │
 * │ every 5 min      │ updateStockWithErrorsOrOutdated — re-import failed stocks       │
 * │ every 12 h       │ restartApplication — graceful restart (skipped during imports)  │
 * │ hourly 07–21     │ executeScheduledOfferBookRules — daily offer-book rule runs     │
 * └──────────────────┴─────────────────────────────────────────────────────────────────┘
 */
@Injectable()
export class PeriodicRoutinesCron {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly drogalService: DrogalService,
    private readonly drogasilService: DrogasilService,
    private readonly pagueMenosService: PagueMenosService,
    private readonly ikesakiService: IkesakiService,
    private readonly michelassiService: MichelassiService,
    private readonly importProcessRepository: ImportProcessRepository,
    private readonly schedulingRepository: SchedulingRepository,
    private readonly updateBaseProductPriceUseCase: UpdateBaseProductPriceUseCase,
    private readonly updateOfferPriceUseCase: UpdateOfferPriceUseCase,
    private readonly offerBookRulesRepository: OfferBookRulesRepository,
    private readonly executeOfferBookRulesUseCase: ExecuteOfferBookRulesUseCase
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  public async executeSchedulings(): Promise<void> {
    const pendingSchedulings = await this.schedulingRepository.findPendingSchedulings(new Date());
    if (!pendingSchedulings.length) return;

    console.log(`Pending schedulings: ${pendingSchedulings.length}`);
    for (const scheduling of pendingSchedulings) {
      await this.executeScheduling(scheduling);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  public async updateProductsWithErrorsOrOutdated(): Promise<void> {
    for (const element of AVAILABLE_ORIGINS) {
      const [products] = await this.productRepository.findProductsWithErrorsOrOutdated(element);
      for (const product of products) {
        const service = this.serviceMapper(product.origin);
        await service.importProduct(product.ean);
        await wait(200);
      }
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  public async updateStockWithErrorsOrOutdated(): Promise<void> {
    for (const element of [Origin.DROGAL, Origin.DROGASIL]) {
      const [products] = await this.productRepository.findProductsWithStockErrorsOrOutdated(element);
      for (const product of products) {
        const service = this.serviceMapper(product.origin) as DrogalService | DrogasilService;
        await service.fetchProductsStock([product]);
      }
    }
  }

  @Cron(CronExpression.EVERY_12_HOURS)
  public async restartApplication(): Promise<void> {
    if (await this.importProcessRepository.findRunningProcess()) {
      console.log('Import running; skip scheduled restart');
      return;
    }
    console.log('Scheduled 12h restart');
    requestRestartSimple('Scheduled 12-hour restart');
  }

  /** Runs hourly from 07:00–21:00 — well after the daily pipeline starts at midnight. */
  @Cron('0 7-21 * * *')
  public async executeScheduledOfferBookRules(): Promise<void> {
    console.log('executeScheduledOfferBookRules check');
    try {
      const now = new Date();
      const today = now.getDay();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

      const scheduledRules = await this.offerBookRulesRepository.findScheduledForDay(today);
      if (scheduledRules.length === 0) {
        console.log(`No offer book rules for weekday ${today}`);
        return;
      }

      const rulesToExecute = scheduledRules.filter((rule) => {
        if (rule.status === OfferBookRulesStatus.RUNNING) {
          console.log(`Rule ${rule.id} running, skip`);
          return false;
        }
        if (!rule.lastScheduledExecution) return true;
        return new Date(rule.lastScheduledExecution) < todayStart;
      });

      if (rulesToExecute.length === 0) {
        console.log('All scheduled rules already ran today');
        return;
      }

      for (const rule of rulesToExecute) {
        try {
          const result = await this.executeOfferBookRulesUseCase.execute(rule.id, ExecutionType.SCHEDULED);
          if (result) {
            rule.lastScheduledExecution = new Date();
            await this.offerBookRulesRepository.save(rule);
          }
        } catch (error) {
          console.error(`Rule ${rule.id} failed`, error);
        }
      }
    } catch (error) {
      console.error('executeScheduledOfferBookRules error', error);
    }
  }

  private async executeScheduling(scheduling: SchedulingTypeormEntity): Promise<void> {
    try {
      const value = parseFloat(scheduling.value);
      switch (scheduling.action) {
        case SchedulingAction.UPDATE_PRICE:
          await this.updateBaseProductPriceUseCase.execute(scheduling.baseProductId, value);
          break;
        case SchedulingAction.UPDATE_PRICE_OFFER:
          await this.updateOfferPriceUseCase.execute(scheduling.baseProductId, value);
          break;
      }
    } catch (error) {
      scheduling.error = error instanceof Error ? error.message : String(error);
      console.error(`Scheduling ${scheduling.id} failed`, scheduling.error);
    } finally {
      scheduling.executed = true;
      await this.schedulingRepository.save(scheduling);
    }
  }

  private serviceMapper(origin: Origin): { importProduct(ean: number): Promise<unknown> } {
    return {
      [Origin.DROGAL]: this.drogalService,
      [Origin.DROGASIL]: this.drogasilService,
      [Origin.PAGUE_MENOS]: this.pagueMenosService,
      [Origin.IKESAKI]: this.ikesakiService,
      [Origin.MICHELASSI]: this.michelassiService
    }[origin];
  }
}
