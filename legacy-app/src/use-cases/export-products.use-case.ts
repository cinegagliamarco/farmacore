import { Injectable } from '@nestjs/common';
import { ProductExportRow, ProductRepository } from '../database/repositories/product.repository';
import { EXPORT_COLUMNS } from '../common/constants/export-columns.constant';

@Injectable()
export class ExportProductsUseCase {
  constructor(private readonly productRepository: ProductRepository) {}

  public async execute(columns?: string[]): Promise<string> {
    try {
      const records = await this.productRepository.findProductsToExport();
      if (!records?.length) return;

      return this.convertToCSV(records, columns);
    } catch (error) {
      console.error('Error exporting CSV:', error);
    }
  }

  private convertToCSV(results: ProductExportRow[], columns?: string[]): string {
    const allColumns = EXPORT_COLUMNS;

    // Use provided columns or fall back to all columns
    const selectedColumns = columns?.length ? columns.filter(col => allColumns.includes(col as any)) : allColumns;
    
    // If no valid columns provided, use all columns
    const header = selectedColumns.length ? selectedColumns : allColumns;

    const rows = results.map((r) => {
      const rowData = selectedColumns.map(col => {
        let value: any;
        
        switch (col) {
          case 'ean':
            value = r.ean;
            break;
          case 'name':
            value = r.name ?? '';
            break;
          case 'curve':
            value = r.curve ?? '';
            break;
          case 'book':
            value = r.book ?? '';
            break;
          case 'price':
            value = (r.price ?? '').toString().replaceAll('.', ',');
            break;
          case 'description':
            value = r.description ?? '';
            break;
          case 'average_unit_cost':
            value = (r.average_unit_cost ?? '').toString().replaceAll('.', ',');
            break;
          case 'unit_sale_price':
            value = (r.unit_sale_price ?? '').toString().replaceAll('.', ',');
            break;
          case 'drogal_name':
            value = r.drogal_name ?? '';
            break;
          case 'drogasil_name':
            value = r.drogasil_name ?? '';
            break;
          case 'pague_menos_name':
            value = r.pague_menos_name ?? '';
            break;
          case 'ikesaki_name':
            value = r.ikesaki_name ?? '';
            break;
          case 'michelassi_name':
            value = r.michelassi_name ?? '';
            break;
          case 'drogasil_category':
            value = r.drogasil_category ?? '';
            break;
          case 'drogasil_weight':
            value = (r.drogasil_weight ?? '').toString().replaceAll('.', ',');
            break;
          case 'drogal_price':
            value = (r.drogal_price ?? '').toString().replaceAll('.', ',');
            break;
          case 'drogasil_price':
            value = (r.drogasil_price ?? '').toString().replaceAll('.', ',');
            break;
          case 'pague_menos_price':
            value = (r.pague_menos_price ?? '').toString().replaceAll('.', ',');
            break;
          case 'ikesaki_price':
            value = (r.ikesaki_price ?? '').toString().replaceAll('.', ',');
            break;
          case 'michelassi_price':
            value = (r.michelassi_price ?? '').toString().replaceAll('.', ',');
            break;
          case 'drogal_observation':
            value = r.drogal_observation ?? '';
            break;
          case 'drogasil_observation':
            value = r.drogasil_observation ?? '';
            break;
          case 'pague_menos_observation':
            value = r.pague_menos_observation ?? '';
            break;
          case 'ikesaki_observation':
            value = r.ikesaki_observation ?? '';
            break;
          case 'drogal_one_stock':
            value = r.drogal_subsidiary_one_stock ?? 0;
            break;
          case 'drogasil_one_stock':
            value = r.drogasil_subsidiary_one_stock ?? 0;
            break;
          case 'michelassi_one_stock':
            value = r.michelassi_subsidiary_one_stock ?? 0;
            break;
          case 'drogal_two_stock':
            value = r.drogal_subsidiary_two_stock ?? 0;
            break;
          case 'drogal_main_image':
            value = r.drogal_main_image ?? '';
            break;
          case 'drogasil_main_image':
            value = r.drogasil_main_image ?? '';
            break;
          case 'pague_menos_main_image':
            value = r.pague_menos_main_image ?? '';
            break;
          case 'ikesaki_main_image':
            value = r.ikesaki_main_image ?? '';
            break;
          case 'michelassi_main_image':
            value = r.michelassi_main_image ?? '';
            break;
          case 'drogal_images':
            value = r.drogal_images ?? '';
            break;
          case 'drogasil_images':
            value = r.drogasil_images ?? '';
            break;
          case 'pague_menos_images':
            value = r.pague_menos_images ?? '';
            break;
          case 'ikesaki_images':
            value = r.ikesaki_images ?? '';
            break;
          case 'base_product_images':
            value = r.base_product_images ?? '';
            break;
          case 'drogal_error':
            value = r.drogal_error ?? '';
            break;
          case 'drogasil_error':
            value = r.drogasil_error ?? '';
            break;
          case 'pague_menos_error':
            value = r.pague_menos_error ?? '';
            break;
          case 'ikesaki_error':
            value = r.ikesaki_error ?? '';
            break;
          case 'michelassi_error':
            value = r.michelassi_error ?? '';
            break;
          default:
            value = '';
        }
        
        return `"${String(value).replace(/"/g, '""')}"`;
      });
      
      return rowData.join(',');
    });

    return [header.join(','), ...rows].join('\n');
  }
}
