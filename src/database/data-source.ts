import 'dotenv/config';
import path from 'node:path';
import { DataSource } from 'typeorm';

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_DIRECT_URL or DATABASE_URL must be set');

// __dirname is:
//   <root>/src/database         when running .ts via ts-node (dev)
//   <root>/dist/src/database    when running compiled .js (prod)
// The {ts,js} glob lets both work without branching on NODE_ENV.
const here = __dirname;

export default new DataSource({
  type: 'postgres',
  url,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  // The glob also picks up tenant entities declared without a `schema`
  // (resolved at runtime via search_path), so `migration:generate` is NOT
  // supported against this data source — migrations are written by hand.
  entities: [path.join(here, 'entities/**/*.entity.{ts,js}')],
  migrations: [
    path.join(here, '../../migrations/core/*.{ts,js}'),
    path.join(here, '../../migrations/shared_catalog/*.{ts,js}'),
  ],
  migrationsTableName: 'migrations_app',
});
