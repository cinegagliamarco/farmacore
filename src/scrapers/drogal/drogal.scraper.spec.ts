import { HttpService } from '@nestjs/axios';
import { DrogalScraper, detectPbm } from './drogal.scraper';
import type { DrogalProduct } from './types';

describe('detectPbm', () => {
  it('returns isPbm=true and divides pbmPrice by 100', () => {
    const product = {
      CustomData: [JSON.stringify({ pbmPrice: 1599 })],
    } as DrogalProduct;
    expect(detectPbm(product)).toEqual({
      isPbm: true,
      pbmPrice: 15.99,
      van: null,
    });
  });

  it('returns isPbm=true with pbmPrice=0 when only PBM[] is set', () => {
    const product = { PBM: ['x'] } as DrogalProduct;
    expect(detectPbm(product)).toEqual({
      isPbm: true,
      pbmPrice: 0,
      van: null,
    });
  });

  it('returns isPbm=false when nothing is set', () => {
    expect(detectPbm({} as DrogalProduct)).toEqual({
      isPbm: false,
      pbmPrice: 0,
      van: null,
    });
  });

  it('captures VAN[0] regardless of PBM state', () => {
    expect(detectPbm({ VAN: ['VANCODE-1'] } as DrogalProduct).van).toBe(
      'VANCODE-1',
    );
  });

  it('ignores non-JSON CustomData entries', () => {
    const product = {
      CustomData: ['{broken', JSON.stringify({ pbmPrice: 500 })],
    } as DrogalProduct;
    expect(detectPbm(product).pbmPrice).toBe(5);
  });
});

describe('DrogalScraper.scrapeProduct', () => {
  const buildHttp = (handler: (url: string) => unknown): HttpService =>
    ({
      axiosRef: {
        get: jest
          .fn()
          .mockImplementation((url: string) =>
            Promise.resolve({ data: handler(url) }),
          ),
      },
    }) as unknown as HttpService;

  it('returns found=false when the catalog returns no hits', async () => {
    const scraper = new DrogalScraper(buildHttp(() => []));
    const out = await scraper.scrapeProduct('7891');
    expect(out.found).toBe(false);
    expect(out.error).toBeUndefined();
  });

  it('returns found=false with error on network failure', async () => {
    const http = {
      axiosRef: {
        get: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
      },
    } as unknown as HttpService;
    const out = await new DrogalScraper(http).scrapeProduct('7891');
    expect(out.found).toBe(false);
    expect(out.error).toBe('ECONNRESET');
  });

  it('maps product fields and pulls measures from variations', async () => {
    const scraper = new DrogalScraper(
      buildHttp((url) => {
        if (url.includes('/products/search')) {
          return [
            {
              productId: '11',
              productName: 'Aspirina',
              productReferenceCode: '12345',
              brand: 'Bayer',
              description: '<p>Anti-inflamatório</p>',
              items: [
                {
                  sellers: [
                    {
                      commertialOffer: {
                        Price: 9.9,
                        PromotionTeasers: [{ Name: '3 por 25' }],
                      },
                    },
                  ],
                  images: [{ imageUrl: 'https://x/img.jpg' }],
                },
              ],
            } as DrogalProduct,
          ];
        }
        if (url.includes('/products/variations/')) {
          return {
            skus: [
              {
                measures: {
                  cubicweight: 0.5,
                  height: 4,
                  length: 6,
                  weight: 0.1,
                  width: 2,
                },
              },
            ],
          };
        }
        return null;
      }),
    );
    const out = await scraper.scrapeProduct('7891');
    expect(out).toEqual({
      ean: '7891',
      origin: 'DROGAL',
      found: true,
      name: 'Aspirina',
      brand: 'Bayer',
      sku: '12345',
      price: '9.9',
      weight: '0.1',
      height: '4',
      length: '6',
      width: '2',
      metadata: {
        description: 'Anti-inflamatório',
        image: 'https://x/img.jpg',
        observation: '3 por 25',
        cubicWeight: 0.5,
        isPbm: false,
        van: null,
      },
    });
  });
});
