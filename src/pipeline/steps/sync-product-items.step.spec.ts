import { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { SyncProductItemsStep, StoreRef } from './sync-product-items.step';
import { EmbalagemEntity } from '../../integration/entities/a7pharma/embalagem.entity';
import { CustoProdutoEntity } from '../../integration/entities/a7pharma/custo-produto.entity';
import { PrecoEmbalagemUnidadeNegocioEntity } from '../../integration/entities/a7pharma/preco-embalagem-unidade-negocio.entity';
import { ProductItemEntity } from '../../database/entities/tenant/product-item.entity';

interface ErpData {
  produtoIdByEmbalagem: Array<{ id: number; produtoid: number }>;
  prices: Array<{ embalagemid: number; precovenda: number }>;
  costs: Array<{ produtoid: number; custo: number | null; customedio: number }>;
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
      return {} as Repository<ObjectLiteral>;
    },
  }) as unknown as DataSource;

const buildEm = (
  offers: Array<{ ean: string; targetPrice: string | null }>,
  products: Array<{
    id: string;
    ean: string;
    externalId: string;
    price: string | null;
  }>,
  capturedUpserts: unknown[],
): EntityManager =>
  ({
    query: (sql: string) => {
      if (sql.includes('FROM product')) return Promise.resolve(products);
      if (sql.includes('FROM offer_book')) return Promise.resolve(offers);
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
    const em = buildEm([], [], []);
    expect(await step.run(em, null, ['p1'], STORES)).toEqual({ processed: 0 });
  });

  it('no-ops when there are no products or no stores', async () => {
    const captured: unknown[] = [];
    const em = buildEm([], [], captured);
    const ds = buildIntegrationDs({
      produtoIdByEmbalagem: [],
      prices: [],
      costs: [],
    });
    expect(await step.run(em, ds, [], STORES)).toEqual({ processed: 0 });
    expect(await step.run(em, ds, ['p1'], [])).toEqual({ processed: 0 });
    expect(captured).toHaveLength(0);
  });

  it('projects per-store price/cost and global offer into product_item', async () => {
    const captured: unknown[] = [];
    const em = buildEm(
      [{ ean: '789', targetPrice: '4.50' }],
      [
        { id: 'p1', ean: '789', externalId: '10', price: '10.00' },
        { id: 'p2', ean: '790', externalId: '11', price: '20.00' },
      ],
      captured,
    );
    const ds = buildIntegrationDs({
      produtoIdByEmbalagem: [
        { id: 10, produtoid: 100 },
        { id: 11, produtoid: 101 },
      ],
      // p1 (embalagem 10) has a per-store override; p2 falls back to global.
      prices: [{ embalagemid: 10, precovenda: 9.5 }],
      costs: [{ produtoid: 100, custo: 3.87, customedio: 4 }],
    });

    const out = await step.run(em, ds, ['p1', 'p2'], STORES);

    expect(out).toEqual({ processed: 2 });
    const rows = captured[0] as Array<{
      productId: string;
      storeId: string;
      price: string | null;
      priceOffer: string | null;
      cost: string | null;
    }>;
    expect(rows).toEqual([
      {
        productId: 'p1',
        storeId: 'store-1',
        price: '9.5', // per-store override
        priceOffer: '4.50', // global offer mirrored
        cost: '3.87', // per-store cost
      },
      {
        productId: 'p2',
        storeId: 'store-1',
        price: '20.00', // fallback to product.price (no override)
        priceOffer: null, // no offer for ean 790
        cost: null, // no per-store cost for produto 101
      },
    ]);
  });
});
