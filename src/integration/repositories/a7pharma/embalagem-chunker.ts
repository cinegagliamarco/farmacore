import { EmbalagemRepository } from './embalagem.repository';

export interface EmbalagemBatchSlice {
  embalagemIds: number[];
}

/**
 * EAN-13 canonicalization: strip non-digits, cap at 14 chars,
 * left-pad to 13, drop leading zeros (preserving at least one digit).
 * Returns null for empty, oversized, or non-positive barcodes.
 * Shared between the dispatcher (groups embalagens by EAN) and the
 * step (re-derives EAN per row when writing).
 */
export function parseEan(codigobarras?: string | null): string | null {
  if (!codigobarras) return null;
  const cleaned = codigobarras.replace(/\D/g, '');
  if (!cleaned.length || cleaned.length > 14) return null;
  const padded = cleaned.padStart(13, '0');
  const numeric = Number(padded);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return padded.replace(/^0+(?=\d)/, '') || '0';
}

/**
 * Groups every valid embalagem by parsed EAN, then chunks the EAN
 * universe into slices of `batchSize` distinct EANs. All embalagens
 * sharing one of a slice's EANs land in the same batch — without this,
 * two embalagens with the same barcode in different batches step on
 * each other's writes (base_product upsert, product_stock
 * delete-then-insert).
 */
export async function chunkEmbalagensByEan(
  repo: EmbalagemRepository,
  batchSize: number,
): Promise<EmbalagemBatchSlice[]> {
  const rows = await repo.findAllValidWithBarcode();
  const idsByEan = new Map<string, number[]>();
  for (const row of rows) {
    const ean = parseEan(row.codigobarras);
    if (!ean) continue;
    const existing = idsByEan.get(ean);
    if (existing) existing.push(row.id);
    else idsByEan.set(ean, [row.id]);
  }

  const eans = [...idsByEan.keys()];
  const slices: EmbalagemBatchSlice[] = [];
  for (let i = 0; i < eans.length; i += batchSize) {
    const sliceIds: number[] = [];
    for (const ean of eans.slice(i, i + batchSize)) {
      sliceIds.push(...idsByEan.get(ean)!);
    }
    slices.push({ embalagemIds: sliceIds });
  }
  return slices;
}
