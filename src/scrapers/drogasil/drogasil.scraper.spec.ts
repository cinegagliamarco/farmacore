import { buildStockMap, detectPbm, mapProduct } from './drogasil.scraper';
import type { DrogasilStockResponse } from './types';

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
