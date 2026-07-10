import { BadRequestException } from '@nestjs/common';
import { ProductsController } from './products.controller';
import type { ProductsService } from './products.service';

describe('ProductsController.import EAN boundary', () => {
  const importProduct = jest.fn().mockResolvedValue({ ean: 'ok' });
  const controller = new ProductsController({
    importProduct,
  } as unknown as ProductsService);

  beforeEach(() => importProduct.mockClear());

  it('accepts a 14-digit GTIN-14', async () => {
    await controller.import('12345678901234');
    expect(importProduct).toHaveBeenCalledWith('12345678901234');
  });

  it('rejects 15 digits', () => {
    expect(() => controller.import('123456789012345')).toThrow(
      BadRequestException,
    );
    expect(importProduct).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric ean', () => {
    expect(() => controller.import('7891234abc')).toThrow(BadRequestException);
    expect(importProduct).not.toHaveBeenCalled();
  });
});
