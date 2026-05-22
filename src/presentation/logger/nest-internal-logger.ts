import { Injectable, Logger } from '@nestjs/common';
import { InternalLogger } from '../../interfaces';

function resolveContext(ctx: unknown): string | undefined {
  if (ctx === undefined || ctx === null) return undefined;
  if (typeof ctx === 'string') return ctx;
  if (typeof ctx === 'object') {
    const ctor = (ctx as { constructor?: { name?: string } }).constructor;
    return ctor?.name ?? 'Object';
  }
  return String(ctx);
}

@Injectable()
export class NestInternalLogger implements InternalLogger {
  constructor(private readonly nest: Logger = new Logger('App')) {}

  public log(payload: unknown, ctx?: unknown): void {
    this.nest.log(payload as never, resolveContext(ctx));
  }

  public warn(payload: unknown, ctx?: unknown): void {
    this.nest.warn(payload as never, resolveContext(ctx));
  }

  public error(message: string, ctx?: unknown): void {
    this.nest.error(message, resolveContext(ctx));
  }

  public debug(payload: unknown, ctx?: unknown): void {
    this.nest.debug(payload as never, resolveContext(ctx));
  }
}
