import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ModuleCode } from '../../database/enums/module-code.enum';
import { ExecutionType } from '../../database/enums/execution-type.enum';
import type { TenantService } from '../../tenant/tenant.service';
import type { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import type { OfferBookRulesExecutionService } from './offer-book-rules-execution.service';
import { OfferBookRuleScheduleCron } from './offer-book-rule-schedule.cron';

const tenant = (over: Record<string, unknown> = {}) => ({
  slug: 'acme',
  schemaName: 'tenant_acme',
  modules: [ModuleCode.OFFER_BOOK_RULES],
  ...over,
});

const make = (opts: {
  tenants?: ReturnType<typeof tenant>[];
  dueRuleIds?: string[];
  execute?: jest.Mock;
}): {
  cron: OfferBookRuleScheduleCron;
  execute: jest.Mock;
  runWithTenant: jest.Mock;
} => {
  const execute =
    opts.execute ?? jest.fn().mockResolvedValue({ reportId: 'rep-1' });
  const em = {
    query: jest
      .fn()
      .mockResolvedValue((opts.dueRuleIds ?? []).map((id) => ({ id }))),
  } as unknown as EntityManager;
  const runWithTenant = jest.fn(
    (_schema: string, fn: (m: EntityManager) => unknown) => fn(em),
  );
  const tenants = {
    listActive: jest.fn().mockResolvedValue(opts.tenants ?? [tenant()]),
  } as unknown as TenantService;
  const tx = { runWithTenant } as unknown as TenantTransactionService;
  const execution = { execute } as unknown as OfferBookRulesExecutionService;
  return {
    cron: new OfferBookRuleScheduleCron(tenants, tx, execution),
    execute,
    runWithTenant,
  };
};

describe('OfferBookRuleScheduleCron.fireForTenant', () => {
  it('executa cada regra elegível como SCHEDULED', async () => {
    const { cron, execute } = make({ dueRuleIds: ['rule-a', 'rule-b'] });
    await cron.fireForTenant('acme', 'tenant_acme');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'acme',
      'rule-a',
      ExecutionType.SCHEDULED,
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'acme',
      'rule-b',
      ExecutionType.SCHEDULED,
    );
  });

  it('engole conflito de uma regra e segue para as outras', async () => {
    const execute = jest
      .fn()
      .mockRejectedValueOnce(new ConflictException('já está em execução'))
      .mockResolvedValueOnce({ reportId: 'rep-2' });
    const { cron } = make({ dueRuleIds: ['busy', 'ok'], execute });
    await expect(
      cron.fireForTenant('acme', 'tenant_acme'),
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('nenhuma regra elegível: não chama execute', async () => {
    const { cron, execute } = make({ dueRuleIds: [] });
    await cron.fireForTenant('acme', 'tenant_acme');
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('OfferBookRuleScheduleCron.fire', () => {
  const realTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = realTz;
    delete process.env.WORKER_MODE;
  });

  it('não roda no worker (WORKER_MODE=1)', async () => {
    process.env.WORKER_MODE = '1';
    const { cron, runWithTenant } = make({});
    const listActive = jest.fn();
    (cron as unknown as { tenants: { listActive: jest.Mock } }).tenants = {
      listActive,
    };
    await cron.fire();
    expect(listActive).not.toHaveBeenCalled();
    expect(runWithTenant).not.toHaveBeenCalled();
  });

  it('pula system e tenants sem o módulo', async () => {
    // Fixa a hora dentro da janela para o teste não depender do relógio.
    jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(
        () => ({ format: () => '10' }) as unknown as Intl.DateTimeFormat,
      );
    const { cron, runWithTenant } = make({
      tenants: [
        tenant({ slug: 'system' }),
        tenant({ slug: 'no-mod', modules: [] }),
        tenant({ slug: 'acme' }),
      ],
      dueRuleIds: [],
    });
    await cron.fire();
    // runWithTenant só é chamado para o tenant elegível (dueRuleIds).
    expect(runWithTenant).toHaveBeenCalledTimes(1);
    (Intl.DateTimeFormat as unknown as jest.Mock).mockRestore();
  });

  it('fora da janela comercial: não lista tenants', async () => {
    jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(
        () => ({ format: () => '03' }) as unknown as Intl.DateTimeFormat,
      );
    const listActive = jest.fn().mockResolvedValue([]);
    const { cron } = make({});
    (cron as unknown as { tenants: { listActive: jest.Mock } }).tenants = {
      listActive,
    };
    await cron.fire();
    expect(listActive).not.toHaveBeenCalled();
    (Intl.DateTimeFormat as unknown as jest.Mock).mockRestore();
  });
});
