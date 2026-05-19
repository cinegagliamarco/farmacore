import { plainToInstance } from 'class-transformer';
import { IsOptional, validate } from 'class-validator';
import { IsBooleanString } from './is-boolean-string.validator';

class TestDto {
  @IsOptional()
  @IsBooleanString()
  public booleanField?: boolean;
}

describe('IsBooleanString', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('transformation', () => {
    it('should transform string "true" to boolean true', async () => {
      const result = plainToInstance(TestDto, { booleanField: 'true' });

      expect(result.booleanField).toBe(true);
      expect(typeof result.booleanField).toBe('boolean');
    });

    it('should transform string "false" to boolean false', async () => {
      const result = plainToInstance(TestDto, { booleanField: 'false' });

      expect(result.booleanField).toBe(false);
      expect(typeof result.booleanField).toBe('boolean');
    });

    it('should keep boolean true as boolean true', async () => {
      const result = plainToInstance(TestDto, { booleanField: true });

      expect(result.booleanField).toBe(true);
      expect(typeof result.booleanField).toBe('boolean');
    });

    it('should keep boolean false as boolean false', async () => {
      const result = plainToInstance(TestDto, { booleanField: false });

      expect(result.booleanField).toBe(false);
      expect(typeof result.booleanField).toBe('boolean');
    });

    it('should not transform other string values', async () => {
      const result = plainToInstance(TestDto, { booleanField: 'invalid' });

      expect(result.booleanField).toBe('invalid');
    });
  });

  describe('validation', () => {
    it('should pass validation for transformed "true" string', async () => {
      const dto = plainToInstance(TestDto, { booleanField: 'true' });
      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
    });

    it('should pass validation for transformed "false" string', async () => {
      const dto = plainToInstance(TestDto, { booleanField: 'false' });
      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
    });

    it('should pass validation for boolean true', async () => {
      const dto = plainToInstance(TestDto, { booleanField: true });
      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
    });

    it('should pass validation for boolean false', async () => {
      const dto = plainToInstance(TestDto, { booleanField: false });
      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
    });

    it('should pass validation when field is undefined (optional)', async () => {
      const dto = plainToInstance(TestDto, {});
      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
    });

    it('should fail validation for invalid string values', async () => {
      const dto = plainToInstance(TestDto, { booleanField: 'invalid' });
      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('booleanField');
      expect(errors[0].constraints).toHaveProperty('isBoolean');
    });

    it('should fail validation for number values', async () => {
      const dto = plainToInstance(TestDto, { booleanField: 1 });
      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('booleanField');
    });
  });
});

