import { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { SyncProductItemsStep, StoreRef } from './sync-product-items.step';
import { EmbalagemEntity } from '../../integration/entities/a7pharma/embalagem.entity';
import { CustoProdutoEntity } from '../../integration/entities/a7pharma/custo-produto.entity';
import { ItemCadernoOfertaEntity } from '../../integration/entities/a7pharma/item-caderno-oferta.entity';
import { PrecoEmbalagemUnidadeNegocioEntity } from '../../integration/entities/a7pharma/preco-embalagem-unidade-negocio.entity';
import { ProductItemEntity } from '../../database/entities/tenant/product-item.entity';

interface ErpData {
  produtoIdByEmbalagem: Array<{ id: number; produtoid: number }>;
  prices: Array<{ embalagemid: number; precovenda: number }>;
  costs: Array<{ produtoid: number; custo: number | null; customedio: number }>;
  /** Linhas cruas da query findStoreOffers (vencedor por embalagem × loja). */
  storeOffers: Array<Record<string, unknown>>;
}

const buildIntegrationDs = (data: ErpData): DataSource =>
  ({
    getRepository: (entity: unknown) => {
      if (entity === EmbalagemEntity) {
        return {
          createQueryBuilder: () => {
            const qb = {
              select: () => qb,
              where: () => qb,
              getRawMany: () =>
                Promise.resolve(
                  data.produtoIdByEmbalagem.map((r) => ({
                    id: String(r.id),
                    produtoid: String(r.produtoid),
                  })),
                ),
            };
            return qb;
          },
        } as unknown as Repository<EmbalagemEntity>;
      }
      if (entity === PrecoEmbalagemUnidadeNegocioEntity) {
        return {
          createQueryBuilder: () => {
            const qb = {
              where: () => qb,
              andWhere: () => qb,
              getMany: () => Promise.resolve(data.prices),
            };
            return qb;
          },
        } as unknown as Repository<PrecoEmbalagemUnidadeNegocioEntity>;
      }
      if (entity === CustoProdutoEntity) {
        return {
          createQueryBuilder: () => {
            const qb = {
              where: () => qb,
              andWhere: () => qb,
              getMany: () => Promise.resolve(data.costs),
            };
            return qb;
          },
        } as unknown as Repository<CustoProdutoEntity>;
      }
      if (entity === ItemCadernoOfertaEntity) {
        return {
          manager: { query: () => Promise.resolve(data.storeOffers) },
        } as unknown as Repository<ItemCadernoOfertaEntity>;
      }
      return {} as Repository<ObjectLiteral>;
    },
  }) as unknown as DataSource;

const buildEm = (
  products: Array<{
    id: string;
    externalId: string;
  }>,
  capturedUpserts: unknown[],
): EntityManager =>
  ({
    query: (sql: string) => {
      if (sql.includes('FROM product')) return Promise.resolve(products);
      return Promise.resolve([]);
    },
    getRepository: (entity: unknown) => {
      if (entity !== ProductItemEntity) {
        throw new Error(`unexpected tenant entity: ${String(entity)}`);
      }
      return {
        upsert: (rows: unknown) => {
          capturedUpserts.push(rows);
          return Promise.resolve();
        },
      } as unknown as Repository<ProductItemEntity>;
    },
  }) as unknown as EntityManager;

const STORES: StoreRef[] = [{ id: 'store-1', externalId: '9' }];

describe('SyncProductItemsStep.run', () => {
  let step: SyncProductItemsStep;

  beforeEach(() => {
    step = new SyncProductItemsStep();
  });

  it('skips when integration DS is null', async () => {
    const em = buildEm([], []);
    expect(await step.run(em, null, ['p1'], STORES)).toEqual({ processed: 0 });
  });

  it('no-ops when there are no products or no stores', async () => {
    const captured: unknown[] = [];
    const em = buildEm([], captured);
    const ds = buildIntegrationDs({
      produtoIdByEmbalagem: [],
      prices: [],
      costs: [],
      storeOffers: [],
    });
    expect(await step.run(em, ds, [], STORES)).toEqual({ processed: 0 });
    expect(await step.run(em, ds, ['p1'], [])).toEqual({ processed: 0 });
    expect(captured).toHaveLength(0);
  });

  it('projects per-store price/cost/offer into product_item', async () => {
    const captured: unknown[] = [];
    const em = buildEm(
      [
        { id: 'p1', externalId: '10' },
        { id: 'p2', externalId: '11' },
      ],
      captured,
    );
    const ds = buildIntegrationDs({
      produtoIdByEmbalagem: [
        { id: 10, produtoid: 100 },
        { id: 11, produtoid: 101 },
      ],
      // p1 (embalagem 10) has a per-store price; p2 has none (stays NULL —
      // reads COALESCE to the live global product.price).
      prices: [{ embalagemid: 10, precovenda: 9.5 }],
      costs: [{ produtoid: 100, custo: 3.87, customedio: 4 }],
      // p1 belongs to caderno 77 at this store, undercutting the shelf price.
      storeOffers: [
        {
          embalagemid: '10',
          unidadenegocioid: '9',
          cadernoofertaid: '77',
          cadernoNome: 'Caderno Loja 9',
          precoFinalOferta: '4.50',
          precoCadastro: '9.5',
        },
      ],
    });

    const out = await step.run(em, ds, ['p1', 'p2'], STORES);

    expect(out).toEqual({ processed: 2 });
    const rows = captured[0] as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      {
        productId: 'p1',
        storeId: 'store-1',
        price: '9.5', // per-store override
        priceOffer: '4.5', // the store's caderno offer
        cost: '3.87', // per-store cost
        offerExternalId: '77',
        offerDescription: 'Caderno Loja 9',
      },
      {
        productId: 'p2',
        storeId: 'store-1',
        price: null, // no per-store price — reads fall back to the global
        priceOffer: null, // no caderno covers ean 790 at this store
        cost: null, // no per-store cost for produto 101
        offerExternalId: null,
        offerDescription: null,
      },
    ]);
  });

  it('keeps caderno membership but no price when the offer does not undercut the shelf', async () => {
    const captured: unknown[] = [];
    const em = buildEm([{ id: 'p1', externalId: '10' }], captured);
    const ds = buildIntegrationDs({
      produtoIdByEmbalagem: [{ id: 10, produtoid: 100 }],
      prices: [{ embalagemid: 10, precovenda: 9.5 }],
      costs: [],
      storeOffers: [
        {
          embalagemid: '10',
          unidadenegocioid: '9',
          cadernoofertaid: '77',
          cadernoNome: 'Caderno Loja 9',
          precoFinalOferta: '12.00', // acima da prateleira: ninguém paga isso
          precoCadastro: '9.5',
        },
      ],
    });

    await step.run(em, ds, ['p1'], STORES);

    const rows = captured[0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      priceOffer: null,
      offerExternalId: '77', // membership preserved: apply targets this caderno
      offerDescription: 'Caderno Loja 9',
    });
  });

  it('oferta sem preço unitário (tipo S/M/B/F) mantém membership com priceOffer null', async () => {
    const captured: unknown[] = [];
    const em = buildEm([{ id: 'p1', externalId: '10' }], captured);
    const ds = buildIntegrationDs({
      produtoIdByEmbalagem: [{ id: 10, produtoid: 100 }],
      prices: [{ embalagemid: 10, precovenda: 9.5 }],
      costs: [],
      storeOffers: [
        {
          embalagemid: '10',
          unidadenegocioid: '9',
          cadernoofertaid: '77',
          cadernoNome: 'Caderno S/M',
          precoFinalOferta: null,
          precoCadastro: '9.5',
        },
      ],
    });
    await step.run(em, ds, ['p1'], STORES);
    expect((captured[0] as Array<Record<string, unknown>>)[0]).toMatchObject({
      priceOffer: null,
      offerExternalId: '77',
      offerDescription: 'Caderno S/M',
    });
  });

  it('oferta com preço mas sem referência de prateleira é registrada', async () => {
    const captured: unknown[] = [];
    const em = buildEm([{ id: 'p1', externalId: '10' }], captured);
    const ds = buildIntegrationDs({
      produtoIdByEmbalagem: [{ id: 10, produtoid: 100 }],
      prices: [],
      costs: [],
      storeOffers: [
        {
          embalagemid: '10',
          unidadenegocioid: '9',
          cadernoofertaid: '77',
          cadernoNome: 'C',
          precoFinalOferta: '4.50',
          precoCadastro: null,
        },
      ],
    });
    await step.run(em, ds, ['p1'], STORES);
    expect((captured[0] as Array<Record<string, unknown>>)[0]).toMatchObject({
      priceOffer: '4.5',
      offerExternalId: '77',
    });
  });
});
