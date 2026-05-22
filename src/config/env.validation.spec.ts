import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const base = {
    NODE_ENV: 'test',
    PORT: '3000',
    WORKER_MODE: '0',
    DATABASE_URL: 'postgres://u:p@h:5432/d',
    DATABASE_DIRECT_URL: 'postgres://u:p@h:5432/d',
    AMQP_URL: 'amqp://localhost',
    JWT_SECRET: 'a'.repeat(32),
    INTEGRATION_DB_KEY: Buffer.alloc(32).toString('base64'),
    R2_ENDPOINT: 'https://x.r2.cloudflarestorage.com',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'bucket',
    R2_KEY_PREFIX: '',
  };

  it('accepts a valid env', () => {
    expect(() => validateEnv(base)).not.toThrow();
  });

  it('rejects missing DATABASE_URL', () => {
    const { DATABASE_URL, ...rest } = base;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects short JWT_SECRET', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects non-32-byte INTEGRATION_DB_KEY', () => {
    expect(() => validateEnv({ ...base, INTEGRATION_DB_KEY: 'aaa' })).toThrow(/INTEGRATION_DB_KEY/);
  });
});
