import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  BaseProductAdminRow,
  BaseProductRepository,
} from '../database/repositories/shared-catalog/base-product.repository';
import {
  ListBaseProductsQueryDto,
  UpdateBaseProductDto,
} from './dto/base-products-admin.dto';

const DEFAULT_PER_PAGE = 50;

/**
 * Curadoria do cadastro interno (shared_catalog.base_product) — o
 * relacionamento EAN ↔ princípio ativo é responsabilidade NOSSA, não do
 * ERP dos tenants: o sync semeia a linha (sem princípio ativo) e tudo o
 * que os tenants leem cruza por EAN com o que foi curado aqui.
 */
@Injectable()
export class BaseProductsAdminService {
  private readonly repo: BaseProductRepository;

  constructor(dataSource: DataSource) {
    this.repo = new BaseProductRepository(dataSource.manager);
  }

  public async list(q: ListBaseProductsQueryDto): Promise<{
    rows: BaseProductAdminRow[];
    count: number;
    page: number;
    perPage: number;
  }> {
    const page = q.page ?? 1;
    const perPage = q.perPage ?? DEFAULT_PER_PAGE;
    const { rows, count } = await this.repo.search({
      search: q.search,
      missingActiveIngredient: q.missingActiveIngredient === 'true',
      generic: q.generic === undefined ? undefined : q.generic === 'true',
      limit: perPage,
      offset: (page - 1) * perPage,
    });
    return { rows, count, page, perPage };
  }

  public async update(
    ean: string,
    dto: UpdateBaseProductDto,
  ): Promise<{ ean: string; updated: number }> {
    const patch: Parameters<BaseProductRepository['updateIdentityByEan']>[1] =
      {};
    if (dto.activeIngredient !== undefined) {
      patch.activeIngredient = dto.activeIngredient?.trim() || null;
    }
    if (dto.generic !== undefined) patch.generic = dto.generic;
    if (dto.description !== undefined) {
      patch.description = dto.description?.trim() || null;
    }
    for (const dim of ['weight', 'height', 'length', 'width'] as const) {
      if (dto[dim] !== undefined) patch[dim] = dto[dim]?.toString() ?? null;
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('no editable fields provided');
    }
    const updated = await this.repo.updateIdentityByEan(ean, patch);
    if (!updated) throw new NotFoundException(`base product ${ean} not found`);
    return { ean, updated };
  }

  public activeIngredients(): Promise<Array<{ name: string; eans: number }>> {
    return this.repo.listActiveIngredients();
  }

  public async rename(
    from: string,
    to: string,
  ): Promise<{ from: string; to: string; updated: number }> {
    const source = from.trim();
    const target = to.trim();
    // @Length(1,255) conta espaços — sem isto, '  ' viraria '' em massa.
    if (!source || !target) {
      throw new BadRequestException('from/to must not be blank');
    }
    const updated = await this.repo.renameActiveIngredient(source, target);
    if (!updated) {
      throw new NotFoundException(`no base product with "${source}"`);
    }
    return { from: source, to: target, updated };
  }
}
