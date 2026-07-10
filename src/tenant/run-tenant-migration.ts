import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SLUG_RE } from './tenant-schema';

const execFileAsync = promisify(execFile);

// Verbose migrations overflow the 1 MiB default maxBuffer, which kills
// the child mid-run.
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Runs tenant migrations in a child process, keeping the event loop free
 * (a synchronous run would stall AMQP heartbeats / block the API).
 * execFile with array args — no shell — because the slug can arrive from
 * an AMQP message. Runtime-aware: prod runs compiled JS (ts-node is
 * pruned), dev runs the npm script via ts-node.
 */
export async function runTenantMigration(
  slug: string,
): Promise<{ stdout: string; stderr: string }> {
  if (!SLUG_RE.test(slug)) {
    throw new Error(`Invalid tenant slug for migration: "${slug}"`);
  }
  const [cmd, ...args] = __dirname.includes('/dist/')
    ? ['node', 'dist/scripts/migrate-tenant.js', slug]
    : ['npm', 'run', 'migration:tenant', slug];
  return execFileAsync(cmd, args, { maxBuffer: MAX_BUFFER });
}
