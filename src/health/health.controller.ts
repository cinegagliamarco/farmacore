import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  async check(): Promise<{ status: 'ok' }> {
    return { status: 'ok' };
  }
}
