import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SuggestionRulesService } from './suggestion-rules.service';
import { UpsertSuggestionRuleDto } from './dto/suggestion-rule.dto';

const S1 = '11111111-1111-4111-8111-111111111111';
const ALHEIA = '22222222-2222-4222-8222-222222222222';

const dto = (over: Partial<UpsertSuggestionRuleDto> = {}) => ({
  name: 'regra',
  minMargin: 30,
  ...over,
});

/** Mock em: tenant + quantas lojas do tenant o assertStores encontra. */
const makeEm = (ownedStoreCount: number) =>
  ({
    query: jest.fn((sql: string) => {
      if (/FROM core\.tenant\s+WHERE slug/.test(sql)) {
        return Promise.resolve([{ id: 't-1' }]);
      }
      if (/core\.tenant_store/.test(sql)) {
        return Promise.resolve(
          Array.from({ length: ownedStoreCount }, () => ({ 1: 1 })),
        );
      }
      return Promise.resolve([]);
    }),
    getRepository: jest.fn(() => ({
      create: (v: unknown) => v,
      save: jest.fn().mockResolvedValue({ id: 'r1' }),
    })),
  }) as unknown as EntityManager;

describe('SuggestionRulesService.assertStores', () => {
  it('loja de outro tenant (ou deletada) na regra → 400, nada é salvo', async () => {
    const service = new SuggestionRulesService();
    const em = makeEm(1); // só 1 das 2 lojas pedidas pertence ao tenant
    await expect(
      service.create(em, 'acme', dto({ storeIds: [S1, ALHEIA] })),
    ).rejects.toThrow(BadRequestException);
    expect(em.getRepository).not.toHaveBeenCalled();
  });

  it('storeIds vazio (= todas as lojas) não consulta lojas', async () => {
    const service = new SuggestionRulesService();
    const em = makeEm(0);
    // create segue até o save + get (list) — só interessa que assertStores
    // não rejeitou nem consultou core.tenant_store.
    await service.create(em, 'acme', dto()).catch(() => undefined);
    const calls = (em.query as jest.Mock).mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('core.tenant_store'))).toBe(false);
  });

  it('loja inativa mas do tenant passa (regra volta a valer se reativarem)', async () => {
    const service = new SuggestionRulesService();
    const em = makeEm(1); // a query não filtra active — inativa conta
    await expect(
      service.create(em, 'acme', dto({ storeIds: [S1] })).catch((e) => {
        // o get() pós-save falha no mock (list vazio) — só não pode ser o 400
        if (e instanceof BadRequestException) throw e;
      }),
    ).resolves.toBeUndefined();
  });
});
