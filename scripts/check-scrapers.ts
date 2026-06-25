import { NestFactory } from '@nestjs/core';
import { ScrapersModule } from '../src/scrapers/scrapers.module';
import { DrogalScraper } from '../src/scrapers/drogal/drogal.scraper';
import { DrogasilScraper } from '../src/scrapers/drogasil/drogasil.scraper';
import { MichelassiScraper } from '../src/scrapers/michelassi/michelassi.scraper';
import { PagueMenosScraper } from '../src/scrapers/pague-menos/pague-menos.scraper';
import { IkesakiScraper } from '../src/scrapers/ikesaki/ikesaki.scraper';
import { PachecoScraper } from '../src/scrapers/pacheco/pacheco.scraper';
import { SaoPauloScraper } from '../src/scrapers/sao-paulo/sao-paulo.scraper';
import { VenancioScraper } from '../src/scrapers/venancio/venancio.scraper';
import { IndianaScraper } from '../src/scrapers/indiana/indiana.scraper';
import { ProductScraper, ScrapedProduct } from '../src/scrapers/types';

// EANs reais de produtos de alta distribuição (devem existir na maioria dos
// catálogos). Sobrescreva passando EANs como argumentos:
//   npm run build:scripts && node dist/scripts/check-scrapers.js 7891058014872
const DEFAULT_EANS = [
  '7896094922396', // Neosaldina 10 drágeas
  '7896094999992', // Neosaldina 30 drágeas
];

// Campos que, quando found=true, esperamos sempre ver preenchidos.
const REQUIRED_WHEN_FOUND = ['name', 'price', 'sku'] as const;

interface Row {
  origin: string;
  found: boolean;
  error: string | null;
  missing: string[];
  price: string | null;
  name: string | null;
}

function inspect(r: ScrapedProduct): Row {
  const missing = r.found
    ? REQUIRED_WHEN_FOUND.filter((f) => r[f] == null || r[f] === '')
    : [];
  return {
    origin: r.origin,
    found: r.found,
    error: r.error ?? null,
    missing,
    price: r.price ?? null,
    name: r.name ?? null,
  };
}

async function main(): Promise<void> {
  const eans = process.argv.slice(2).length
    ? process.argv.slice(2)
    : DEFAULT_EANS;

  const app = await NestFactory.createApplicationContext(ScrapersModule, {
    logger: ['error'],
  });

  const scrapers: ProductScraper[] = [
    app.get(DrogalScraper),
    app.get(DrogasilScraper),
    app.get(MichelassiScraper),
    app.get(PagueMenosScraper),
    app.get(IkesakiScraper),
    app.get(PachecoScraper),
    app.get(SaoPauloScraper),
    app.get(VenancioScraper),
    app.get(IndianaScraper),
  ];

  let problems = 0;

  for (const ean of eans) {
    console.log(`\n================ EAN ${ean} ================`);
    const results = await Promise.all(
      scrapers.map((s) => s.scrapeProduct(ean)),
    );

    for (const result of results) {
      const row = inspect(result);
      const ok = row.found && row.missing.length === 0 && !row.error;
      const status = row.error
        ? '🔴 ERRO'
        : !row.found
          ? '⚪ não encontrado'
          : row.missing.length
            ? '🟡 campos faltando'
            : '🟢 ok';
      if (!ok && !(!row.found && !row.error)) problems++;

      const detail = row.error
        ? row.error
        : row.found
          ? `price=${row.price ?? '—'} name=${(row.name ?? '—').slice(0, 40)}` +
            (row.missing.length ? ` | faltando: ${row.missing.join(', ')}` : '')
          : '';
      console.log(`${status.padEnd(20)} ${row.origin.padEnd(14)} ${detail}`);
    }
  }

  await app.close();

  console.log(
    `\n${problems === 0 ? '✅' : '⚠️'} ${problems} ocorrência(s) de erro ou campo faltando.`,
  );
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
