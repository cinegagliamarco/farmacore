import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateStoreDto } from './stores.dto';

describe('UpdateStoreDto.active', () => {
  const check = (body: Record<string, unknown>) =>
    validate(plainToInstance(UpdateStoreDto, body));

  it.each([[true], [false]])('accepts %p', async (active) => {
    expect(await check({ active })).toHaveLength(0);
  });

  it('accepts an omitted active (cluster-only update)', async () => {
    expect(await check({ clusterId: null })).toHaveLength(0);
  });

  // `active: null` passaria por @IsOptional, escaparia da checagem de cota
  // (não é === true) e estouraria na coluna NOT NULL como 500.
  it.each([[null], ['true'], [1]])('rejects %p', async (active) => {
    expect((await check({ active })).length).toBeGreaterThan(0);
  });
});
