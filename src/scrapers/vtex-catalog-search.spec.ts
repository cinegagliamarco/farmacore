import { HttpService } from '@nestjs/axios';
import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';
import { IndianaScraper } from './indiana/indiana.scraper';
import {
  buildMultiEanSearchUrl,
  mapVtexProduct,
  mapVtexProductsToScrapes,
  type VtexCatalogProduct,
} from './vtex-catalog-search';

const fullProduct: VtexCatalogProduct = {
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
            PromotionTeasers: [{ Name: 'Leve 3 pague 2' }],
          },
        },
      ],
    },
  ],
};

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

describe('mapVtexProduct', () => {
  it('maps every field from a complete product', () => {
    expect(
      mapVtexProduct('7891', fullProduct, CompetitorOrigin.INDIANA),
    ).toEqual({
      ean: '7891',
      origin: 'INDIANA',
      found: true,
      name: 'Dipirona',
      brand: 'EMS',
      sku: '99887',
      price: '12.5',
      metadata: {
        description: 'Analgésico',
        image: 'https://x/img.jpg',
        observation: 'Leve 3 pague 2',
      },
    });
  });

  it('returns found=false when there is no commercial offer', () => {
    expect(
      mapVtexProduct(
        '7891',
        { items: [{ sellers: [{}] }] },
        CompetitorOrigin.VENANCIO,
      ),
    ).toEqual({ ean: '7891', origin: 'VENANCIO', found: false });
  });

  it('strips HTML and leaves undefined when description is empty', () => {
    const out = mapVtexProduct(
      '7891',
      { ...fullProduct, description: '<p></p>' },
      CompetitorOrigin.IKESAKI,
    );
    expect(out.metadata?.description).toBeUndefined();
  });

  it('returns null price when Price is missing or non-finite', () => {
    const out = mapVtexProduct(
      '7891',
      { items: [{ sellers: [{ commertialOffer: {} }] }] },
      CompetitorOrigin.PAGUE_MENOS,
    );
    expect(out.price).toBeNull();
  });

  it('falls back to the RefId entry (by key, not position) when productReferenceCode is absent', () => {
    const out = mapVtexProduct(
      '7891',
      {
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
      },
      CompetitorOrigin.PACHECO,
    );
    expect(out.sku).toBe('374598');
  });

  it('prefers productReferenceCode over the item RefId when both are present', () => {
    const out = mapVtexProduct(
      '7891',
      {
        ...fullProduct,
        items: [
          {
            ...fullProduct.items![0],
            referenceId: [{ Key: 'RefId', Value: '374598' }],
          },
        ],
      },
      CompetitorOrigin.SAO_PAULO,
    );
    expect(out.sku).toBe('99887');
  });

  it('returns null sku when neither productReferenceCode nor a RefId entry exists', () => {
    const out = mapVtexProduct(
      '7891',
      {
        ...fullProduct,
        productReferenceCode: undefined,
        items: [
          {
            ...fullProduct.items![0],
            referenceId: [{ Key: 'SellerId', Value: 'x' }],
          },
        ],
      },
      CompetitorOrigin.PACHECO,
    );
    expect(out.sku).toBeNull();
  });
});

describe('mapVtexProductsToScrapes', () => {
  it('maps products by items[].ean (VTEX catalog_system)', () => {
    const products: VtexCatalogProduct[] = [
      {
        ...fullProduct,
        productName: 'A',
        items: [{ ...fullProduct.items![0], ean: '111' }],
      },
      {
        ...fullProduct,
        productName: 'B',
        items: [{ ...fullProduct.items![0], ean: '222' }],
      },
    ];
    const out = mapVtexProductsToScrapes(
      ['111', '222', '333'],
      products,
      CompetitorOrigin.INDIANA,
    );
    expect(out[0].name).toBe('A');
    expect(out[1].name).toBe('B');
    expect(out[2].found).toBe(false);
  });

  it('maps products by EAN in referenceId', () => {
    const products: VtexCatalogProduct[] = [
      {
        ...fullProduct,
        productName: 'A',
        items: [
          {
            ...fullProduct.items![0],
            referenceId: [{ Key: 'EAN', Value: '111' }],
          },
        ],
      },
      {
        ...fullProduct,
        productName: 'B',
        items: [
          {
            ...fullProduct.items![0],
            referenceId: [{ Key: 'EAN', Value: '222' }],
          },
        ],
      },
    ];
    const out = mapVtexProductsToScrapes(
      ['111', '222', '333'],
      products,
      CompetitorOrigin.INDIANA,
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
    const out = mapVtexProductsToScrapes(
      ['7891'],
      [{ ...fullProduct, productName: 'Solo' }],
      CompetitorOrigin.INDIANA,
    );
    expect(out[0].found).toBe(true);
    expect(out[0].name).toBe('Solo');
  });
});

// One representative VTEX-simple scraper; the other five differ only in
// origin and catalog URL.
describe('IndianaScraper.scrapeProduct', () => {
  const buildHttp = (data: unknown): HttpService =>
    ({
      axiosRef: { get: jest.fn().mockResolvedValue({ data }) },
    }) as unknown as HttpService;

  it('returns found=false when the catalog returns no hits', async () => {
    const out = await new IndianaScraper(buildHttp([])).scrapeProduct('7891');
    expect(out).toEqual({ ean: '7891', origin: 'INDIANA', found: false });
  });

  it('returns found=false with error on network failure', async () => {
    const http = {
      axiosRef: { get: jest.fn().mockRejectedValue(new Error('EAI_AGAIN')) },
    } as unknown as HttpService;
    const out = await new IndianaScraper(http).scrapeProduct('7891');
    expect(out).toEqual({
      ean: '7891',
      origin: 'INDIANA',
      found: false,
      error: 'EAI_AGAIN',
    });
  });

  it('maps the first product when the catalog returns a hit', async () => {
    const out = await new IndianaScraper(
      buildHttp([fullProduct]),
    ).scrapeProduct('7891');
    expect(out.found).toBe(true);
    expect(out.sku).toBe('99887');
  });
});
