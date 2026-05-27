import {
  pickName,
  pickMeasureSource,
  pickSupplier,
} from './update-base-product-properties.step';
import type { CompetitorProperties } from '../../database/repositories/shared-catalog/product.repository';

const baseRow: CompetitorProperties = {
  ean: '7891',
  origin: 'DROGAL',
  name: null,
  supplier: null,
  brand: null,
  weight: null,
  height: null,
  length: null,
  width: null,
};

describe('update-base-product-properties helpers', () => {
  describe('pickSupplier', () => {
    it('prefers DROGASIL supplier, then DROGAL, then brands', () => {
      expect(
        pickSupplier({
          drogasil: { ...baseRow, supplier: 'EMS' },
          drogal: { ...baseRow, supplier: 'EUROFARMA' },
        }),
      ).toBe('EMS');
      expect(
        pickSupplier({
          drogal: { ...baseRow, supplier: 'EUROFARMA' },
        }),
      ).toBe('EUROFARMA');
      expect(
        pickSupplier({
          drogasil: { ...baseRow, brand: 'NEXIUM' },
          drogal: { ...baseRow, brand: 'OMEPRAZOL' },
        }),
      ).toBe('NEXIUM');
    });

    it('returns null when nothing is set', () => {
      expect(pickSupplier({})).toBeNull();
      expect(pickSupplier({ drogasil: baseRow, drogal: baseRow })).toBeNull();
    });
  });

  describe('pickName', () => {
    it('prefers DROGASIL.name', () => {
      expect(
        pickName({
          drogasil: { ...baseRow, name: 'Aspirina 500mg' },
          drogal: { ...baseRow, name: 'AAS 500MG' },
        }),
      ).toBe('Aspirina 500mg');
    });

    it('falls through to DROGAL', () => {
      expect(pickName({ drogal: { ...baseRow, name: 'AAS' } })).toBe('AAS');
    });
  });

  describe('pickMeasureSource', () => {
    it('returns DROGASIL when it has any dimension', () => {
      const source = pickMeasureSource({
        drogasil: { ...baseRow, height: '4.5' },
        drogal: { ...baseRow, height: '5', length: '5', width: '5' },
      });
      expect(source?.origin).toBe('DROGAL'); // because baseRow.origin='DROGAL' default
      // ensure DROGASIL preferred regardless of origin field value
      const ds: CompetitorProperties = {
        ...baseRow,
        origin: 'DROGASIL',
        height: '4.5',
      };
      const dl: CompetitorProperties = {
        ...baseRow,
        origin: 'DROGAL',
        height: '5',
      };
      expect(pickMeasureSource({ drogasil: ds, drogal: dl })?.origin).toBe(
        'DROGASIL',
      );
    });

    it('returns null when no dimensions on either side', () => {
      expect(pickMeasureSource({})).toBeNull();
      expect(
        pickMeasureSource({
          drogasil: baseRow,
          drogal: baseRow,
        }),
      ).toBeNull();
    });
  });
});
