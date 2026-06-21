import {
  buildStockMap,
  consumeForPattern,
  detectPbm,
  DrogasilScraper,
  mapProduct,
} from './drogasil.scraper';
import type { DrogasilStockResponse } from './types';

const SKU_PATTERN = /<article[^>]*data-item-id="([^"]+)"[^>]*>/;

function streamFrom(parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i < parts.length) c.enqueue(enc.encode(parts[i++]));
      else c.close();
    },
  });
}

describe('detectPbm', () => {
  it('returns PBM via liveComposition.livePrice.type=PBM', () => {
    expect(
      detectPbm({
        liveComposition: { livePrice: { type: 'PBM', valueTo: 12.34 } },
      }),
    ).toEqual({ isPbm: true, pbmPrice: 12.34 });
  });

  it('falls back to pbm[] when livePrice type is not PBM', () => {
    expect(
      detectPbm({
        pbm: [{ products: [{ percentDiscountPbm: 10, valueSalePbm: 7.5 }] }],
      }),
    ).toEqual({ isPbm: true, pbmPrice: 7.5 });
  });

  it('skips pbm entries without positive discount or sale value', () => {
    expect(
      detectPbm({
        pbm: [{ products: [{ percentDiscountPbm: 0, valueSalePbm: 0 }] }],
      }),
    ).toEqual({ isPbm: false, pbmPrice: 0 });
  });

  it('returns no PBM when nothing is set', () => {
    expect(detectPbm({})).toEqual({
      isPbm: false,
      pbmPrice: 0,
    });
  });
});

describe('buildStockMap', () => {
  it('returns empty map on null / errors', () => {
    expect(buildStockMap(undefined).size).toBe(0);
    expect(buildStockMap({ errors: ['x'] }).size).toBe(0);
  });

  it('maps the first branch stocks by sku', () => {
    const data: DrogasilStockResponse = {
      data: {
        getNearbyStockByZipCode: [
          {
            stocks: [
              { sku: '111', quantity: 5 },
              { sku: '222', quantity: 0 },
            ],
          },
          { stocks: [{ sku: '111', quantity: 99 }] },
        ],
      },
    };
    const out = buildStockMap(data);
    expect(out.get('111')).toBe(5);
    expect(out.get('222')).toBe(0);
    expect(out.size).toBe(2);
  });
});

describe('consumeForPattern', () => {
  it('returns the capture group on first match', async () => {
    const out = await consumeForPattern(
      streamFrom(['<article data-item-id="SKU123">']),
      SKU_PATTERN,
      1 << 20,
    );
    expect(out).toBe('SKU123');
  });

  it('matches a pattern split across chunk boundaries', async () => {
    const out = await consumeForPattern(
      streamFrom(['<article data-item-', 'id="SKU9">rest']),
      SKU_PATTERN,
      1 << 20,
    );
    expect(out).toBe('SKU9');
  });

  it('returns null when the stream ends with no match', async () => {
    const out = await consumeForPattern(
      streamFrom(['<div>nenhum resultado</div>']),
      SKU_PATTERN,
      1 << 20,
    );
    expect(out).toBeNull();
  });

  it('returns null once the byte cap is exceeded', async () => {
    const out = await consumeForPattern(
      streamFrom(['x'.repeat(100), '<article data-item-id="LATE">']),
      SKU_PATTERN,
      50,
    );
    expect(out).toBeNull();
  });

  it('cancels the reader on exit', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('<article data-item-id="A">'));
      },
      cancel() {
        cancelled = true;
      },
    });
    await consumeForPattern(stream, SKU_PATTERN, 1 << 20);
    expect(cancelled).toBe(true);
  });
});

describe('scrapeStock error handling', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns zeroed items with an error on a non-2xx response', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('', { status: 503 }));
    const out = await new DrogasilScraper().scrapeStock([
      { ean: '789', sku: '42' },
    ]);
    expect(out[0]).toMatchObject({ ean: '789', quantity: 0 });
    expect(out[0].error).toContain('503');
  });
});

describe('mapProduct', () => {
  it('extracts brand/supplier/description from custom_attributes', () => {
    const out = mapProduct('7891', {
      sku: '99',
      name: 'Aspirina',
      price: 10,
      weight: 0.05,
      media_gallery_entries: [{ file: '/x.jpg' }],
      custom_attributes: [
        {
          attribute_code: 'description',
          value_string: ['<p>Anti-inflamatório</p>'],
        },
        { attribute_code: 'marca', value: [{ id: 1, label: 'Bayer' }] },
        { attribute_code: 'fabricante', value: [{ id: 2, label: 'EMS' }] },
      ],
    });
    expect(out.brand).toBe('Bayer');
    expect(out.supplier).toBe('EMS');
    expect(out.metadata?.description).toBe('Anti-inflamatório');
    expect(out.metadata?.image).toBe('/x.jpg');
    expect(out.name).toBe('Aspirina');
    expect(out.price).toBe('10');
    expect(out.weight).toBe('0.05');
  });

  it('prefers price_aux.value_to over price', () => {
    const out = mapProduct('7891', {
      price: 99,
      price_aux: { value_to: 12 },
    });
    expect(out.price).toBe('12');
  });

  it('builds an lmpm observation when both lmpm fields are set', () => {
    const out = mapProduct('7891', {
      price_aux: { value_to: 10, lmpm_value_to: 8, lmpm_qty: 3 },
    });
    expect(out.metadata?.observation).toBe('Leve 3 unidades por R$ 8 cada');
  });

  it('overrides price with pbmPrice when PBM is detected', () => {
    const out = mapProduct('7891', {
      price_aux: { value_to: 10 },
      liveComposition: { livePrice: { type: 'PBM', valueTo: 5 } },
    });
    expect(out.price).toBe('5');
    expect(out.metadata?.isPbm).toBe(true);
  });
});
