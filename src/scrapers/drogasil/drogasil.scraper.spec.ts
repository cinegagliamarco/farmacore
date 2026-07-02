import { consumeForPattern, detectPbm, mapProduct } from './drogasil.scraper';
import type { DrogasilProductBySku } from './types';

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

  it('accepts pbm as a single object (not array)', () => {
    expect(
      detectPbm({
        pbm: { products: [{ valueSalePbm: 4.2 }] },
      } as unknown as DrogasilProductBySku),
    ).toEqual({ isPbm: true, pbmPrice: 4.2 });
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

  it('accepts description value_string as plain string', () => {
    const out = mapProduct('7891', {
      custom_attributes: [
        { attribute_code: 'description', value_string: '<p>Texto</p>' },
      ],
    });
    expect(out.metadata?.description).toBe('Texto');
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
