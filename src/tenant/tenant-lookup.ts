import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * Resolve a tenant slug (from the JWT) to its core.tenant uuid — needed
 * when a tenant request touches core tables keyed by tenant_id
 * (status_settings, price_rounding_*). The request EntityManager can read
 * `core` directly (explicit schema), regardless of search_path.
 */
export async function resolveTenantId(
  em: EntityManager,
  slug: string,
): Promise<string> {
  const rows: Array<{ id: string }> = await em.query(
    `SELECT id FROM core.tenant WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  if (!rows.length) throw new NotFoundException(`tenant ${slug} not found`);
  return rows[0].id;
}
