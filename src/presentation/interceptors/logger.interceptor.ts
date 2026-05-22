import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, finalize, throwError } from 'rxjs';
import { INTERNAL_LOGGER_TOKEN, InternalLogger } from '../../interfaces';

const SENSITIVE_PROPERTY_KEYWORDS = ['password', 'pass', 'pwd', 'secret', 'token', 'ssn', 'bank'];
const HEALTH_SKIP = [{ method: 'GET', url: '/health' }];

interface HttpRequestLike {
  method?: string;
  route?: { path?: string };
  params?: unknown;
  body?: unknown;
  query?: unknown;
  ip?: string;
  user?: { sub?: string; tenantId?: string };
  header?: (name: string) => string | undefined;
}

interface HttpResponseLike {
  statusCode: number;
}

@Injectable()
export class LoggerInterceptor implements NestInterceptor {
  constructor(@Inject(INTERNAL_LOGGER_TOKEN) private readonly logger: InternalLogger) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = Date.now();
    let captured: HttpException | Error | null = null;

    return next.handle().pipe(
      catchError((err: unknown) => {
        captured = err as HttpException | Error;
        return throwError(() => err);
      }),
      finalize(() => {
        const duration = Date.now() - startedAt;
        this.dispatch(context, duration, captured);
      }),
    );
  }

  private dispatch(
    context: ExecutionContext,
    duration: number,
    exception: HttpException | Error | null,
  ): void {
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

  private logHttp(
    context: ExecutionContext,
    duration: number,
    exception: HttpException | Error | null,
  ): void {
    const req = context.switchToHttp().getRequest<HttpRequestLike>();
    if (this.shouldSkip(req)) return;
    const res = context.switchToHttp().getResponse<HttpResponseLike>();
    const user = req.user;

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

  private logRmq(
    context: ExecutionContext,
    duration: number,
    exception: HttpException | Error | null,
  ): void {
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

  private logRpc(
    context: ExecutionContext,
    duration: number,
    exception: HttpException | Error | null,
  ): void {
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

  private statusCode(
    res: HttpResponseLike,
    exception: HttpException | Error | null,
  ): number {
    if (!exception) return res.statusCode;
    return exception instanceof HttpException ? exception.getStatus() : 500;
  }

  private shouldSkip(req: HttpRequestLike): boolean {
    if (!req?.method || !req.route?.path) return true;
    const path = req.route.path;
    return HEALTH_SKIP.some((s) => s.method === req.method && path.includes(s.url));
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
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
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
