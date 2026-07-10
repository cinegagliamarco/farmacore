// Single source of truth for the slug -> Postgres schema mapping that
// isolates tenants. 'system' is the reserved admin pseudo-tenant.
export function schemaNameFor(slug: string): string {
  return slug === 'system' ? 'system' : `tenant_${slug.replace(/-/g, '_')}`;
}

// Slugs that would shadow system schemas/subdomains. Shared by every tenant
// creation path (admin API and CLI script) so a word added here blocks both.
export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'meta',
  'shared',
  'system',
  'www',
]);

export const SLUG_RE = /^[a-z][a-z0-9-]{2,31}$/;
