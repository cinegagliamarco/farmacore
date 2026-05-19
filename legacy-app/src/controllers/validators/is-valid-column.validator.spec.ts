import { IsValidColumn } from './is-valid-column.validator';

describe('IsValidColumn', () => {
  let validator: IsValidColumn;

  beforeEach(() => {
    validator = new IsValidColumn();
  });

  describe('validate', () => {
    it('should return true for valid column names', () => {
      const validColumns = ['ean', 'name', 'price', 'drogal_price', 'drogasil_price'];
      
      validColumns.forEach(column => {
        expect(validator.validate(column, {} as any)).toBe(true);
      });
    });

    it('should return false for invalid column names', () => {
      const invalidColumns = ['invalid_column', 'fake_column', 'test', ''];
      
      invalidColumns.forEach(column => {
        expect(validator.validate(column, {} as any)).toBe(false);
      });
    });

    it('should return false for non-string values', () => {
      const nonStringValues = [123, {}, [], null, undefined];
      
      nonStringValues.forEach(value => {
        expect(validator.validate(value, {} as any)).toBe(false);
      });
    });
  });

  describe('defaultMessage', () => {
    it('should return a descriptive error message', () => {
      const args = { value: 'invalid_column' } as any;
      const message = validator.defaultMessage(args);
      
      expect(message).toContain('Invalid column: invalid_column');
      expect(message).toContain('Valid columns are:');
      expect(message).toContain('ean');
      expect(message).toContain('name');
      expect(message).toContain('price');
    });
  });
});
