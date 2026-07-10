import { Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ModuleCode } from '../../database/enums/module-code.enum';
import type { TenantService } from '../../tenant/tenant.service';
import type { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import type { PricingApplyService } from './pricing-apply.service';
import type { PricingScheduleService } from './pricing-schedule.service';
import type { PricingSuggestionsService } from './pricing-suggestions.service';
import { PricingScheduleCron } from './pricing-schedule.cron';

const schedule = (id: string) => ({
  id,
  runAt: new Date(),
  requestedBy: 'ops',
  items: [{ ean: '789', target: 'precoVenda' as const, price: 10 }],
  cronExpr: null,
  recalc: false,
});

describe('PricingScheduleCron', () => {
  const em = {} as EntityManager;
  let schedules: {
    claimNext: jest.Mock;
    markFired: jest.Mock;
    markFailed: jest.Mock;
    reArm: jest.Mock;
  };
  let apply: { apply: jest.Mock };
  let suggestions: { priceMap: jest.Mock };
  let cron: PricingScheduleCron;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.WORKER_MODE;
    schedules = {
      claimNext: jest.fn().mockResolvedValue(null),
      markFired: jest.fn(),
      markFailed: jest.fn(),
      reArm: jest.fn(),
    };
    apply = { apply: jest.fn().mockResolvedValue({ applyRunId: 'run1' }) };
    suggestions = { priceMap: jest.fn() };
    const tenants = {
      listActive: jest.fn().mockResolvedValue([
        {
          slug: 'acme',
          schemaName: 'tenant_acme',
          modules: [ModuleCode.PRICING_RULES],
        },
      ]),
    };
    const tx = {
      runWithTenant: jest.fn(
        (_schema: string, fn: (e: EntityManager) => unknown) => fn(em),
      ),
    };
    cron = new PricingScheduleCron(
      tenants as unknown as TenantService,
      tx as unknown as TenantTransactionService,
      schedules as unknown as PricingScheduleService,
      apply as unknown as PricingApplyService,
      suggestions as unknown as PricingSuggestionsService,
    );
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('stops the loop when claimNext returns null', async () => {
    await cron.fire();
    expect(schedules.claimNext).toHaveBeenCalledTimes(1);
    expect(apply.apply).not.toHaveBeenCalled();
  });

  it('parks a schedule whose apply throws and continues to the next one', async () => {
    schedules.claimNext
      .mockResolvedValueOnce(schedule('s1'))
      .mockResolvedValueOnce(schedule('s2'))
      .mockResolvedValue(null);
    apply.apply.mockRejectedValueOnce(new Error('circuit breaker'));
    await cron.fire();
    expect(schedules.markFailed).toHaveBeenCalledWith(
      em,
      's1',
      expect.any(Date),
    );
    expect(schedules.markFired).toHaveBeenCalledWith(em, 's2', 'run1');
  });

  it('keeps the markFired of earlier schedules when a later one fails', async () => {
    schedules.claimNext
      .mockResolvedValueOnce(schedule('s1'))
      .mockResolvedValueOnce(schedule('s2'))
      .mockResolvedValue(null);
    apply.apply
      .mockResolvedValueOnce({ applyRunId: 'run1' })
      .mockRejectedValueOnce(new Error('boom'));
    await cron.fire();
    expect(schedules.markFired).toHaveBeenCalledWith(em, 's1', 'run1');
    expect(schedules.markFailed).toHaveBeenCalledWith(
      em,
      's2',
      expect.any(Date),
    );
  });

  it('computes the recalc snapshot once per tenant and swaps frozen items for fresh suggestions', async () => {
    schedules.claimNext
      .mockResolvedValueOnce({
        ...schedule('s1'),
        recalc: true,
        items: [
          { ean: '789', target: 'precoVenda' as const, price: 10 },
          { ean: '111', target: 'precoVenda' as const, price: 5 },
        ],
      })
      .mockResolvedValueOnce({ ...schedule('s2'), recalc: true })
      .mockResolvedValue(null);
    suggestions.priceMap.mockResolvedValue(
      new Map([['789', { target: 'precoOferta' as const, price: 12.9 }]]),
    );
    await cron.fire();
    // The engine scans the whole catalog — once per tenant, not per schedule.
    expect(suggestions.priceMap).toHaveBeenCalledTimes(1);
    // Frozen price/target replaced by the fresh suggestion; the EAN without
    // a suggestion is dropped.
    expect(apply.apply).toHaveBeenCalledWith(
      em,
      'acme',
      'ops',
      expect.objectContaining({
        items: [{ ean: '789', target: 'precoOferta', price: 12.9 }],
      }),
    );
    expect(schedules.markFired).toHaveBeenCalledWith(em, 's1', 'run1');
  });

  it('re-arms a recurring schedule (cronExpr) instead of marking it fired', async () => {
    schedules.claimNext
      .mockResolvedValueOnce({ ...schedule('s1'), cronExpr: '0 3 * * *' })
      .mockResolvedValue(null);
    await cron.fire();
    expect(schedules.reArm).toHaveBeenCalledWith(em, 's1', '0 3 * * *', 'run1');
    expect(schedules.markFired).not.toHaveBeenCalled();
  });

  it('ends the tick with a warn when markFailed itself fails (no livelock)', async () => {
    // claimNext keeps returning the same schedule — only bailing out ends the tick.
    schedules.claimNext.mockResolvedValue(schedule('s1'));
    apply.apply.mockRejectedValue(new Error('circuit breaker'));
    schedules.markFailed.mockRejectedValue(new Error('chk_psch_status'));
    await cron.fire();
    expect(apply.apply).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('markFailed(s1) failed for acme'),
    );
  });
});
