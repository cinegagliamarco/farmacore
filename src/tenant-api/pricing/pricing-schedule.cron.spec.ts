import { Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ModuleCode } from '../../database/enums/module-code.enum';
import type { TenantService } from '../../tenant/tenant.service';
import type { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import type { PricingApplyService } from './pricing-apply.service';
import type { PricingScheduleService } from './pricing-schedule.service';
import type { PricingSuggestionsService } from './pricing-suggestions.service';
import { PricingScheduleCron } from './pricing-schedule.cron';

// Uuid de loja ativa do tenant (o recalcMaps valida contra core.tenant_store).
const S1 = '11111111-1111-4111-8111-111111111111';

const schedule = (id: string) => ({
  id,
  runAt: new Date(),
  requestedBy: 'ops',
  items: [{ ean: '789', target: 'precoVenda' as const, price: 10 }],
  cronExpr: null,
  recalc: false,
});

describe('PricingScheduleCron', () => {
  let activeStoreIds: string[];
  const em = {
    query: jest.fn((sql: string) => {
      if (/core\.tenant_store/.test(sql)) {
        return Promise.resolve(activeStoreIds.map((id) => ({ id })));
      }
      return Promise.resolve([]);
    }),
  } as unknown as EntityManager;
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
    activeStoreIds = [S1];
    schedules = {
      claimNext: jest.fn().mockResolvedValue(null),
      markFired: jest.fn(),
      markFailed: jest.fn(),
      reArm: jest.fn(),
    };
    apply = { apply: jest.fn().mockResolvedValue({ applyRunId: 'run1' }) };
    suggestions = { priceMap: jest.fn().mockResolvedValue(new Map()) };
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

  it('recalc roda por agendamento, ESCOPADO aos EANs, e descarta item sem sugestão', async () => {
    schedules.claimNext
      .mockResolvedValueOnce({
        ...schedule('s1'),
        recalc: true,
        items: [
          { ean: '789', target: 'precoVenda' as const, price: 10 },
          { ean: '111', target: 'precoVenda' as const, price: 5 },
        ],
      })
      .mockResolvedValue(null);
    suggestions.priceMap.mockResolvedValue(
      new Map([['789', { target: 'precoOferta' as const, price: 12.9 }]]),
    );
    await cron.fire();
    // Escopado aos EANs do agendamento — sem passe de catálogo inteiro.
    expect(suggestions.priceMap).toHaveBeenCalledWith(em, 'acme', null, [
      '789',
      '111',
    ]);
    // Frozen price/target replaced by the fresh suggestion; the EAN without
    // a suggestion is dropped.
    expect(apply.apply).toHaveBeenCalledWith(
      em,
      'acme',
      'ops',
      expect.objectContaining({
        items: [
          {
            ean: '789',
            target: 'precoOferta',
            price: 12.9,
            cadernoId: undefined,
            storeId: undefined,
          },
        ],
      }),
    );
    expect(schedules.markFired).toHaveBeenCalledWith(em, 's1', 'run1');
  });

  it('recalc resolve o preço no mapa DA LOJA do item (caderno não congelado)', async () => {
    schedules.claimNext
      .mockResolvedValueOnce({
        ...schedule('s1'),
        recalc: true,
        items: [
          { ean: '111', target: 'precoVenda' as const, price: 5, storeId: S1 },
          {
            ean: '222',
            target: 'precoVenda' as const,
            price: 5,
            cadernoId: 55,
          },
        ],
      })
      .mockResolvedValue(null);
    suggestions.priceMap.mockImplementation(
      (_em: EntityManager, _slug: string, store: string | null) =>
        Promise.resolve(
          store === S1
            ? new Map([['111', { target: 'precoOferta', price: 11 }]])
            : new Map([['222', { target: 'precoVenda', price: 22 }]]),
        ),
    );
    await cron.fire();
    expect(suggestions.priceMap).toHaveBeenCalledWith(em, 'acme', S1, ['111']);
    expect(suggestions.priceMap).toHaveBeenCalledWith(em, 'acme', null, [
      '222',
    ]);
    expect(apply.apply.mock.calls[0][3].items).toEqual([
      {
        ean: '111',
        target: 'precoOferta',
        price: 11,
        // Item de loja não congela o caderno: alvo é o vencedor ATUAL da loja.
        cadernoId: undefined,
        storeId: S1,
      },
      {
        ean: '222',
        target: 'precoVenda',
        price: 22,
        cadernoId: 55, // item global mantém o caderno congelado
        storeId: undefined,
      },
    ]);
  });

  it('loja com uuid malformado ou inativa não paga passe de catálogo: itens descartados', async () => {
    activeStoreIds = []; // nenhuma loja resolve como ativa do tenant
    schedules.claimNext
      .mockResolvedValueOnce({
        ...schedule('s1'),
        recalc: true,
        items: [
          {
            ean: '111',
            target: 'precoVenda' as const,
            price: 5,
            storeId: 'lixo',
          },
          {
            ean: '222',
            target: 'precoVenda' as const,
            price: 5,
            storeId: '22222222-2222-4222-8222-222222222222',
          },
        ],
      })
      .mockResolvedValue(null);
    await cron.fire();
    expect(suggestions.priceMap).not.toHaveBeenCalled();
    expect(apply.apply).not.toHaveBeenCalled(); // itens descartados → sem lote
    expect(schedules.markFired).toHaveBeenCalledWith(em, 's1', null);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('pulou loja inválida/inativa'),
    );
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
