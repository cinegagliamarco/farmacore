import { AxiosError } from 'axios';
import { isRateLimited, mapProduct } from './michelassi.scraper';

describe('isRateLimited', () => {
  it('returns true for AxiosError with 429', () => {
    const err = new AxiosError('rate', '429');
    err.response = { status: 429 } as AxiosError['response'];
    expect(isRateLimited(err)).toBe(true);
  });

  it('returns false for AxiosError with other status', () => {
    const err = new AxiosError('boom', '500');
    err.response = { status: 500 } as AxiosError['response'];
    expect(isRateLimited(err)).toBe(false);
  });

  it('returns false for non-axios errors', () => {
    expect(isRateLimited(new Error('not axios'))).toBe(false);
    expect(isRateLimited('string')).toBe(false);
  });
});

describe('mapProduct', () => {
  it('maps full product with image URL + stock metadata', () => {
    const out = mapProduct('7891', {
      name: 'Sabonete',
      brand: 'Dove',
      description: 'Sabonete em barra',
      min_price_valid: 4.5,
      erp_internal_code: '999',
      images: ['abc123'],
      available_stock: true,
      stock_infos: { stock_balance: 50 },
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
        stockBalance: 50,
        availableStock: true,
      },
    });
  });

  it('defaults stockBalance to 0 and availableStock to false', () => {
    const out = mapProduct('7891', { name: 'X' });
    expect(out.metadata?.stockBalance).toBe(0);
    expect(out.metadata?.availableStock).toBe(false);
  });

  it('returns null price when min_price_valid missing', () => {
    expect(mapProduct('7891', {}).price).toBeNull();
  });
});
