import { DataSource, EntityManager, Repository } from 'typeorm';
import { SyncBaseProductStockStep } from './sync-base-product-stock.step';
import { EmbalagemEntity } from '../../integration/entities/a7pharma/embalagem.entity';
import { EstoqueEntity } from '../../integration/entities/a7pharma/estoque.entity';
import { ProductStockEntity } from '../../database/entities/tenant/product-stock.entity';

/**
 * Lightweight mock of the per-call repos. Keeps the suite focused on
 * the aggregation behavior (parsing, dedupe, summing per store)
 * without setting up a real DataSource.
 */
const buildIntegrationDs = (
  embalagens: Partial<EmbalagemEntity>[],
  estoques: Partial<EstoqueEntity>[],
): DataSource =>
  ({
    getRepository: (entity: unknown) => {
      if (entity === EmbalagemEntity) {
        return {
          createQueryBuilder: () => {
            const qb = {
              where: () => qb,
              andWhere: () => qb,
              orderBy: () => qb,
              leftJoinAndSelect: () => qb,
              getMany: () => Promise.resolve(embalagens),
            };
            return qb;
          },
        } as unknown as Repository<EmbalagemEntity>;
      }
      if (entity === EstoqueEntity) {
        return {
          createQueryBuilder: () => {
            const qb = {
              where: () => qb,
              andWhere: () => qb,
              getMany: () => Promise.resolve(estoques),
            };
            return qb;
          },
        } as unknown as Repository<EstoqueEntity>;
      }
      // Other A7Pharma repos are built by the bundle constructor but
      // never called by this step — return a noop stub.
      return {} as Repository<unknown>;
    },
  }) as unknown as DataSource;

const buildEm = (captures: {
  upsertArgs: unknown[];
  deleteArgs: unknown[];
}): EntityManager =>
  ({
    getRepository: (entity: unknown) => {
      if (entity !== ProductStockEntity) {
        throw new Error(`unexpected tenant entity: ${String(entity)}`);
      }
      return {
        upsert: (rows: unknown) => {
          captures.upsertArgs.push(rows);
          return Promise.resolve();
        },
        delete: (where: unknown) => {
          captures.deleteArgs.push(where);
          return Promise.resolve({});
        },
      } as unknown as Repository<ProductStockEntity>;
    },
  }) as unknown as EntityManager;

describe('SyncBaseProductStockStep.run', () => {
  let step: SyncBaseProductStockStep;
  let captures: { upsertArgs: unknown[]; deleteArgs: unknown[] };

  beforeEach(() => {
    step = new SyncBaseProductStockStep();
    captures = { upsertArgs: [], deleteArgs: [] };
  });

  it('returns processed=0 when integration DS is null', async () => {
    const out = await step.run(buildEm(captures), null, [1, 2, 3]);
    expect(out).toEqual({ processed: 0, skipped: 3 });
    expect(captures.upsertArgs).toHaveLength(0);
  });

  it('parses EANs, sums quantities per store, and upserts', async () => {
    const embalagens = [
      { id: 10, codigobarras: '7891234567890', quantidadeporembalagem: 1 },
      { id: 11, codigobarras: '7891111111111', quantidadeporembalagem: 1 },
    ];
    const estoques = [
      { embalagemid: 10, unidadenegocioid: 1, estoque: 5 },
      { embalagemid: 10, unidadenegocioid: 2, estoque: 7 },
      { embalagemid: 11, unidadenegocioid: 1, estoque: 3 },
    ];

    const out = await step.run(
      buildEm(captures),
      buildIntegrationDs(embalagens, estoques),
      [10, 11],
    );

    expect(out).toEqual({ processed: 3, skipped: 0 });
    const upserted = captures.upsertArgs[0] as Array<{
      ean: string;
      storeExternalId: string;
      quantity: number;
    }>;
    expect(upserted).toEqual(
      expect.arrayContaining([
        { ean: '7891234567890', storeExternalId: '1', quantity: 5 },
        { ean: '7891234567890', storeExternalId: '2', quantity: 7 },
        { ean: '7891111111111', storeExternalId: '1', quantity: 3 },
      ]),
    );
  });

  it('skips estoque rows for embalagens with unparseable barcodes', async () => {
    const embalagens = [
      { id: 10, codigobarras: '', quantidadeporembalagem: 1 },
      { id: 11, codigobarras: '7891111111111', quantidadeporembalagem: 1 },
    ];
    const estoques = [
      { embalagemid: 10, unidadenegocioid: 1, estoque: 5 },
      { embalagemid: 11, unidadenegocioid: 1, estoque: 3 },
    ];

    const out = await step.run(
      buildEm(captures),
      buildIntegrationDs(embalagens, estoques),
      [10, 11],
    );

    expect(out.skipped).toBe(1);
    const upserted = captures.upsertArgs[0] as Array<{ ean: string }>;
    expect(upserted).toHaveLength(1);
    expect(upserted[0].ean).toBe('7891111111111');
  });

  it('sums two estoque rows for the same (ean, store)', async () => {
    // Two embalagens sharing a barcode + same store should NOT double-count
    // the stock; the step aggregates at the EAN level.
    const embalagens = [
      { id: 10, codigobarras: '7891234567890', quantidadeporembalagem: 1 },
      { id: 11, codigobarras: '7891234567890', quantidadeporembalagem: 1 },
    ];
    const estoques = [
      { embalagemid: 10, unidadenegocioid: 1, estoque: 5 },
      { embalagemid: 11, unidadenegocioid: 1, estoque: 7 },
    ];

    const out = await step.run(
      buildEm(captures),
      buildIntegrationDs(embalagens, estoques),
      [10, 11],
    );

    expect(out.processed).toBe(1);
    const upserted = captures.upsertArgs[0] as Array<{ quantity: number }>;
    expect(upserted[0].quantity).toBe(12);
  });
});
