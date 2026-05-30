import { SyncBaseProductStep } from './sync-base-product.step';
import { parseEan } from '../../integration/repositories/a7pharma';
import type { ItemCadernoOfertaQuantidadeEntity } from '../../integration/entities/a7pharma/item-caderno-oferta-quantidade.entity';
import type { ClassificacaoProdutoEntity } from '../../integration/entities/a7pharma/classificacao-produto.entity';

/**
 * Unit specs for the pure helpers on SyncBaseProductStep. The full
 * orchestration (multi-repo writes, integration DS reads) lives in
 * the e2e suite in test/sync-base-product.e2e-spec.ts, which runs
 * against real Postgres + a stubbed A7Pharma DataSource.
 */
describe('SyncBaseProductStep helpers', () => {
  // Projector is unused by these pure-helper tests.
  const step = new SyncBaseProductStep(
    null as unknown as ConstructorParameters<typeof SyncBaseProductStep>[0],
  );
  // Reach into private helpers via type-cast; pragmatic alternative to
  // a separate utility module just for testability. parseEan lives in
  // the a7pharma chunker module so dispatcher + step share one parser.
  const h = step as unknown as {
    isGenericClassification(s?: string): boolean;
    toNumericString(v: unknown): string | null;
    buildDeals(qs?: ItemCadernoOfertaQuantidadeEntity[]): unknown;
    buildClassificationPathMap(
      rows: ClassificacaoProdutoEntity[],
    ): Record<string, string>;
  };

  describe('parseEan', () => {
    it('returns null for missing or empty', () => {
      expect(parseEan(undefined)).toBeNull();
      expect(parseEan('')).toBeNull();
      expect(parseEan('---')).toBeNull();
    });

    it('strips non-digits and pads to 13', () => {
      expect(parseEan('789-1234567890')).toBe('7891234567890');
    });

    it('rejects bar codes longer than 14 digits', () => {
      expect(parseEan('123456789012345')).toBeNull();
    });

    it('keeps a meaningful numeric string when input is short', () => {
      // "9876" -> pad to 13 -> "0000000009876" -> trimmed leading zeros -> "9876"
      expect(parseEan('9876')).toBe('9876');
    });
  });

  describe('isGenericClassification', () => {
    it('matches known generic paths exactly', () => {
      expect(h.isGenericClassification('GENERICO > OTC')).toBe(true);
      expect(
        h.isGenericClassification('GENERICO > PSICOS GENERICO > A1-GEN'),
      ).toBe(true);
    });

    it('does not match non-generic paths', () => {
      expect(h.isGenericClassification('REFERENCIA > ANALGESICO')).toBe(false);
      expect(h.isGenericClassification(undefined)).toBe(false);
      expect(h.isGenericClassification('')).toBe(false);
    });
  });

  describe('toNumericString', () => {
    it('returns null for nullish or non-finite values', () => {
      expect(h.toNumericString(null)).toBeNull();
      expect(h.toNumericString(undefined)).toBeNull();
      expect(h.toNumericString('not a number')).toBeNull();
    });

    it('stringifies numeric values', () => {
      expect(h.toNumericString(12.345)).toBe('12.345');
      expect(h.toNumericString('42')).toBe('42');
    });
  });

  describe('buildDeals', () => {
    it('returns null for empty input', () => {
      expect(h.buildDeals(undefined)).toBeNull();
      expect(h.buildDeals([])).toBeNull();
    });

    it('keys by quantidade and carries totals + discount', () => {
      const out = h.buildDeals([
        {
          quantidade: 3,
          precototal: 30,
          descontototal: 6,
          itemcadernoofertaid: 99,
        },
      ] as unknown as ItemCadernoOfertaQuantidadeEntity[]);
      expect(out).toEqual({
        '3': { totalPrice: 30, discount: 6, itemCadernoOfertaId: 99 },
      });
    });
  });

  describe('buildClassificationPathMap', () => {
    it('strips a leading "PRINCIPAL >" segment', () => {
      const out = h.buildClassificationPathMap([
        {
          produtoid: 1,
          classificacao: { caminho: 'PRINCIPAL > GENERICO > OTC' },
        },
      ] as unknown as ClassificacaoProdutoEntity[]);
      expect(out['1']).toBe('GENERICO > OTC');
    });

    it('skips rows with no caminho', () => {
      const out = h.buildClassificationPathMap([
        { produtoid: 2, classificacao: undefined },
      ] as unknown as ClassificacaoProdutoEntity[]);
      expect(out['2']).toBeUndefined();
    });
  });
});
