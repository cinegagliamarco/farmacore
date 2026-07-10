import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/enums/user-role.enum';
import { SystemAdminGuard } from '../admin/guards/system-admin.guard';
import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';
import {
  ProductDetailsView,
  ProductExportResult,
  ProductsService,
} from './products.service';

const MAX_EXPORT_LIMIT = 1000;
const DEFAULT_EXPORT_LIMIT = 100;

/**
 * System-admin operations on the GLOBAL shared catalog (live single-EAN
 * import, bulk export). Not tenant data — kept under /admin so the tenant
 * surface (/products/*) is purely a tenant's own catalog.
 */
@Controller('admin/catalog/products')
@UseGuards(SystemAdminGuard)
@Roles(UserRole.ADMIN)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /**
   * Bulk export of the shared competitor catalog (product + primary image),
   * optionally filtered by origin, paginated. JWT-guarded, not
   * tenant-scoped.
   */
  @Get('export')
  public export(
    @Query('origin') origin?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ProductExportResult> {
    return this.products.export({
      origin: this.parseOrigin(origin),
      limit: this.clamp(limit, DEFAULT_EXPORT_LIMIT, 1, MAX_EXPORT_LIMIT),
      offset: this.clamp(offset, 0, 0, Number.MAX_SAFE_INTEGER),
    });
  }

  /**
   * Live-scrape every competitor origin for one EAN, persist into
   * shared_catalog, and return the merged cross-origin view. JWT-guarded
   * (global guard); not tenant-scoped — the shared catalog is global.
   */
  @Post(':ean/import')
  public import(@Param('ean') ean: string): Promise<ProductDetailsView> {
    // ≤14 digits: GTIN-14 is the widest EAN/GTIN format — anything longer
    // is not a barcode (bigint itself would fit up to 18 digits).
    if (!/^\d{1,14}$/.test(ean)) {
      throw new BadRequestException('ean must be numeric (up to 14 digits)');
    }
    return this.products.importProduct(ean);
  }

  private parseOrigin(origin?: string): CompetitorOrigin | undefined {
    if (!origin) return undefined;
    const values = Object.values(CompetitorOrigin) as string[];
    if (!values.includes(origin)) {
      throw new BadRequestException(`unknown origin "${origin}"`);
    }
    return origin as CompetitorOrigin;
  }

  private clamp(
    raw: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(Math.trunc(n), min), max);
  }
}
