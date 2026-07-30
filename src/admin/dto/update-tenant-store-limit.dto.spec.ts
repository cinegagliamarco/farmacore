import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTenantStoreLimitDto } from './update-tenant-store-limit.dto';

describe('UpdateTenantStoreLimitDto', () => {
  const check = (storeLimit: unknown) =>
    validate(plainToInstance(UpdateTenantStoreLimitDto, { storeLimit }));

  it.each([[3], [1], [2147483647], [null]])('accepts %p', async (v) => {
    expect(await check(v)).toHaveLength(0);
  });

  it.each([[0], [-1], [1.5], ['3'], [undefined], [2147483648]])(
    'rejects %p',
    async (v) => {
      expect((await check(v)).length).toBeGreaterThan(0);
    },
  );

  // @ValidateIf pula os validators quando é null; se o whitelist do pipe
  // global engolisse a chave por isso, remover o limite viraria um no-op
  // silencioso (storeLimit undefined → coluna intocada no save).
  it('keeps storeLimit: null through the global ValidationPipe', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    await expect(
      pipe.transform(
        { storeLimit: null },
        { type: 'body', metatype: UpdateTenantStoreLimitDto },
      ),
    ).resolves.toEqual({ storeLimit: null });
  });
});
