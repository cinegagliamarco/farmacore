import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';
import {
  buildMultiEanSearchUrl,
  mapVtexProductsToScrapes,
  type VtexCatalogProduct,
} from './vtex-catalog-search';

describe('buildMultiEanSearchUrl', () => {
  it('joins multiple fq params', () => {
    const url = buildMultiEanSearchUrl(
      'https://x.com/api/catalog_system/pub/products/search',
      ['7891', '7892'],
    );
    expect(url).toBe(
      'https://x.com/api/catalog_system/pub/products/search?fq=alternateIds_Ean:7891&fq=alternateIds_Ean:7892&_from=0&_to=1',
    );
  });

  it('adds _from/_to range for multi-EAN (VTEX default page is 10)', () => {
    const url = buildMultiEanSearchUrl(
      'https://x.com/api/catalog_system/pub/products/search',
      ['7891', '7892'],
    );
    expect(url).toContain('_from=0&_to=1');
  });
});

describe('mapVtexProductsToScrapes', () => {
  const mapProduct = (ean: string, p: VtexCatalogProduct) => ({
    ean,
    origin: CompetitorOrigin.INDIANA,
    found: true,
    name: p.productName ?? null,
  });

  it('maps products by items[].ean (VTEX catalog_system)', () => {
    const products: VtexCatalogProduct[] = [
      { productName: 'A', items: [{ ean: '111' }] },
      { productName: 'B', items: [{ ean: '222' }] },
    ];
    const out = mapVtexProductsToScrapes(
      ['111', '222', '333'],
      products,
      CompetitorOrigin.INDIANA,
      mapProduct,
    );
    expect(out[0].name).toBe('A');
    expect(out[1].name).toBe('B');
    expect(out[2].found).toBe(false);
  });

  it('maps products by EAN in referenceId', () => {
    const products: VtexCatalogProduct[] = [
      {
        productName: 'A',
        items: [{ referenceId: [{ Key: 'EAN', Value: '111' }] }],
      },
      {
        productName: 'B',
        items: [{ referenceId: [{ Key: 'EAN', Value: '222' }] }],
      },
    ];
    const out = mapVtexProductsToScrapes(
      ['111', '222', '333'],
      products,
      CompetitorOrigin.INDIANA,
      mapProduct,
    );
    expect(out[0].found).toBe(true);
    expect(out[0].name).toBe('A');
    expect(out[1].name).toBe('B');
    expect(out[2]).toEqual({
      ean: '333',
      origin: CompetitorOrigin.INDIANA,
      found: false,
    });
  });

  it('falls back to single-hit parity when referenceId lacks EAN', () => {
    const products: VtexCatalogProduct[] = [{ productName: 'Solo' }];
    const out = mapVtexProductsToScrapes(
      ['7891'],
      products,
      CompetitorOrigin.INDIANA,
      mapProduct,
    );
    expect(out[0]).toEqual({
      ean: '7891',
      origin: CompetitorOrigin.INDIANA,
      found: true,
      name: 'Solo',
    });
  });
});
