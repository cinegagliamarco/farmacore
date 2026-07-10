import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ProductEntity as TenantProductEntity } from '../../database/entities/tenant/product.entity';
import type { A7PharmaApiClient } from '../../integration/a7-pharma-api.client';
import type { IntegrationConnectionService } from '../../integration/integration-connection.service';
import { CatalogMutationService } from './catalog-mutation.service';
import type { UpdateProductDto } from './dto/update-product.dto';

type RepoMock = {
  update: jest.Mock;
  findOne: jest.Mock;
  upsert: jest.Mock;
  delete: jest.Mock;
};

const makeRepo = (): RepoMock => ({
  update: jest.fn(),
  findOne: jest.fn(),
  upsert: jest.fn(),
  delete: jest.fn(),
});

const makeEm = (product: RepoMock, offer: RepoMock): EntityManager =>
  ({
    getRepository: jest.fn((entity: unknown) =>
      entity === TenantProductEntity ? product : offer,
    ),
  }) as unknown as EntityManager;

const creds = { baseUrl: 'https://erp', apiKey: 'x' };

const build = () => {
  const product = makeRepo();
  const offer = makeRepo();
  const integration = {
    getApiCredentials: jest.fn().mockResolvedValue(creds),
  } as unknown as IntegrationConnectionService;
  const a7 = {
    changePrices: jest.fn().mockResolvedValue(undefined),
    upsertOffer: jest.fn().mockResolvedValue(undefined),
  } as unknown as A7PharmaApiClient;
  const service = new CatalogMutationService(integration, a7);
  return {
    service,
    product,
    offer,
    integration,
    a7,
    em: makeEm(product, offer),
  };
};

describe('CatalogMutationService.updateProduct', () => {
  it('rejects when no editable field is provided', async () => {
    const { service, em } = build();
    await expect(service.updateProduct(em, '789', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('strips fields outside the editable allow-list', async () => {
    const { service, em, product } = build();
    product.update.mockResolvedValue({ affected: 1 });
    // `price` is NOT editable here (it goes through POST /price) — it must be
    // filtered out, so update() only ever sees the allow-listed `name`.
    await service.updateProduct(em, '789', {
      name: 'X',
      price: 999,
    } as unknown as UpdateProductDto);
    expect(product.update).toHaveBeenCalledWith({ ean: '789' }, { name: 'X' });
  });

  it('404s when the row is missing', async () => {
    const { service, em, product } = build();
    product.update.mockResolvedValue({ affected: 0 });
    await expect(
      service.updateProduct(em, '789', { name: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns the affected count on success', async () => {
    const { service, em, product } = build();
    product.update.mockResolvedValue({ affected: 1 });
    expect(await service.updateProduct(em, '789', { name: 'X' })).toEqual({
      ean: '789',
      updated: 1,
    });
  });
});

describe('CatalogMutationService.updatePrice', () => {
  it('404s when the product is missing', async () => {
    const { service, em, product } = build();
    product.findOne.mockResolvedValue(null);
    await expect(service.updatePrice(em, 't', '789', 10)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('409s when the product is monitored (price locked)', async () => {
    const { service, em, product } = build();
    product.findOne.mockResolvedValue({ monitored: true, externalId: '55' });
    await expect(service.updatePrice(em, 't', '789', 10)).rejects.toThrow(
      ConflictException,
    );
  });

  it('409s when the product has no ERP external_id', async () => {
    const { service, em, product } = build();
    product.findOne.mockResolvedValue({ monitored: false, externalId: null });
    await expect(service.updatePrice(em, 't', '789', 10)).rejects.toThrow(
      ConflictException,
    );
  });

  it('409s when the tenant has no A7Pharma API configured', async () => {
    const { service, em, product, integration } = build();
    product.findOne.mockResolvedValue({ monitored: false, externalId: '55' });
    (integration.getApiCredentials as jest.Mock).mockResolvedValue(null);
    await expect(service.updatePrice(em, 't', '789', 10)).rejects.toThrow(
      ConflictException,
    );
  });

  it('pushes to the ERP then mirrors the price locally (no store)', async () => {
    const { service, em, product, a7 } = build();
    product.findOne.mockResolvedValue({ monitored: false, externalId: '55' });
    const out = await service.updatePrice(em, 't', '789', 19.9);
    expect(a7.changePrices).toHaveBeenCalledWith(creds, [
      { idEmbalagem: 55, precoVendaNovo: 19.9 },
    ]);
    expect(product.update).toHaveBeenCalledWith(
      { ean: '789' },
      { price: '19.9' },
    );
    expect(out).toEqual({ ean: '789', price: 19.9, storeId: undefined });
  });

  it('targets the store and mirrors product_item when storeId is given', async () => {
    const product = makeRepo();
    const store = { findOne: jest.fn() };
    const productItem = { upsert: jest.fn() };
    product.findOne.mockResolvedValue({
      id: 'p-uuid',
      monitored: false,
      externalId: '55',
    });
    store.findOne.mockResolvedValue({
      id: 's1',
      externalId: '9',
      active: true,
    });
    const em = {
      query: jest.fn().mockResolvedValue([{ id: 'tenant-1' }]),
      getRepository: jest.fn((entity: { name?: string }) => {
        if (entity === TenantProductEntity) return product;
        if (entity?.name === 'TenantStoreEntity') return store;
        if (entity?.name === 'ProductItemEntity') return productItem;
        return makeRepo();
      }),
    } as unknown as EntityManager;
    const integration = {
      getApiCredentials: jest.fn().mockResolvedValue(creds),
    } as unknown as IntegrationConnectionService;
    const a7 = {
      changePrices: jest.fn().mockResolvedValue(undefined),
    } as unknown as A7PharmaApiClient;
    const service = new CatalogMutationService(integration, a7);

    const out = await service.updatePrice(em, 't', '789', 19.9, 's1');

    expect(a7.changePrices).toHaveBeenCalledWith(creds, [
      { idEmbalagem: 55, precoVendaNovo: 19.9, idUnidadeNegocioPreco: 9 },
    ]);
    expect(productItem.upsert).toHaveBeenCalledWith(
      { productId: 'p-uuid', storeId: 's1', price: '19.9' },
      ['productId', 'storeId'],
    );
    expect(product.update).not.toHaveBeenCalled();
    expect(out).toEqual({ ean: '789', price: 19.9, storeId: 's1' });
  });

  it('409s when the given store is inactive (nothing pushed to the ERP)', async () => {
    const product = makeRepo();
    product.findOne.mockResolvedValue({
      id: 'p-uuid',
      monitored: false,
      externalId: '55',
    });
    const store = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 's1', externalId: '9', active: false }),
    };
    const em = {
      query: jest.fn().mockResolvedValue([{ id: 'tenant-1' }]),
      getRepository: jest.fn((entity: unknown) =>
        entity === TenantProductEntity ? product : store,
      ),
    } as unknown as EntityManager;
    const a7 = { changePrices: jest.fn() } as unknown as A7PharmaApiClient;
    const service = new CatalogMutationService(
      {
        getApiCredentials: jest.fn().mockResolvedValue(creds),
      } as unknown as IntegrationConnectionService,
      a7,
    );
    await expect(
      service.updatePrice(em, 't', '789', 19.9, 's1'),
    ).rejects.toThrow(ConflictException);
    expect(a7.changePrices).not.toHaveBeenCalled();
  });

  it('502s when the ERP write fails (nothing mirrored locally)', async () => {
    const { service, em, product, a7 } = build();
    product.findOne.mockResolvedValue({ monitored: false, externalId: '55' });
    (a7.changePrices as jest.Mock).mockRejectedValue(new Error('timeout'));
    await expect(service.updatePrice(em, 't', '789', 19.9)).rejects.toThrow(
      BadGatewayException,
    );
    expect(product.update).not.toHaveBeenCalled();
  });

  it('404s when the given store is unknown', async () => {
    const product = makeRepo();
    product.findOne.mockResolvedValue({
      id: 'p-uuid',
      monitored: false,
      externalId: '55',
    });
    const em = {
      query: jest.fn().mockResolvedValue([{ id: 'tenant-1' }]),
      getRepository: jest.fn((entity: { name?: string }) =>
        entity === TenantProductEntity
          ? product
          : { findOne: jest.fn().mockResolvedValue(null) },
      ),
    } as unknown as EntityManager;
    const service = new CatalogMutationService(
      {
        getApiCredentials: jest.fn().mockResolvedValue(creds),
      } as unknown as IntegrationConnectionService,
      { changePrices: jest.fn() } as unknown as A7PharmaApiClient,
    );
    await expect(
      service.updatePrice(em, 't', '789', 19.9, 's-missing'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('CatalogMutationService.upsertOffer', () => {
  const dto = { cadernoId: 7, targetPrice: 8.5, description: 'promo' };

  it('404s when the product is missing', async () => {
    const { service, em, product } = build();
    product.findOne.mockResolvedValue(null);
    await expect(service.upsertOffer(em, 't', '789', dto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('409s when the product has no ERP external_id', async () => {
    const { service, em, product } = build();
    product.findOne.mockResolvedValue({ externalId: null });
    await expect(service.upsertOffer(em, 't', '789', dto)).rejects.toThrow(
      ConflictException,
    );
  });

  it('502s when the ERP write fails (offer_book untouched)', async () => {
    const { service, em, product, offer, a7 } = build();
    product.findOne.mockResolvedValue({ externalId: '55' });
    (a7.upsertOffer as jest.Mock).mockRejectedValue(new Error('timeout'));
    await expect(service.upsertOffer(em, 't', '789', dto)).rejects.toThrow(
      BadGatewayException,
    );
    expect(offer.upsert).not.toHaveBeenCalled();
  });

  it('upserts the offer on the ERP then mirrors it locally', async () => {
    const { service, em, product, offer, a7 } = build();
    product.findOne.mockResolvedValue({ externalId: '55' });
    const out = await service.upsertOffer(em, 't', '789', dto);
    expect(a7.upsertOffer).toHaveBeenCalledWith(creds, 7, [
      { idEmbalagem: 55, precoOferta: 8.5 },
    ]);
    expect(offer.upsert).toHaveBeenCalledWith(
      {
        ean: '789',
        targetPrice: '8.5',
        externalId: '7',
        description: 'promo',
      },
      ['ean'],
    );
    expect(out).toEqual({ ean: '789', targetPrice: 8.5, cadernoId: 7 });
  });

  it('leaves description out of the upsert when the dto omits it', async () => {
    const { service, em, product, offer } = build();
    product.findOne.mockResolvedValue({ externalId: '55' });
    await service.upsertOffer(em, 't', '789', {
      cadernoId: 7,
      targetPrice: 8.5,
    });
    // No `description` key at all — the upsert must not clear the stored one.
    expect(offer.upsert).toHaveBeenCalledWith(
      { ean: '789', targetPrice: '8.5', externalId: '7' },
      ['ean'],
    );
  });
});

describe('CatalogMutationService.removeOffer', () => {
  it('404s when there is no local offer', async () => {
    const { service, em, offer } = build();
    offer.findOne.mockResolvedValue(null);
    await expect(service.removeOffer(em, 't', '789')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('409s when the product has no ERP external_id', async () => {
    const { service, em, offer, product } = build();
    offer.findOne.mockResolvedValue({ externalId: '7' });
    product.findOne.mockResolvedValue({ externalId: null });
    await expect(service.removeOffer(em, 't', '789')).rejects.toThrow(
      ConflictException,
    );
  });

  it('502s when the ERP write fails (local offer kept)', async () => {
    const { service, em, offer, product, a7 } = build();
    offer.findOne.mockResolvedValue({ externalId: '7' });
    product.findOne.mockResolvedValue({ externalId: '55' });
    (a7.upsertOffer as jest.Mock).mockRejectedValue(new Error('timeout'));
    await expect(service.removeOffer(em, 't', '789')).rejects.toThrow(
      BadGatewayException,
    );
    expect(offer.delete).not.toHaveBeenCalled();
  });

  it('clears the offer on the ERP (precoOferta=null) then deletes locally', async () => {
    const { service, em, offer, product, a7 } = build();
    offer.findOne.mockResolvedValue({ externalId: '7' });
    product.findOne.mockResolvedValue({ externalId: '55' });
    const out = await service.removeOffer(em, 't', '789');
    expect(a7.upsertOffer).toHaveBeenCalledWith(creds, 7, [
      { idEmbalagem: 55, precoOferta: null },
    ]);
    expect(offer.delete).toHaveBeenCalledWith({ ean: '789' });
    expect(out).toEqual({ ean: '789', deleted: true });
  });
});

describe('CatalogMutationService.softDelete', () => {
  it('404s when the row is missing', async () => {
    const { service, em, product } = build();
    product.update.mockResolvedValue({ affected: 0 });
    await expect(service.softDelete(em, '789')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('flips active=false and reports deleted', async () => {
    const { service, em, product } = build();
    product.update.mockResolvedValue({ affected: 1 });
    expect(await service.softDelete(em, '789')).toEqual({
      ean: '789',
      deleted: true,
    });
    expect(product.update).toHaveBeenCalledWith(
      { ean: '789' },
      { active: false },
    );
  });
});
