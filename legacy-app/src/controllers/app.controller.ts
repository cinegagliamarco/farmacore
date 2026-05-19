import { Controller, Delete, Get, Post, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { BucketService } from '../services/bucket.service';

@Controller()
export class AppController {
  @Get('/health')
  public getHealth(): { status: string } {
    return { status: 'OK' };
  }
}
