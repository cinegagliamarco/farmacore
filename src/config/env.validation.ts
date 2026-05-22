import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUrl, MinLength, validateSync } from 'class-validator';

enum NodeEnv {
  development = 'development',
  test = 'test',
  production = 'production',
}

class EnvVars {
  @IsEnum(NodeEnv)
  NODE_ENV!: NodeEnv;

  @IsInt()
  PORT!: number;

  @IsOptional() @IsString()
  WORKER_MODE?: string;

  @IsString() @MinLength(1, { message: 'DATABASE_URL must be set' })
  DATABASE_URL!: string;

  @IsString() @MinLength(1, { message: 'DATABASE_DIRECT_URL must be set' })
  DATABASE_DIRECT_URL!: string;

  @IsString()
  AMQP_URL!: string;

  @IsString() @MinLength(32, { message: 'JWT_SECRET must be at least 32 chars' })
  JWT_SECRET!: string;

  @IsString()
  INTEGRATION_DB_KEY!: string;

  @IsUrl({ require_tld: false })
  R2_ENDPOINT!: string;

  @IsString()
  R2_ACCESS_KEY_ID!: string;

  @IsString()
  R2_SECRET_ACCESS_KEY!: string;

  @IsString()
  R2_BUCKET!: string;

  @IsString()
  R2_KEY_PREFIX!: string;
}

export function validateEnv(raw: Record<string, unknown>): EnvVars {
  const parsed = plainToInstance(
    EnvVars,
    { ...raw, PORT: Number(raw.PORT ?? 3000) },
    { enableImplicitConversion: true },
  );
  const errors = validateSync(parsed, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(
      errors
        .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
        .join('; '),
    );
  }
  const keyBytes = Buffer.from(parsed.INTEGRATION_DB_KEY, 'base64');
  if (keyBytes.length !== 32) {
    throw new Error('INTEGRATION_DB_KEY: must be 32 bytes (base64-encoded)');
  }
  return parsed;
}
