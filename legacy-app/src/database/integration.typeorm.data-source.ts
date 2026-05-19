import { DataSource, DataSourceOptions } from 'typeorm';
import 'dotenv/config';

if (!process.env.INTEGRATION_DATABASE_URL) throw new Error('Missing Integration Database URL');

const config: Record<string, unknown> = {
  type: 'postgres',
  url: process.env.INTEGRATION_DATABASE_URL,
  entities: [`${__dirname}/integration-entities/*.entity.{ts,js}`],
  ssl: false
};

export const IntegrationTypeOrmDataSource = new DataSource(config as unknown as DataSourceOptions);
