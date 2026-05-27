import { DataSource, EntityManager, Repository } from 'typeorm';
import { SyncOfferBooksInfoStep } from './sync-offer-books-info.step';
import { CadernoOfertaEntity } from '../../integration/entities/a7pharma/caderno-oferta.entity';
import { TenantOfferCampaignEntity } from '../../database/entities/tenant/tenant-offer-campaign.entity';

const buildIntegrationDs = (
  campaigns: Partial<CadernoOfertaEntity>[],
): DataSource =>
  ({
    getRepository: (entity: unknown) => {
      if (entity === CadernoOfertaEntity) {
        return {
          createQueryBuilder: () => {
            const qb = {
              orderBy: () => qb,
              getMany: () => Promise.resolve(campaigns),
            };
            return qb;
          },
        } as unknown as Repository<CadernoOfertaEntity>;
      }
      return {} as Repository<unknown>;
    },
  }) as unknown as DataSource;

const buildEm = (
  captures: { upsertArgs: unknown[] },
): EntityManager =>
  ({
    getRepository: (entity: unknown) => {
      if (entity !== TenantOfferCampaignEntity) {
        throw new Error(`unexpected tenant entity: ${String(entity)}`);
      }
      return {
        upsert: (rows: unknown) => {
          captures.upsertArgs.push(rows);
          return Promise.resolve();
        },
      } as unknown as Repository<TenantOfferCampaignEntity>;
    },
  }) as unknown as EntityManager;

describe('SyncOfferBooksInfoStep.run', () => {
  let step: SyncOfferBooksInfoStep;
  let captures: { upsertArgs: unknown[] };

  beforeEach(() => {
    step = new SyncOfferBooksInfoStep();
    captures = { upsertArgs: [] };
  });

  it('skips when integration DS is null', async () => {
    await step.run(buildEm(captures), null);
    expect(captures.upsertArgs).toHaveLength(0);
  });

  it('skips when no campaigns exist', async () => {
    await step.run(buildEm(captures), buildIntegrationDs([]));
    expect(captures.upsertArgs).toHaveLength(0);
  });

  it('maps caderno_oferta -> tenant_offer_campaign with active flag', async () => {
    const expires = new Date('2026-06-01T00:00:00Z');
    await step.run(
      buildEm(captures),
      buildIntegrationDs([
        {
          id: 101,
          nome: 'Black Friday',
          status: 'A',
          datahorainicial: new Date('2026-05-25T00:00:00Z'),
          datahorafinal: expires,
        },
        {
          id: 102,
          nome: 'Expired',
          status: 'I',
          datahorainicial: undefined,
          datahorafinal: undefined,
        },
      ]),
    );
    expect(captures.upsertArgs[0]).toEqual([
      {
        externalId: '101',
        name: 'Black Friday',
        active: true,
        startDate: new Date('2026-05-25T00:00:00Z'),
        expirationDate: expires,
      },
      {
        externalId: '102',
        name: 'Expired',
        active: false,
        startDate: null,
        expirationDate: null,
      },
    ]);
  });
});
