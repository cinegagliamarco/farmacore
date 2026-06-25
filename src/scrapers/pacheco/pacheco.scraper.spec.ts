import { HttpService } from '@nestjs/axios';
import { mapProduct, PachecoScraper } from './pacheco.scraper';
import type { PachecoProduct } from './types';

const fullProduct: PachecoProduct = {
  productName: 'Dipirona',
  brand: 'EMS',
  productReferenceCode: '99887',
  description: '<p>Analgésico</p>',
  items: [
    {
      images: [{ imageUrl: 'https://x/img.jpg' }],
      sellers: [
        {
          commertialOffer: {
            Price: 12.5,
            IsAvailable: true,
            PromotionTeasers: [{ Name: 'Leve 3 pague 2' }],
          },
        },
      ],
    },
  ],
};

describe('mapProduct (Pacheco)', () => {
  it('maps every field from a complete product', () => {
    expect(mapProduct('7891', fullProduct)).toEqual({
      ean: '7891',
      origin: 'PACHECO',
      found: true,
      name: 'Dipirona',
      brand: 'EMS',
      sku: '99887',
      price: '12.5',
      metadata: {
        description: 'Analgésico',
        image: 'https://x/img.jpg',
        observation: 'Leve 3 pague 2',
        availableStock: true,
      },
    });
  });

  it('returns found=false when there is no commercial offer', () => {
    expect(mapProduct('7891', { items: [{ sellers: [{}] }] })).toEqual({
      ean: '7891',
      origin: 'PACHECO',
      found: false,
    });
  });

  it('defaults availableStock to false when IsAvailable is absent', () => {
    const out = mapProduct('7891', {
      items: [{ sellers: [{ commertialOffer: { Price: 9 } }] }],
    });
    expect(out.metadata?.availableStock).toBe(false);
  });

  it('strips HTML and leaves undefined when description is empty', () => {
    const out = mapProduct('7891', {
      ...fullProduct,
      description: '<p></p>',
    });
    expect(out.metadata?.description).toBeUndefined();
  });

  it('returns null price when Price is missing or non-finite', () => {
    const out = mapProduct('7891', {
      items: [{ sellers: [{ commertialOffer: {} }] }],
    });
    expect(out.price).toBeNull();
  });

  it('falls back to the RefId entry (by key, not position) when productReferenceCode is absent', () => {
    const out = mapProduct('7891', {
      ...fullProduct,
      productReferenceCode: undefined,
      items: [
        {
          ...fullProduct.items![0],
          referenceId: [
            { Key: 'SellerId', Value: 'ignore-me' },
            { Key: 'RefId', Value: '374598' },
          ],
        },
      ],
    });
    expect(out.sku).toBe('374598');
  });

  it('prefers productReferenceCode over the item RefId when both are present', () => {
    const out = mapProduct('7891', {
      ...fullProduct,
      items: [
        {
          ...fullProduct.items![0],
          referenceId: [{ Key: 'RefId', Value: '374598' }],
        },
      ],
    });
    expect(out.sku).toBe('99887');
  });

  it('returns null sku when neither productReferenceCode nor a RefId entry exists', () => {
    const out = mapProduct('7891', {
      ...fullProduct,
      productReferenceCode: undefined,
      items: [
        {
          ...fullProduct.items![0],
          referenceId: [{ Key: 'SellerId', Value: 'x' }],
        },
      ],
    });
    expect(out.sku).toBeNull();
  });
});

describe('PachecoScraper.scrapeProduct', () => {
  const buildHttp = (data: unknown): HttpService =>
    ({
      axiosRef: { get: jest.fn().mockResolvedValue({ data }) },
    }) as unknown as HttpService;

  it('returns found=false when the catalog returns no hits', async () => {
    const out = await new PachecoScraper(buildHttp([])).scrapeProduct('7891');
    expect(out).toEqual({ ean: '7891', origin: 'PACHECO', found: false });
  });

  it('returns found=false with error on network failure', async () => {
    const http = {
      axiosRef: { get: jest.fn().mockRejectedValue(new Error('ECONNRESET')) },
    } as unknown as HttpService;
    const out = await new PachecoScraper(http).scrapeProduct('7891');
    expect(out).toEqual({
      ean: '7891',
      origin: 'PACHECO',
      found: false,
      error: 'ECONNRESET',
    });
  });

  it('maps the first product when the catalog returns a hit', async () => {
    const out = await new PachecoScraper(
      buildHttp([fullProduct]),
    ).scrapeProduct('7891');
    expect(out.found).toBe(true);
    expect(out.sku).toBe('99887');
  });
});
