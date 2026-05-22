export const INTERNAL_LOGGER_TOKEN = Symbol('INTERNAL_LOGGER');

export interface InternalLogger {
  log(payload: unknown, ctx?: unknown): void;
  warn(payload: unknown, ctx?: unknown): void;
  error(message: string, ctx?: unknown): void;
  debug(payload: unknown, ctx?: unknown): void;
}
