import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { A7PharmaRepositories } from '../../integration/repositories/a7pharma';
import { resolveTenantId } from '../../tenant/tenant-lookup';

interface SyncStoresResult {
  processed: number;
  skipped: number;
}

/**
 * Imports A7Pharma stores (`unidadenegocio`, status='A') into
 * core.tenant_store, matched/deduped by CNPJ. New rows land `active=false`
 * (opt-in); existing rows keep their `active` toggle untouched — only
 * external_id and name are refreshed. Rows without a CNPJ are skipped.
 */
@Injectable()
export class SyncStoresStep {
  private readonly logger = new Logger(SyncStoresStep.name);

  public async run(
    em: EntityManager,
    integrationDs: DataSource | null,
    tenantSlug: string,
  ): Promise<SyncStoresResult> {
    if (!integrationDs) {
      this.logger.warn('Skipping sync-stores: integration DataSource missing');
      return { processed: 0, skipped: 0 };
    }
    const a7 = new A7PharmaRepositories(integrationDs);
    const tenantId = await resolveTenantId(em, tenantSlug);
    const stores = await a7.unidadeNegocio.findAllActive();

    let processed = 0;
    let skipped = 0;
    for (const s of stores) {
      const cnpj = digitsOnly(s.cnpj);
      if (!cnpj) {
        skipped++;
        continue;
      }
      const name = s.nomefantasia || s.razaosocial || s.nome || cnpj;
      // Match on external_id (the ERP's stable store id) rather than cnpj:
      // legacy rows predate the cnpj column and carry NULL cnpj, so a
      // cnpj-keyed upsert would miss them and collide on
      // UQ_TENANT_STORE_EXTERNAL_ID. Keying on external_id backfills cnpj on
      // those rows in place. active is inserted false and never overwritten.
      await em.query(
        `INSERT INTO core.tenant_store
           (tenant_id, external_id, name, cnpj, active)
         VALUES ($1, $2, $3, $4, false)
         ON CONFLICT (tenant_id, external_id) DO UPDATE
           SET name = EXCLUDED.name,
               cnpj = EXCLUDED.cnpj,
               updated_at = now()`,
        [tenantId, String(s.id), name, cnpj],
      );
      processed++;
    }

    this.logger.debug(
      `sync-stores: ${processed} stores upserted, ${skipped} skipped (no cnpj)`,
    );
    return { processed, skipped };
  }
}

function digitsOnly(cnpj: string | undefined): string | null {
  if (!cnpj) return null;
  const digits = cnpj.replace(/\D/g, '');
  return digits.length ? digits : null;
}
