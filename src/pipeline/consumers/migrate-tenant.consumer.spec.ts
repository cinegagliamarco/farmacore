import { MigrateTenantConsumer } from './migrate-tenant.consumer';
import { runTenantMigration } from '../../tenant/run-tenant-migration';

jest.mock('../../tenant/run-tenant-migration');

const runMock = runTenantMigration as jest.Mock;

describe('MigrateTenantConsumer', () => {
  it('propagates migration failures so the delivery routes to retry/DLQ', async () => {
    runMock.mockRejectedValue(new Error('migration blew up'));
    const consumer = new MigrateTenantConsumer();
    await expect(
      consumer.handle({ tenantSlug: 'acme', publishedAt: 'now' }),
    ).rejects.toThrow('migration blew up');
    expect(runMock).toHaveBeenCalledWith('acme');
  });
});
