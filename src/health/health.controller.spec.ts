import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok', async () => {
    const mod = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    const controller = mod.get(HealthController);
    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
