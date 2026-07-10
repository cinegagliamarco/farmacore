import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationQueryDto } from './pagination.query';

describe('PaginationQueryDto', () => {
  it('rejects non-integer page/perPage and coerces valid strings to numbers', async () => {
    // Without the coercion+validation, ?page=abc reaches SQL as LIMIT NaN → 500.
    for (const bad of [{ page: 'abc' }, { page: '0' }, { perPage: '1.5' }]) {
      expect(
        await validate(plainToInstance(PaginationQueryDto, bad)),
      ).not.toHaveLength(0);
    }
    const dto = plainToInstance(PaginationQueryDto, {
      page: '2',
      perPage: '50',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.perPage).toBe(50);
  });
});
