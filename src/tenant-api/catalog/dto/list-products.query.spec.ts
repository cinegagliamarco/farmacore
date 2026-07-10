import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListProductsQueryDto } from './list-products.query';

const errorsFor = (eans: string) =>
  validate(plainToInstance(ListProductsQueryDto, { eans }));

describe('ListProductsQueryDto.eans', () => {
  it.each(['abc', '123,', '1234567890123456789'])(
    'rejects %j',
    async (eans) => {
      expect(await errorsFor(eans)).not.toHaveLength(0);
    },
  );

  it('accepts a multi-EAN list with spaces around the commas', async () => {
    expect(await errorsFor('7891234567895 , 7891000100103')).toHaveLength(0);
  });
});
