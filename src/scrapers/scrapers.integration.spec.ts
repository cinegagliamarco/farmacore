import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplicationContext, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';
import { ScrapersModule } from './scrapers.module';
import { ProductScraper } from './types';
import { DrogalScraper } from './drogal/drogal.scraper';
import { DrogasilScraper } from './drogasil/drogasil.scraper';
import { MichelassiScraper } from './michelassi/michelassi.scraper';
import { PagueMenosScraper } from './pague-menos/pague-menos.scraper';
import { IkesakiScraper } from './ikesaki/ikesaki.scraper';
import { PachecoScraper } from './pacheco/pacheco.scraper';
import { SaoPauloScraper } from './sao-paulo/sao-paulo.scraper';
import { VenancioScraper } from './venancio/venancio.scraper';
import { IndianaScraper } from './indiana/indiana.scraper';

// Live integration tests — they hit each competitor's real API/storefront.
// Skipped by default so `npm test` stays offline and deterministic; run on
// demand to check the scrapers are still working against the live sites:
//   npm run test:scrapers
const suite = process.env.SCRAPER_IT === '1' ? describe : describe.skip;

// One high-distribution EAN each store is known to carry. When a case starts
// failing with found=false or an error, the store changed its API/markup and
// the scraper needs attention — that is exactly what this suite is here to
// catch.
const CASES: {
  origin: CompetitorOrigin;
  scraper: Type<ProductScraper>;
  ean: string;
}[] = [
  {
    origin: CompetitorOrigin.DROGAL,
    scraper: DrogalScraper,
    ean: '7896094922396',
  },
  {
    origin: CompetitorOrigin.DROGASIL,
    scraper: DrogasilScraper,
    ean: '7896094922396',
  },
  {
    origin: CompetitorOrigin.PAGUE_MENOS,
    scraper: PagueMenosScraper,
    ean: '7896094922396',
  },
  {
    origin: CompetitorOrigin.VENANCIO,
    scraper: VenancioScraper,
    ean: '7896094922396',
  },
  {
    origin: CompetitorOrigin.INDIANA,
    scraper: IndianaScraper,
    ean: '7896094922396',
  },
  {
    origin: CompetitorOrigin.PACHECO,
    scraper: PachecoScraper,
    ean: '7896094999992',
  },
  {
    origin: CompetitorOrigin.SAO_PAULO,
    scraper: SaoPauloScraper,
    ean: '7896094999992',
  },
  {
    origin: CompetitorOrigin.MICHELASSI,
    scraper: MichelassiScraper,
    ean: '7896094999992',
  },
  {
    origin: CompetitorOrigin.IKESAKI,
    scraper: IkesakiScraper,
    ean: '7891350035872',
  },
];

const NONEXISTENT_EAN = '0000000000000';
const REQUEST_TIMEOUT_MS = 60_000;

suite('scrapers (live)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(ScrapersModule, {
      logger: false,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(CASES)(
    '$origin finds a known EAN and returns a priced product',
    async ({ origin, scraper, ean }) => {
      const result = await app.get(scraper).scrapeProduct(ean);

      expect(result.origin).toBe(origin);
      expect(result.error).toBeFalsy();
      expect(result.found).toBe(true);
      expect(result.name).toBeTruthy();
      const price = Number(result.price);
      expect(Number.isFinite(price)).toBe(true);
      expect(price).toBeGreaterThan(0);
    },
    REQUEST_TIMEOUT_MS,
  );

  // Drogasil is the two-step scraper (search HTML -> GraphQL productBySku);
  // assert the full field mapping survives the round trip end to end.
  it(
    'Drogasil maps the full product payload',
    async () => {
      const result = await app
        .get(DrogasilScraper)
        .scrapeProduct('7896094922396');

      expect(result.found).toBe(true);
      expect(result.sku).toBeTruthy();
      expect(result.brand).toBeTruthy();
      expect(result.supplier).toBeTruthy();
      expect(result.name).toContain('Neosaldina');
      expect(result.metadata?.description).toBeTruthy();
      expect(result.metadata?.image).toMatch(/^https?:\/\//);
      expect(typeof result.metadata?.isPbm).toBe('boolean');
    },
    REQUEST_TIMEOUT_MS,
  );

  // found=false means "not in this catalog", distinct from a transport error.
  it(
    'Drogasil returns found=false without error for a nonexistent EAN',
    async () => {
      const result = await app
        .get(DrogasilScraper)
        .scrapeProduct(NONEXISTENT_EAN);

      expect(result.found).toBe(false);
      expect(result.error).toBeFalsy();
    },
    REQUEST_TIMEOUT_MS,
  );
});
