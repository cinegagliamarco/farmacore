import { Injectable } from '@nestjs/common';
import { PreviewProductResult } from '../dto/offer-book-rules-body.dto';

@Injectable()
export class CsvGeneratorService {
  public generatePreviewCsv(products: PreviewProductResult[]): string {
    const headers = [
      'EAN',
      'Nome do Produto',
      'Classificação',
      'Preço Base de Venda',
      'Preço Base da Oferta',
      'Preço Atual',
      'Margem Atual (%)',
      'Custo',
      'Tipo de Ação',
      'Percentual da Regra (%)',
      'Percentual Aplicado (%)',
      'Preço Final',
      'Nova Margem (%)',
      'Trava de Margem Aplicada',
      'Desconto Ignorado',
      'Ignorado (Sem Preço Competidor)',
      'Ignorado (Preço Excede Limite)',
      'Arredondamento Aplicado'
    ];

    const rows = products.map((product) => [
      this.escapeCsvValue(product.ean),
      this.escapeCsvValue(product.name),
      this.escapeCsvValue(product.classification),
      this.formatNumber(product.baseSalePrice),
      this.formatNumber(product.baseOfferPrice),
      this.formatNumber(product.currentPrice),
      this.formatNumber(product.currentMargin),
      this.formatNumber(product.cost),
      this.escapeCsvValue(product.actionType || ''),
      this.formatNumber(product.percentageValue),
      this.formatNumber(product.appliedPercentageValue),
      this.formatNumber(product.finalPrice),
      this.formatNumber(product.newMargin),
      this.formatBoolean(product.priceLockApplied),
      this.formatBoolean(product.discountSkipped),
      this.formatBoolean(product.skippedNoCompetitorPrice),
      this.formatBoolean(product.skippedPriceExceedsLimit),
      this.formatBoolean(product.priceRoundingApplied)
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    return csvContent;
  }

  private escapeCsvValue(value: string | number | null | undefined): string {
    if (value === null || value === undefined) {
      return '';
    }

    const stringValue = String(value);

    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
  }

  private formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '';
    }

    return String(value);
  }

  private formatBoolean(value: boolean): string {
    return value ? 'Sim' : 'Não';
  }
}
