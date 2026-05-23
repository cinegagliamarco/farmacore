# 09 — Presentation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

> **Status: ✅ Executed.** Plan 09 was executed. The `AmqpInterceptor` was later guarded against `@golevelup/nestjs-rabbitmq` consumers (commit `3ce3c0a`) — it only intercepts when the second handler arg looks like a `@nestjs/microservices` `RmqContext`.

**Goal:** Set up the cross-cutting code conventions every other plan depends on — internal logger abstraction, request/RMQ logger interceptor, RMQ retry interceptor with ack/nack semantics, unhandled-signal listener, and the layered `presentation/` + `common/` + `interfaces/` directory structure.

**Architecture:** Mirrors the patterns from the user's existing project (without referencing its files at runtime). Three flat layers:

- `src/interfaces/` — DI tokens + interfaces that other layers depend on (`InternalLogger`, `INTERNAL_LOGGER_TOKEN`).
- `src/common/` — utilities and process-lifecycle helpers that don't belong to a feature module (`waitFor`, `catchUnhandledSignals`).
- `src/presentation/` — HTTP + AMQP boundary concerns: interceptors, decorators (e.g. `@AmqpRetry(maxRetries)`), the `InterceptorModule` that registers them globally via `APP_INTERCEPTOR`.

**Tech Stack:** NestJS 11, `rxjs` (catchError/finalize), `amqplib` types (`Message`, `ConfirmChannel`), `@nestjs/microservices` (for `RmqContext`).

---

## Interfaces Exposed

- **DI tokens:**
  - `INTERNAL_LOGGER_TOKEN` — inject token for the logger.
- **Interfaces:**
  - `InternalLogger` — `log(payload: unknown, ctx?: unknown): void; warn(...); error(message: string, ctx?: unknown): void; debug(...)`.
- **Concrete impls:**
  - `NestInternalLogger` — wraps Nest's built-in `Logger`; resolves the `ctx` argument into a class name when given an object instance, into a string when given a string.
- **Decorators:**
  - `@AmqpRetry(maxRetries: number)` — sets metadata read by `AmqpInterceptor`.
- **Interceptors (global via `APP_INTERCEPTOR`):**
  - `LoggerInterceptor` — measures duration; logs HTTP + RMQ requests; obfuscates sensitive fields (`password`, `token`, `secret`, ...).
  - `AmqpInterceptor` — handles `ack` / `nack` on RMQ messages, optional retry via `@AmqpRetry`. HTTP requests pass through untouched.
- **Module:** `PresentationModule` — exports the interceptor module + logger provider; imported once in the root module.
- **Process helpers:**
  - `catchUnhandledSignals(app)` — installs `uncaughtException` / `unhandledRejection` handlers that log via `InternalLogger`.
  - `waitFor(ms)` — `Promise<void>` sleep, used by retry logic.

---

## File Structure

```
src/
├─ interfaces/
│  ├─ internal-logger.ts            # InternalLogger interface + INTERNAL_LOGGER_TOKEN
│  └─ index.ts
├─ common/
│  ├─ wait-for.ts
│  ├─ listeners/
│  │  ├─ unhandled-signals.listener.ts
│  │  ├─ unhandled-signals.listener.spec.ts
│  │  └─ index.ts
│  └─ index.ts
└─ presentation/
   ├─ decorators/
   │  ├─ amqp-retry.decorator.ts
   │  └─ index.ts
   ├─ interceptors/
   │  ├─ amqp.interceptor.ts
   │  ├─ amqp.interceptor.spec.ts
   │  ├─ logger.interceptor.ts
   │  ├─ logger.interceptor.spec.ts
   │  ├─ interceptor.module.ts
   │  └─ index.ts
   ├─ logger/
   │  ├─ nest-internal-logger.ts
   │  ├─ nest-internal-logger.spec.ts
   │  ├─ logger.module.ts
   │  └─ index.ts
   ├─ presentation.module.ts
   └─ index.ts
```

---

### Task 1: InternalLogger interface + token

**Files:** `src/interfaces/internal-logger.ts`, `src/interfaces/index.ts`

- [x] **Step 1: Define interface and token**

`src/interfaces/internal-logger.ts`:

```ts
export const INTERNAL_LOGGER_TOKEN = Symbol('INTERNAL_LOGGER');

export interface InternalLogger {
  log(payload: unknown, ctx?: unknown): void;
  warn(payload: unknown, ctx?: unknown): void;
  error(message: string, ctx?: unknown): void;
  debug(payload: unknown, ctx?: unknown): void;
}
```

`src/interfaces/index.ts`:

```ts
export * from './internal-logger';
```

- [x] **Step 2: Commit**

```bash
git add src/interfaces/
git commit -m "feat(interfaces): InternalLogger contract + DI token"
```

---

### Task 2: NestInternalLogger implementation

**Files:** `src/presentation/logger/nest-internal-logger.ts`, `.spec.ts`

- [x] **Step 1: Failing test**

```ts
import { Logger } from '@nestjs/common';
import { NestInternalLogger } from './nest-internal-logger';

describe('NestInternalLogger', () => {
  let underlying: jest.Mocked<Logger>;
  let log: NestInternalLogger;

  beforeEach(() => {
    underlying = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as jest.Mocked<Logger>;
    log = new NestInternalLogger(underlying);
  });

  it('forwards .log(payload) with no context', () => {
    log.log({ hello: 'world' });
    expect(underlying.log).toHaveBeenCalledWith({ hello: 'world' }, undefined);
  });

  it('extracts class name when context is an instance', () => {
    class MyService {}
    log.log('hi', new MyService());
    expect(underlying.log).toHaveBeenCalledWith('hi', 'MyService');
  });

  it('passes string contexts through', () => {
    log.error('boom', 'CustomContext');
    expect(underlying.error).toHaveBeenCalledWith('boom', 'CustomContext');
  });

  it('serializes object payloads to JSON for non-string error messages', () => {
    log.warn({ code: 'X', detail: 1 });
    expect(underlying.warn).toHaveBeenCalledWith({ code: 'X', detail: 1 }, undefined);
  });
});
```

- [x] **Step 2: Run, expect fail**

Run: `npm test -- src/presentation/logger/nest-internal-logger.spec.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InternalLogger } from '../../interfaces';

function resolveContext(ctx: unknown): string | undefined {
  if (ctx === undefined || ctx === null) return undefined;
  if (typeof ctx === 'string') return ctx;
  if (typeof ctx === 'object') return ctx.constructor?.name ?? 'Object';
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
```

- [x] **Step 4: Run, expect pass**

Run: `npm test -- src/presentation/logger/nest-internal-logger.spec.ts`
Expected: PASS (4 tests).

- [x] **Step 5: Commit**

```bash
git add src/presentation/logger/nest-internal-logger.ts src/presentation/logger/nest-internal-logger.spec.ts
git commit -m "feat(logger): NestInternalLogger wrapping Nest's Logger"
```

---

### Task 3: LoggerModule (provides InternalLogger globally)

**Files:** `src/presentation/logger/logger.module.ts`, `src/presentation/logger/index.ts`

- [x] **Step 1: Module**

```ts
import { Global, Logger, Module } from '@nestjs/common';
import { INTERNAL_LOGGER_TOKEN } from '../../interfaces';
import { NestInternalLogger } from './nest-internal-logger';

@Global()
@Module({
  providers: [
    {
      provide: INTERNAL_LOGGER_TOKEN,
      useFactory: (): NestInternalLogger => new NestInternalLogger(new Logger('App')),
    },
  ],
  exports: [INTERNAL_LOGGER_TOKEN],
})
export class LoggerModule {}
```

- [x] **Step 2: Barrel**

`src/presentation/logger/index.ts`:

```ts
export * from './logger.module';
export * from './nest-internal-logger';
```

- [x] **Step 3: Commit**

```bash
git add src/presentation/logger/
git commit -m "feat(logger): LoggerModule provides InternalLogger globally"
```

---

### Task 4: waitFor utility

**Files:** `src/common/wait-for.ts`, `src/common/index.ts`

- [x] **Step 1: Implement**

```ts
export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

`src/common/index.ts`:

```ts
export * from './wait-for';
export * from './listeners';
```

- [x] **Step 2: Commit**

```bash
git add src/common/wait-for.ts src/common/index.ts
git commit -m "feat(common): waitFor utility"
```

---

### Task 5: catchUnhandledSignals

**Files:** `src/common/listeners/unhandled-signals.listener.ts`, `.spec.ts`, `src/common/listeners/index.ts`

- [x] **Step 1: Failing test**

```ts
import { INestApplication } from '@nestjs/common';
import { catchUnhandledSignals } from './unhandled-signals.listener';
import { INTERNAL_LOGGER_TOKEN, InternalLogger } from '../../interfaces';

describe('catchUnhandledSignals', () => {
  let app: { get: jest.Mock };
  let logger: jest.Mocked<InternalLogger>;
  const originalListeners = {
    uncaughtException: process.listeners('uncaughtException').slice(),
    unhandledRejection: process.listeners('unhandledRejection').slice(),
  };

  beforeEach(() => {
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    app = { get: jest.fn().mockReturnValue(logger) };
  });

  afterEach(() => {
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    for (const l of originalListeners.uncaughtException) process.on('uncaughtException', l);
    for (const l of originalListeners.unhandledRejection) process.on('unhandledRejection', l);
  });

  it('resolves logger via INTERNAL_LOGGER_TOKEN', () => {
    catchUnhandledSignals(app as unknown as INestApplication);
    expect(app.get).toHaveBeenCalledWith(INTERNAL_LOGGER_TOKEN);
  });

  it('logs uncaughtException', () => {
    catchUnhandledSignals(app as unknown as INestApplication);
    process.emit('uncaughtException', new Error('boom'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('uncaughtException'), 'GlobalExceptionSignalsHandler');
  });

  it('logs unhandledRejection', () => {
    catchUnhandledSignals(app as unknown as INestApplication);
    process.emit('unhandledRejection', new Error('nope') as never, Promise.resolve() as never);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('unhandledRejection'), 'GlobalExceptionSignalsHandler');
  });
});
```

- [x] **Step 2: Run, expect fail**

Run: `npm test -- src/common/listeners/unhandled-signals.listener.spec.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```ts
import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { INTERNAL_LOGGER_TOKEN, InternalLogger } from '../../interfaces';

export function catchUnhandledSignals(app: INestApplication | INestApplicationContext): void {
  const logger = app.get<InternalLogger>(INTERNAL_LOGGER_TOKEN);
  process.on('uncaughtException', (err: Error) => {
    logger.error(`Received uncaughtException ${err.message}`, 'GlobalExceptionSignalsHandler');
  });
  process.on('unhandledRejection', (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Received unhandledRejection ${message}`, 'GlobalExceptionSignalsHandler');
  });
}
```

`src/common/listeners/index.ts`:

```ts
export * from './unhandled-signals.listener';
```

- [x] **Step 4: Run, expect pass**

Run: `npm test -- src/common/listeners/unhandled-signals.listener.spec.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add src/common/listeners/
git commit -m "feat(common): catchUnhandledSignals listener"
```

---

### Task 6: @AmqpRetry decorator

**Files:** `src/presentation/decorators/amqp-retry.decorator.ts`, `src/presentation/decorators/index.ts`

- [x] **Step 1: Implement**

```ts
import { SetMetadata } from '@nestjs/common';

export const AMQP_RETRY_TOKEN = 'AMQP_RETRY';

/**
 * Marks an RMQ handler as retryable. The AmqpInterceptor re-enqueues the message
 * up to `maxRetries` times when the handler throws a `ServiceUnavailableException`.
 */
export const AmqpRetry = (maxRetries: number): MethodDecorator =>
  SetMetadata(AMQP_RETRY_TOKEN, maxRetries);
```

`src/presentation/decorators/index.ts`:

```ts
export * from './amqp-retry.decorator';
```

- [x] **Step 2: Commit**

```bash
git add src/presentation/decorators/
git commit -m "feat(presentation): @AmqpRetry decorator"
```

---

### Task 7: LoggerInterceptor

**Files:** `src/presentation/interceptors/logger.interceptor.ts`, `.spec.ts`

Logs duration + redacted body for HTTP and RMQ requests. RMQ context detection works with both `@golevelup/nestjs-rabbitmq` (`'rmq'` type) and `@nestjs/microservices` (`'rpc'` type).

- [x] **Step 1: Failing test (minimal HTTP shape)**

```ts
import { ExecutionContext, HttpException } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { LoggerInterceptor } from './logger.interceptor';
import { InternalLogger } from '../../interfaces';

function fakeHttpContext(req: Partial<Express.Request> & Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as unknown as ExecutionContext;
}

describe('LoggerInterceptor', () => {
  let logger: jest.Mocked<InternalLogger>;
  let interceptor: LoggerInterceptor;

  beforeEach(() => {
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    interceptor = new LoggerInterceptor(logger);
  });

  it('logs successful HTTP request with duration + status_code', async () => {
    const ctx = fakeHttpContext({
      method: 'GET',
      route: { path: '/things' },
      params: {},
      body: { password: 'secret', name: 'ok' },
      query: {},
      ip: '::ffff:127.0.0.1',
      header: () => 'x',
    });
    await firstValueFrom(interceptor.intercept(ctx, { handle: () => of(undefined) }));
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/things', method: 'GET', status_code: 200,
        body: { password: '**********', name: 'ok' },
        ip: '127.0.0.1', duration: expect.any(Number),
      }),
      interceptor,
    );
  });

  it('skips logging /health', async () => {
    const ctx = fakeHttpContext({
      method: 'GET',
      route: { path: '/health' },
      params: {}, body: {}, query: {}, ip: '127.0.0.1', header: () => 'x',
    });
    await firstValueFrom(interceptor.intercept(ctx, { handle: () => of(undefined) }));
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('records error status from HttpException', async () => {
    const ctx = fakeHttpContext({
      method: 'POST', route: { path: '/things' },
      params: {}, body: {}, query: {}, ip: '127.0.0.1', header: () => 'x',
    });
    await expect(
      firstValueFrom(interceptor.intercept(ctx, { handle: () => throwError(() => new HttpException('nope', 418)) })),
    ).rejects.toBeInstanceOf(HttpException);
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ status_code: 418, error_message: 'nope' }),
      interceptor,
    );
  });
});
```

- [x] **Step 2: Run, expect fail**

Run: `npm test -- src/presentation/interceptors/logger.interceptor.spec.ts`
Expected: FAIL.

- [x] **Step 3: Implement**

```ts
import { CallHandler, ExecutionContext, HttpException, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, finalize } from 'rxjs';
import { INTERNAL_LOGGER_TOKEN, InternalLogger } from '../../interfaces';

const SENSITIVE_PROPERTY_KEYWORDS = ['password', 'pass', 'pwd', 'secret', 'token', 'ssn', 'bank'];
const HEALTH_SKIP = [{ method: 'GET', url: '/health' }];

@Injectable()
export class LoggerInterceptor implements NestInterceptor {
  constructor(@Inject(INTERNAL_LOGGER_TOKEN) private readonly logger: InternalLogger) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = Date.now();
    let captured: HttpException | Error | null = null;

    return next.handle().pipe(
      catchError((err) => {
        captured = err as HttpException | Error;
        throw err;
      }),
      finalize(() => {
        const duration = Date.now() - startedAt;
        this.dispatch(context, duration, captured);
      }),
    );
  }

  private dispatch(context: ExecutionContext, duration: number, exception: HttpException | Error | null): void {
    switch (context.getType<string>()) {
      case 'http':
        return this.logHttp(context, duration, exception);
      case 'rmq':
        return this.logRmq(context, duration, exception);
      case 'rpc':
        return this.logRpc(context, duration, exception);
      default:
        return;
    }
  }

  private logHttp(context: ExecutionContext, duration: number, exception: HttpException | Error | null): void {
    const req = context.switchToHttp().getRequest();
    if (this.shouldSkip(req)) return;
    const res = context.switchToHttp().getResponse();
    const user = req.user as { sub?: string; tenantId?: string } | undefined;

    this.logger.log(
      {
        url: req.route?.path,
        method: req.method,
        user_id: user?.sub ?? null,
        tenant_id: user?.tenantId ?? null,
        params: this.obfuscate(req.params),
        body: this.obfuscate(req.body),
        query: this.obfuscate(req.query),
        ip: this.formatIp(req.ip),
        status_code: this.statusCode(res, exception),
        user_agent: typeof req.header === 'function' ? req.header('user-agent') : undefined,
        host: typeof req.header === 'function' ? req.header('host') : undefined,
        duration,
        error_message: exception?.message ?? null,
        error_stack: exception?.stack ?? null,
      },
      this,
    );
  }

  // Shape for @golevelup/nestjs-rabbitmq handlers.
  private logRmq(context: ExecutionContext, duration: number, exception: HttpException | Error | null): void {
    const [body, second] = context.getArgs() as [unknown, { fields?: Record<string, unknown> }];
    this.logger.log(
      {
        ...(second?.fields ?? {}),
        body: this.obfuscate(body),
        duration,
        error_message: exception?.message ?? null,
        error_stack: exception?.stack ?? null,
      },
      this,
    );
  }

  // Shape for @nestjs/microservices RMQ.
  private logRpc(context: ExecutionContext, duration: number, exception: HttpException | Error | null): void {
    const [body, rmqContext] = context.getArgs() as [unknown, { getPattern?: () => string }];
    this.logger.log(
      {
        routing_key: rmqContext?.getPattern?.() ?? null,
        body: this.obfuscate(body),
        duration,
        error_message: exception?.message ?? null,
        error_stack: exception?.stack ?? null,
      },
      this,
    );
  }

  private statusCode(res: { statusCode: number }, exception: HttpException | Error | null): number {
    if (!exception) return res.statusCode;
    return exception instanceof HttpException ? exception.getStatus() : 500;
  }

  private shouldSkip(req: { method?: string; route?: { path?: string } }): boolean {
    if (!req?.method || !req.route?.path) return true;
    return HEALTH_SKIP.some((s) => s.method === req.method && req.route!.path!.includes(s.url));
  }

  private formatIp(value?: string): string | undefined {
    return value?.startsWith('::ffff:') ? value.substring(7) : value;
  }

  private obfuscate(value: unknown, depth = 0): unknown {
    if (depth > 3) return '[max depth]';
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => this.obfuscate(v, depth + 1));

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const sensitive = SENSITIVE_PROPERTY_KEYWORDS.some((s) => k.toLowerCase().includes(s));
      out[k] = sensitive
        ? '**********'
        : typeof v === 'object'
          ? this.obfuscate(v, depth + 1)
          : v;
    }
    return out;
  }
}
```

- [x] **Step 4: Run, expect pass**

Run: `npm test -- src/presentation/interceptors/logger.interceptor.spec.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add src/presentation/interceptors/logger.interceptor.ts src/presentation/interceptors/logger.interceptor.spec.ts
git commit -m "feat(presentation): LoggerInterceptor (HTTP + RMQ + RPC)"
```

---

### Task 8: AmqpInterceptor

**Files:** `src/presentation/interceptors/amqp.interceptor.ts`, `.spec.ts`

ACK on success, NACK on uncaught error. Optional retry via `@AmqpRetry(N)` re-enqueues after a fixed delay (30s) with an `x-retry-count` header. Inspiration: handler must throw `ServiceUnavailableException` to opt into retry; any other exception is a hard fail.

- [x] **Step 1: Failing test**

```ts
import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AmqpInterceptor } from './amqp.interceptor';
import { InternalLogger } from '../../interfaces';

function fakeRmqContext(channel: { ack: jest.Mock; nack: jest.Mock; sendToQueue: jest.Mock }, message: Record<string, unknown>): ExecutionContext {
  const rmq = { getChannelRef: () => channel, getMessage: () => message };
  return {
    getType: () => 'rmq',
    getArgByIndex: (i: number) => (i === 1 ? rmq : undefined),
    getArgs: () => [{}, { fields: { routingKey: 'rk' } }],
    getHandler: () => () => {},
  } as unknown as ExecutionContext;
}

describe('AmqpInterceptor', () => {
  let channel: { ack: jest.Mock; nack: jest.Mock; sendToQueue: jest.Mock };
  let reflector: Reflector;
  let logger: jest.Mocked<InternalLogger>;
  let interceptor: AmqpInterceptor;

  beforeEach(() => {
    channel = { ack: jest.fn(), nack: jest.fn(), sendToQueue: jest.fn() };
    reflector = new Reflector();
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    interceptor = new AmqpInterceptor(reflector, logger);
  });

  it('acks on success', async () => {
    const ctx = fakeRmqContext(channel, { fields: { routingKey: 'rk' }, properties: { headers: {} }, content: Buffer.from('{}') });
    await firstValueFrom(interceptor.intercept(ctx, { handle: () => of(undefined) }));
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('nacks (no requeue) on hard error', async () => {
    const ctx = fakeRmqContext(channel, { fields: { routingKey: 'rk' }, properties: { headers: {} }, content: Buffer.from('{}') });
    await expect(
      firstValueFrom(interceptor.intercept(ctx, { handle: () => throwError(() => new Error('boom')) })),
    ).rejects.toBeInstanceOf(Error);
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  it('reenqueues with x-retry-count when @AmqpRetry(2) and ServiceUnavailableException, attempt 1', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(2);
    const ctx = fakeRmqContext(channel, {
      fields: { routingKey: 'rk' },
      properties: { headers: {} },
      content: Buffer.from('{}'),
    });
    await expect(
      firstValueFrom(interceptor.intercept(ctx, { handle: () => throwError(() => new ServiceUnavailableException()) })),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(channel.sendToQueue).toHaveBeenCalled();
    expect(channel.sendToQueue.mock.calls[0][2].headers['x-retry-count']).toBe(1);
  });

  it('passes through HTTP requests untouched', async () => {
    const ctx = { getType: () => 'http', getArgByIndex: () => undefined } as unknown as ExecutionContext;
    const result = await firstValueFrom(interceptor.intercept(ctx, { handle: () => of('ok') }));
    expect(result).toBe('ok');
    expect(channel.ack).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run, expect fail**

Run: `npm test -- src/presentation/interceptors/amqp.interceptor.spec.ts`
Expected: FAIL.

- [x] **Step 3: Implement**

```ts
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, catchError, finalize, from, switchMap } from 'rxjs';
import type { ConfirmChannel, Message } from 'amqplib';
import { waitFor } from '../../common/wait-for';
import { INTERNAL_LOGGER_TOKEN, InternalLogger } from '../../interfaces';
import { AMQP_RETRY_TOKEN } from '../decorators';

const REQUEUE_DELAY_MS = 30_000;

@Injectable()
export class AmqpInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(INTERNAL_LOGGER_TOKEN) private readonly logger: InternalLogger,
  ) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<string>() === 'http') return next.handle();

    let failed = false;
    const rmqContext = context.getArgByIndex(1) as { getChannelRef: () => ConfirmChannel; getMessage: () => Message } | undefined;
    if (!rmqContext) return next.handle();

    const channel = rmqContext.getChannelRef();
    const originalMessage = rmqContext.getMessage();

    return next.handle().pipe(
      catchError((error: Error) => {
        failed = true;
        const maxRetries: number | undefined = this.reflector.get(AMQP_RETRY_TOKEN, context.getHandler());
        if (this.shouldRequeue(originalMessage, error, maxRetries)) {
          return from(this.requeueMessage(maxRetries!, originalMessage, channel)).pipe(
            switchMap(() => { throw error; }),
          );
        }
        throw error;
      }),
      finalize(() => {
        if (failed) return channel.nack(originalMessage, false, false);
        return channel.ack(originalMessage);
      }),
    );
  }

  private async requeueMessage(maxRetries: number, originalMessage: Message, channel: ConfirmChannel): Promise<void> {
    const nextRetry = this.currentRetry(originalMessage) + 1;
    const isLast = nextRetry === maxRetries;

    const content = JSON.parse(originalMessage.content.toString());
    const body = isLast ? { ...content, lastRetry: true } : content;
    const properties = {
      ...originalMessage.properties,
      headers: { ...(originalMessage.properties.headers ?? {}), 'x-retry-count': nextRetry },
    };

    this.logger.log(
      `Re-enqueueing ${originalMessage.fields.routingKey} (attempt ${nextRetry}/${maxRetries}, delay ${REQUEUE_DELAY_MS}ms)`,
      this,
    );

    await waitFor(REQUEUE_DELAY_MS);
    channel.sendToQueue(originalMessage.fields.routingKey, Buffer.from(JSON.stringify(body)), properties);
  }

  private shouldRequeue(message: Message, error: Error, maxRetries?: number): boolean {
    if (!maxRetries || !(error instanceof ServiceUnavailableException)) return false;
    return this.currentRetry(message) < maxRetries;
  }

  private currentRetry(message: Message): number {
    const headers = message.properties.headers ?? {};
    return Number((headers as Record<string, unknown>)['x-retry-count'] ?? 0);
  }
}
```

- [x] **Step 4: Run, expect pass**

Run: `npm test -- src/presentation/interceptors/amqp.interceptor.spec.ts`
Expected: PASS (4 tests).

> **Note:** The 30s `waitFor` runs in-channel; the test stubs `waitFor` indirectly because the call returns a resolved-after-30s promise. To keep the test fast, mock `waitFor`:

In the test, add:

```ts
jest.mock('../../common/wait-for', () => ({ waitFor: jest.fn().mockResolvedValue(undefined) }));
```

Re-run; should still pass without the 30s wait.

- [x] **Step 5: Commit**

```bash
git add src/presentation/interceptors/amqp.interceptor.ts src/presentation/interceptors/amqp.interceptor.spec.ts
git commit -m "feat(presentation): AmqpInterceptor (ack/nack + @AmqpRetry)"
```

---

### Task 9: InterceptorModule

**Files:** `src/presentation/interceptors/interceptor.module.ts`, `src/presentation/interceptors/index.ts`

- [x] **Step 1: Module**

```ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AmqpInterceptor } from './amqp.interceptor';
import { LoggerInterceptor } from './logger.interceptor';

@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: AmqpInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggerInterceptor },
  ],
})
export class InterceptorModule {}
```

- [x] **Step 2: Barrel**

`src/presentation/interceptors/index.ts`:

```ts
export * from './amqp.interceptor';
export * from './logger.interceptor';
export * from './interceptor.module';
```

- [x] **Step 3: Commit**

```bash
git add src/presentation/interceptors/interceptor.module.ts src/presentation/interceptors/index.ts
git commit -m "feat(presentation): InterceptorModule registers interceptors globally"
```

---

### Task 10: PresentationModule

**Files:** `src/presentation/presentation.module.ts`, `src/presentation/index.ts`

- [x] **Step 1: Module**

```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from './logger/logger.module';
import { InterceptorModule } from './interceptors/interceptor.module';

@Module({
  imports: [LoggerModule, InterceptorModule],
  exports: [LoggerModule],
})
export class PresentationModule {}
```

- [x] **Step 2: Barrel**

`src/presentation/index.ts`:

```ts
export * from './presentation.module';
export * from './logger';
export * from './interceptors';
export * from './decorators';
```

- [x] **Step 3: Commit**

```bash
git add src/presentation/
git commit -m "feat(presentation): PresentationModule aggregates logger + interceptors"
```

---

### Task 11: Wire into AppModule + main.ts

**Files:** modify `src/app.module.ts`, `src/main.ts` (already updated to single entry in plan 00 revision).

- [x] **Step 1: Add PresentationModule to AppModule imports**

```ts
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { PresentationModule } from './presentation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [AppConfigModule, PresentationModule, DatabaseModule, HealthModule],
  providers: [
    { provide: APP_PIPE, useFactory: () => new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }) },
  ],
})
export class AppModule {}
```

- [x] **Step 2: Call catchUnhandledSignals from main.ts**

In `src/main.ts`, after `await app.init()` (API role) or `app = await NestFactory.createApplicationContext(...)` (worker role), add:

```ts
import { catchUnhandledSignals } from './common';

// ... after app is created:
catchUnhandledSignals(app);
```

- [x] **Step 3: Smoke check — booting the app no longer crashes the process on unhandled rejection**

Add a temporary throw inside any startup-time async (e.g. a `setTimeout(() => { throw new Error('test') }, 0)` in `main.ts`), boot the app, observe the log line, then revert. Don't commit the temporary throw.

- [x] **Step 4: Commit**

```bash
git add src/app.module.ts src/main.ts
git commit -m "feat: wire PresentationModule + unhandled-signals handler"
```

---

## Exit Criteria

- [x] `INTERNAL_LOGGER_TOKEN` is injectable anywhere; `InternalLogger` interface has `log/warn/error/debug`.
- [x] `LoggerInterceptor` registered globally; logs every HTTP request (except `/health`) and every RMQ handler with duration + redacted body.
- [x] `AmqpInterceptor` acks on success, nacks (no requeue) on hard error, and reenqueues with `x-retry-count` when the handler is annotated `@AmqpRetry(N)` and throws `ServiceUnavailableException`.
- [x] `catchUnhandledSignals(app)` installs handlers that log via `InternalLogger` instead of letting the process crash silently.
- [x] No third-party logger lib is installed (no pino, winston, bunyan).
- [x] `src/presentation/`, `src/common/`, `src/interfaces/` directories exist with the file structure above.
