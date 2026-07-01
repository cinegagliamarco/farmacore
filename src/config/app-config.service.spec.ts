import { AppConfigService } from './app-config.service';
import { ConfigService } from '@nestjs/config';

describe('AppConfigService.amqpMgmt', () => {
  function svc(env: Record<string, string | undefined>): AppConfigService {
    return new AppConfigService(new ConfigService(env));
  }

  it('returns empty when all six vars unset', () => {
    expect(svc({}).amqpMgmt).toEqual({});
  });

  it('prefers AMQP_MGMT_* over CLOUDAMQP_API_*', () => {
    expect(
      svc({
        AMQP_MGMT_URL: 'https://new/api',
        AMQP_MGMT_USER: 'new-user',
        AMQP_MGMT_PASS: 'new-pass',
        CLOUDAMQP_API_URL: 'https://old/api',
        CLOUDAMQP_API_USER: 'old-user',
        CLOUDAMQP_API_PASS: 'old-pass',
      }).amqpMgmt,
    ).toEqual({
      apiUrl: 'https://new/api',
      user: 'new-user',
      pass: 'new-pass',
    });
  });

  it('falls back to CLOUDAMQP_API_* when AMQP_MGMT_* unset', () => {
    expect(
      svc({
        CLOUDAMQP_API_URL: 'https://old/api',
        CLOUDAMQP_API_USER: 'old-user',
        CLOUDAMQP_API_PASS: 'old-pass',
      }).amqpMgmt,
    ).toEqual({
      apiUrl: 'https://old/api',
      user: 'old-user',
      pass: 'old-pass',
    });
  });
});
