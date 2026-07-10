import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';

const VTEX_SIMPLE_ORIGINS = new Set<CompetitorOrigin>([
  CompetitorOrigin.PAGUE_MENOS,
  CompetitorOrigin.IKESAKI,
  CompetitorOrigin.PACHECO,
  CompetitorOrigin.SAO_PAULO,
  CompetitorOrigin.VENANCIO,
  CompetitorOrigin.INDIANA,
]);

function isVtexSimpleOrigin(origin: CompetitorOrigin): boolean {
  return VTEX_SIMPLE_ORIGINS.has(origin);
}

export function chunkSizeForOrigin(
  origin: CompetitorOrigin,
  vtexBatchSize: number,
  nonVtexBatchSize: number,
): number {
  const size = isVtexSimpleOrigin(origin) ? vtexBatchSize : nonVtexBatchSize;
  return Math.max(1, size);
}
