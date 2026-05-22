import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class IntegrationDataSourceFactory {
  public forTenantSlug(_slug: string): Promise<DataSource | null> {
    return Promise.resolve(null);
  }
}
