import 'dotenv/config';
import { DataSource } from 'typeorm';

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_DIRECT_URL or DATABASE_URL must be set');

export default new DataSource({
  type: 'postgres',
  url,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  entities: ['src/database/entities/**/*.entity.ts'],
  migrations: ['migrations/core/*.ts', 'migrations/shared_catalog/*.ts'],
  migrationsTableName: 'migrations_app',
});
