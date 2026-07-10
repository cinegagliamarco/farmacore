import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApplyItemDto } from './apply.dto';

const errorsFor = (ean: string) =>
  validate(
    plainToInstance(ApplyItemDto, { ean, target: 'precoVenda', price: 10 }),
  );

describe('ApplyItemDto.ean', () => {
  it('rejects a non-numeric ean', async () => {
    expect(await errorsFor('7891234abc')).not.toHaveLength(0);
  });

  it('rejects 19 digits (bigint cap is 18)', async () => {
    expect(await errorsFor('1234567890123456789')).not.toHaveLength(0);
  });

  it('accepts a plain numeric EAN', async () => {
    expect(await errorsFor('7891234567895')).toHaveLength(0);
  });
});
