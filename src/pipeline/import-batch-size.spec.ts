import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';
import { chunkSizeForOrigin } from './import-batch-size';

describe('chunkSizeForOrigin', () => {
  it('uses VTEX batch size for VTEX simple origins', () => {
    expect(chunkSizeForOrigin(CompetitorOrigin.PAGUE_MENOS, 25, 1)).toBe(25);
    expect(chunkSizeForOrigin(CompetitorOrigin.INDIANA, 25, 1)).toBe(25);
  });

  it('uses non-VTEX batch size for Drogasil, Drogal, Michelassi', () => {
    expect(chunkSizeForOrigin(CompetitorOrigin.DROGASIL, 25, 1)).toBe(1);
    expect(chunkSizeForOrigin(CompetitorOrigin.DROGAL, 25, 3)).toBe(3);
  });

  it('clamps to at least 1', () => {
    expect(chunkSizeForOrigin(CompetitorOrigin.PACHECO, 0, 0)).toBe(1);
  });

  it('batch size 1 restores legacy 1-EAN/msg for VTEX', () => {
    expect(chunkSizeForOrigin(CompetitorOrigin.IKESAKI, 1, 1)).toBe(1);
  });
});
