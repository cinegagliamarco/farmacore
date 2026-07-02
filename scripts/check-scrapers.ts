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

// Top 25 mais vendidos no Pague Menos (VTEX OrderByTopSaleDESC) — EANs reais
// confirmados via items[].ean. Sobrescreva na CLI:
//   npm run build:scripts && node dist/scripts/check-scrapers.js 7891058002602
//   node dist/scripts/check-scrapers.js --verbose
const DEFAULT_EANS = [
  '7891721201806',
  '7896382709135',
  '7908615013893',
  '7892828002303',
  '7500435240512',
  '7898430194238',
  '7896523227450',
  '7896026306751',
  '7896902212145',
  '5702191025637',
  '7896004704036',
  '7896004703398',
  '7500435265362',
  '7500435265386',
  '7896382709111',
  '7891150095809',
  '7891033551538',
  '7899095243866',
  '0000075076818',
  '7908615000244',
  '7908615000169',
  '7500435205795',
  '7891058002916',
  '7896116114044', // Ikesaki (beleza)
  '7897517932480', // Ikesaki (beleza)
];

const REQUIRED_WHEN_FOUND = ['name', 'price', 'sku'] as const;

interface Row {
  ean: string;
  origin: string;
  found: boolean;
  error: string | null;
  missing: string[];
  price: string | null;
  name: string | null;
}

function isEan(s: string): boolean {
  return /^\d{8,14}$/.test(s);
}

function inspect(r: ScrapedProduct): Row {
  const missing = r.found
    ? REQUIRED_WHEN_FOUND.filter((f) => r[f] == null || r[f] === '')
    : [];
  return {
    ean: r.ean,
    origin: r.origin,
    found: r.found,
    error: r.error ?? null,
    missing,
    price: r.price ?? null,
    name: r.name ?? null,
  };
}

function parseArgs(argv: string[]): { eans: string[]; verbose: boolean } {
  const verbose = argv.includes('--verbose');
  const eans = argv.filter((a) => a !== '--verbose' && isEan(a));
  return { eans: eans.length ? eans : DEFAULT_EANS, verbose };
}

function statusFor(row: Row): string {
  if (row.error) return '🔴 ERRO';
  if (!row.found) return '⚪ não encontrado';
  if (row.missing.length) return '🟡 campos faltando';
  return '🟢 ok';
}

function isProblem(row: Row): boolean {
  return Boolean(row.error) || (row.found && row.missing.length > 0);
}

function detailFor(row: Row): string {
  if (row.error) return row.error;
  if (!row.found) return '';
  const base = `price=${row.price ?? '—'} name=${(row.name ?? '—').slice(0, 40)}`;
  return row.missing.length
    ? `${base} | faltando: ${row.missing.join(', ')}`
    : base;
}

async function main(): Promise<void> {
  const { eans, verbose } = parseArgs(process.argv.slice(2));

  console.log(
    `scrapeProducts — ${eans.length} EAN(s)${eans === DEFAULT_EANS ? ' (default)' : ''}`,
  );

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

  // Michelassi (supermercado) não carrega farmácia — 404 é esperado; não conta no exit.
  const IGNORE_PROBLEMS = new Set(['MICHELASSI']);

  let problems = 0;

  for (const scraper of scrapers) {
    console.log(`\n================ ${scraper.origin} ================`);
    const results = await scraper.scrapeProducts(eans);
    if (results.length !== eans.length) {
      console.log(
        `⚠️  retornou ${results.length} resultados para ${eans.length} EANs pedidos`,
      );
    }

    const rows = results.map(inspect);
    const found = rows.filter((r) => r.found && !r.error).length;
    const notFound = rows.filter((r) => !r.found && !r.error).length;
    const errors = rows.filter((r) => r.error).length;
    const badFields = rows.filter(
      (r) => r.found && !r.error && r.missing.length > 0,
    ).length;

    console.log(
      `resumo: 🟢 ${found} ok | ⚪ ${notFound} não encontrado | 🔴 ${errors} erro | 🟡 ${badFields} campos faltando`,
    );

    const problemRows = rows.filter(isProblem);
    if (!IGNORE_PROBLEMS.has(scraper.origin)) {
      problems += problemRows.length;
    } else if (problemRows.length) {
      console.log(
        `(Michelassi: ${problemRows.length} erro(s) ignorado(s) — catálogo de supermercado)`,
      );
    }

    for (const row of verbose ? rows : problemRows) {
      console.log(
        `${statusFor(row).padEnd(20)} ${row.ean}  ${detailFor(row)}`.trimEnd(),
      );
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
