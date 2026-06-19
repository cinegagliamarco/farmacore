import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OfferBookEntity } from '../../database/entities/tenant/offer-book.entity';
import { ProductEntity as TenantProductEntity } from '../../database/entities/tenant/product.entity';
import { A7PharmaApiClient } from '../../integration/a7-pharma-api.client';
import { IntegrationConnectionService } from '../../integration/integration-connection.service';
import { UpdateProductDto, UpsertOfferDto } from './dto/update-product.dto';

const EDITABLE: ReadonlyArray<keyof UpdateProductDto> = [
  'name',
  'active',
  'monitored',
  'generic',
  'supplier',
  'description',
  'activeIngredient',
  'cost',
  'averageUnitCost',
  'unitSalePrice',
  'classificationId',
];

/**
 * Tenant catalog mutations. Runs on the request's tenant-scoped
 * EntityManager. Price changes also push to the tenant's A7Pharma REST
 * API (write-back); reads/field-edits stay in the tenant DB.
 */
@Injectable()
export class CatalogMutationService {
  constructor(
    private readonly integration: IntegrationConnectionService,
    private readonly a7: A7PharmaApiClient,
  ) {}

  public async updateProduct(
    em: EntityManager,
    ean: string,
    dto: UpdateProductDto,
  ): Promise<{ ean: string; updated: number }> {
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('no editable fields provided');
    }
    const res = await em
      .getRepository(TenantProductEntity)
      .update({ ean }, patch);
    if (!res.affected) throw new NotFoundException(`product ${ean} not found`);
    return { ean, updated: res.affected };
  }

  /** Push the new sell price to the ERP (source of truth), then mirror it
   *  locally. 409 if the product is monitored, lacks an ERP id, or the
   *  tenant has no A7Pharma API configured. */
  public async updatePrice(
    em: EntityManager,
    tenantSlug: string,
    ean: string,
    newPrice: number,
  ): Promise<{ ean: string; price: number }> {
    const repo = em.getRepository(TenantProductEntity);
    const product = await repo.findOne({ where: { ean } });
    if (!product) throw new NotFoundException(`product ${ean} not found`);
    if (product.monitored) {
      throw new ConflictException('product is monitored; price is locked');
    }
    if (!product.externalId) {
      throw new ConflictException('product has no ERP external_id');
    }
    const creds = await this.integration.getApiCredentials(tenantSlug);
    if (!creds) {
      throw new ConflictException(
        'A7Pharma API not configured for this tenant',
      );
    }
    await this.a7.changePrices(creds, [
      { idEmbalagem: Number(product.externalId), precoVendaNovo: newPrice },
    ]);
    await repo.update({ ean }, { price: String(newPrice) });
    return { ean, price: newPrice };
  }

  /** Upsert an offer (precoOferta) into the product's caderno on the ERP,
   *  then mirror it in tenant.offer_book. 409 if the product lacks an ERP id
   *  or the tenant has no A7Pharma API configured. */
  public async upsertOffer(
    em: EntityManager,
    tenantSlug: string,
    ean: string,
    dto: UpsertOfferDto,
  ): Promise<{ ean: string; targetPrice: number; cadernoId: number }> {
    const product = await em
      .getRepository(TenantProductEntity)
      .findOne({ where: { ean } });
    if (!product) throw new NotFoundException(`product ${ean} not found`);
    if (!product.externalId) {
      throw new ConflictException('product has no ERP external_id');
    }
    const creds = await this.integration.getApiCredentials(tenantSlug);
    if (!creds) {
      throw new ConflictException(
        'A7Pharma API not configured for this tenant',
      );
    }
    await this.a7.upsertOffer(creds, dto.cadernoId, [
      {
        idEmbalagem: Number(product.externalId),
        precoOferta: dto.targetPrice,
      },
    ]);
    await em.getRepository(OfferBookEntity).upsert(
      {
        ean,
        targetPrice: String(dto.targetPrice),
        externalId: String(dto.cadernoId),
        description: dto.description ?? null,
      },
      ['ean'],
    );
    return { ean, targetPrice: dto.targetPrice, cadernoId: dto.cadernoId };
  }

  /** Remove the product's offer from its caderno on the ERP (precoOferta=null),
   *  then drop the local offer_book row. */
  public async removeOffer(
    em: EntityManager,
    tenantSlug: string,
    ean: string,
  ): Promise<{ ean: string; deleted: boolean }> {
    const offer = await em
      .getRepository(OfferBookEntity)
      .findOne({ where: { ean } });
    if (!offer) throw new NotFoundException(`offer for ${ean} not found`);
    const product = await em
      .getRepository(TenantProductEntity)
      .findOne({ where: { ean } });
    if (!product?.externalId) {
      throw new ConflictException('product has no ERP external_id');
    }
    if (!offer.externalId) {
      throw new ConflictException('offer has no caderno id');
    }
    const creds = await this.integration.getApiCredentials(tenantSlug);
    if (!creds) {
      throw new ConflictException(
        'A7Pharma API not configured for this tenant',
      );
    }
    await this.a7.upsertOffer(creds, Number(offer.externalId), [
      { idEmbalagem: Number(product.externalId), precoOferta: null },
    ]);
    await em.getRepository(OfferBookEntity).delete({ ean });
    return { ean, deleted: true };
  }

  public async softDelete(
    em: EntityManager,
    ean: string,
  ): Promise<{ ean: string; deleted: boolean }> {
    const res = await em
      .getRepository(TenantProductEntity)
      .update({ ean }, { active: false });
    if (!res.affected) throw new NotFoundException(`product ${ean} not found`);
    return { ean, deleted: true };
  }
}
