import { EntityManager } from 'typeorm';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ModuleCode } from '../../database/enums/module-code.enum';
import { PricingScheduleCron } from './pricing-schedule.cron';
import type { PricingApplyService } from './pricing-apply.service';
import type {
  PricingScheduleService,
  DueSchedule,
} from './pricing-schedule.service';
import type { PricingSuggestionsService } from './pricing-suggestions.service';
import type { TenantService } from '../../tenant/tenant.service';
import type { TenantTransactionService } from '../../tenant/tenant-transaction.service';

type PriceEntry = { target: 'precoVenda' | 'precoOferta'; price: number };

// Uuid de loja ativa do tenant (o recalcMaps valida contra core.tenant_store).
const S1 = '11111111-1111-4111-8111-111111111111';

const build = (
  due: DueSchedule[],
  priceMaps: Record<string, Map<string, PriceEntry>>,
  activeStoreIds: string[] = [S1],
) => {
  const em = {
    query: jest.fn((sql: string) => {
      if (/core\.tenant_store/.test(sql)) {
        return Promise.resolve(activeStoreIds.map((id) => ({ id })));
      }
      return Promise.resolve([]); // SAVEPOINT / RELEASE / ROLLBACK TO
    }),
  } as unknown as EntityManager;
  const apply = { apply: jest.fn().mockResolvedValue({ applyRunId: 'run-1' }) };
  const schedules = {
    claimDue: jest.fn().mockResolvedValue(due),
    markFired: jest.fn().mockResolvedValue(undefined),
    reArm: jest.fn().mockResolvedValue(undefined),
  };
  const suggestions = {
    priceMap: jest.fn(
      (_em: EntityManager, _slug: string, store: string | null) =>
        Promise.resolve(
          priceMaps[store ?? ''] ?? new Map<string, PriceEntry>(),
        ),
    ),
  };
  const cron = new PricingScheduleCron(
    {
      listActive: jest.fn().mockResolvedValue([
        {
          slug: 'acme',
          schemaName: 'tenant_acme',
          modules: [ModuleCode.PRICING_RULES],
        },
      ]),
    } as unknown as TenantService,
    {
      runWithTenant: jest.fn(
        (_schema: string, fn: (em: EntityManager) => Promise<void>) => fn(em),
      ),
    } as unknown as TenantTransactionService,
    schedules as unknown as PricingScheduleService,
    apply as unknown as PricingApplyService,
    suggestions as unknown as PricingSuggestionsService,
  );
  return { cron, em, apply, schedules, suggestions };
};

const schedule = (over: Partial<DueSchedule> = {}): DueSchedule => ({
  id: 'sch-1',
  runAt: new Date('2026-07-09T12:00:00Z'),
  requestedBy: 'user-1',
  items: [],
  cronExpr: null,
  recalc: false,
  ...over,
});

describe('PricingScheduleCron', () => {
  beforeEach(() => {
    delete process.env.WORKER_MODE;
  });

  it('recalc resolve o preço no mapa DA LOJA do item, escopado aos EANs agendados', async () => {
    const { cron, apply, suggestions } = build(
      [
        schedule({
          recalc: true,
          items: [
            { ean: '111', target: 'precoVenda', price: 5, storeId: S1 },
            { ean: '222', target: 'precoVenda', price: 5, cadernoId: 55 },
            { ean: '333', target: 'precoVenda', price: 5, storeId: S1 }, // sem sugestão na loja
          ],
        }),
      ],
      {
        // '333' tem sugestão GLOBAL mas não na loja S1 — deve ser descartado.
        '': new Map([
          ['222', { target: 'precoVenda', price: 22 }],
          ['333', { target: 'precoVenda', price: 33 }],
        ]),
        [S1]: new Map([['111', { target: 'precoOferta', price: 11 }]]),
      },
    );
    await cron.fire();
    expect(suggestions.priceMap).toHaveBeenCalledTimes(2);
    expect(suggestions.priceMap).toHaveBeenCalledWith(
      expect.anything(),
      'acme',
      S1,
      ['111', '333'],
    );
    expect(suggestions.priceMap).toHaveBeenCalledWith(
      expect.anything(),
      'acme',
      null,
      ['222'],
    );
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
    const { cron, apply, suggestions, schedules } = build(
      [
        schedule({
          recalc: true,
          items: [
            { ean: '111', target: 'precoVenda', price: 5, storeId: 'lixo' },
            {
              ean: '222',
              target: 'precoVenda',
              price: 5,
              storeId: '22222222-2222-4222-8222-222222222222', // inativa/alheia
            },
          ],
        }),
      ],
      {},
      [], // nenhuma loja ativa resolve
    );
    await cron.fire();
    expect(suggestions.priceMap).not.toHaveBeenCalled();
    expect(apply.apply).not.toHaveBeenCalled(); // itens descartados → sem lote
    expect(schedules.markFired).toHaveBeenCalledWith(
      expect.anything(),
      'sch-1',
      null,
    );
  });

  it('apply que lança (ex.: circuit breaker por loja inativa) não envenena o lote: marca o disparo e segue', async () => {
    const { cron, em, apply, schedules } = build(
      [
        schedule({
          id: 'sch-ruim',
          items: [
            {
              ean: '111',
              target: 'precoVenda',
              price: 5,
              storeId: 's-inativa',
            },
          ],
        }),
        schedule({
          id: 'sch-bom',
          items: [{ ean: '222', target: 'precoVenda', price: 6 }],
        }),
      ],
      {},
    );
    apply.apply
      .mockRejectedValueOnce(
        new HttpException({ aborted: true }, HttpStatus.UNPROCESSABLE_ENTITY),
      )
      .mockResolvedValueOnce({ applyRunId: 'run-bom' });

    await expect(cron.fire()).resolves.toBeUndefined();

    expect(schedules.markFired).toHaveBeenCalledWith(
      expect.anything(),
      'sch-ruim',
      null,
    );
    expect(schedules.markFired).toHaveBeenCalledWith(
      expect.anything(),
      'sch-bom',
      'run-bom',
    );
    // Erro de Postgres dentro do apply abortaria a tx do claim — o savepoint
    // isola a falha ao agendamento (rollback parcial, claim commita).
    expect(em.query).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT sched_apply');
    expect(em.query).toHaveBeenCalledWith('RELEASE SAVEPOINT sched_apply');
  });
});
