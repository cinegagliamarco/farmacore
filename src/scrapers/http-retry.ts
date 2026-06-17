import { HttpService } from '@nestjs/axios';
import axiosRetry, {
  exponentialDelay,
  isNetworkOrIdempotentRequestError,
} from 'axios-retry';

const MAX_RETRIES = 3;

/**
 * Retry transient scrape failures — 429 (rate limit), 5xx, and network
 * errors — with exponential backoff (axios-retry adds jitter). Read-only
 * scrape POSTs (Drogal checkout, Drogasil GraphQL) are safe to retry, so
 * we don't restrict to idempotent methods.
 *
 * A persistent 403 block (e.g. Drogasil's anti-bot) is intentionally NOT
 * retried here — an immediate retry returns the same 403. It surfaces as
 * found:false; clearing it needs scraper-level work, not generic retry.
 */
export function configureScraperRetry(http: HttpService): void {
  axiosRetry(http.axiosRef, {
    retries: MAX_RETRIES,
    retryDelay: exponentialDelay,
    retryCondition: (error) => {
      const status = error.response?.status;
      return (
        isNetworkOrIdempotentRequestError(error) ||
        status === 429 ||
        (status !== undefined && status >= 500)
      );
    },
  });
}
