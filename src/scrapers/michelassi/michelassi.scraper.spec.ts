import { HttpService } from '@nestjs/axios';
import { MichelassiScraper, mapProduct } from './michelassi.scraper';
import type { MichelassiProduct } from './types';

describe('mapProduct', () => {
  it('maps full product with image URL', () => {
    const out = mapProduct('7891', {
      name: 'Sabonete',
      brand: 'Dove',
      description: 'Sabonete em barra',
      min_price_valid: 4.5,
      erp_internal_code: '999',
      images: ['abc123'],
    });
    expect(out).toEqual({
      ean: '7891',
      origin: 'MICHELASSI',
      found: true,
      name: 'Sabonete',
      brand: 'Dove',
      sku: '999',
      price: '4.5',
      metadata: {
        description: 'Sabonete em barra',
        image: 'https://ibassets.com.br/ib.item.image.large/l-abc123.jpeg',
      },
    });
  });

  it('returns null price when min_price_valid missing', () => {
    expect(mapProduct('7891', {}).price).toBeNull();
  });
});

describe('MichelassiScraper.scrapeProduct', () => {
  const buildHttp = (products: MichelassiProduct[]): HttpService =>
    ({
      axiosRef: {
        get: jest.fn().mockResolvedValue({ data: { data: products } }),
      },
    }) as unknown as HttpService;

  it('skips full-text hits whose bar_codes do not include the EAN', async () => {
    const out = await new MichelassiScraper(
      buildHttp([
        { name: 'Errado', bar_codes: ['111'] },
        { name: 'Certo', bar_codes: ['7891'] },
      ]),
    ).scrapeProduct('7891');
    expect(out.found).toBe(true);
    expect(out.name).toBe('Certo');
  });

  it('falls back to the first hit when bar_codes is absent', async () => {
    const out = await new MichelassiScraper(
      buildHttp([{ name: 'Sem código' }]),
    ).scrapeProduct('7891');
    expect(out.found).toBe(true);
    expect(out.name).toBe('Sem código');
  });

  it('returns found=false when no hit matches the EAN', async () => {
    const out = await new MichelassiScraper(
      buildHttp([{ name: 'Errado', bar_codes: ['111'] }]),
    ).scrapeProduct('7891');
    expect(out).toEqual({ ean: '7891', origin: 'MICHELASSI', found: false });
  });
});
