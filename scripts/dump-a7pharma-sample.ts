import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from 'pg';

// Pulls a referentially-coherent slice of the A7Pharma ERP (rooted at N
// embalagens — the main integration entity) from the source DB and writes a
// self-contained .sql seed: DROP/CREATE TABLE (full columns, from the source's
// information_schema) + INSERTs. Loaded into the local docker `erp` container
// via initdb so the pipeline can run end-to-end offline. Source defaults to the
// macfarma ngrok dev DB; override with A7PHARMA_SOURCE_URL.
const SOURCE_URL =
  process.env.A7PHARMA_SOURCE_URL ??
  'postgres://leitura_053401619_101224:qnseXKaq1HXtxR8@5.tcp.ngrok.io:28501/ultrapopularbariri_loja01_20231116';
const N_EMBALAGENS = Number(process.env.A7PHARMA_SAMPLE_SIZE ?? 10000);
const MAX_RECEIPT_ITEMS = 20000; // cap the highest-volume child table
const OUT = path.join(__dirname, '..', 'docker', 'erp-seed', 'a7pharma-sample.sql');

// Tables emitted in dependency order so a plain top-to-bottom load works even
// if someone later adds FK constraints.
const TABLE_ORDER = [
  'pessoa',
  'fabricante',
  'principioativo',
  'classificacao',
  'produto',
  'embalagem',
  'custoproduto',
  'classificacaoproduto',
  'estoque',
  'recebimentofisico',
  'itemrecebimentofisico',
  'cadernooferta',
  'itemcadernooferta',
  'itemcadernoofertaquantidade',
];

function ddlType(c: {
  data_type: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}): string {
  switch (c.data_type) {
    case 'character varying':
      return `varchar(${c.character_maximum_length})`;
    case 'character':
      return `char(${c.character_maximum_length})`;
    case 'numeric':
      return `numeric(${c.numeric_precision},${c.numeric_scale})`;
    case 'timestamp without time zone':
      return 'timestamp';
    case 'timestamp with time zone':
      return 'timestamptz';
    default:
      return c.data_type; // bigint, integer, boolean, text, date, …
  }
}

const NUMERIC = new Set(['bigint', 'integer', 'smallint', 'numeric', 'double precision', 'real']);

function literal(value: unknown, dataType: string): string {
  if (value === null || value === undefined) return 'NULL';
  if (dataType === 'boolean') return value ? 'true' : 'false';
  if (NUMERIC.has(dataType)) return String(value); // pg returns bigint/numeric as strings
  const s = value instanceof Date ? value.toISOString() : String(value);
  return `'${s.replace(/'/g, "''")}'`;
}

async function main(): Promise<void> {
  const c = new Client({ connectionString: SOURCE_URL, ssl: false, statement_timeout: 120000 });
  await c.connect();

  const ids = async (sql: string, params: unknown[]): Promise<number[]> =>
    (await c.query(sql, params)).rows.map((r) => r.id ?? Object.values(r)[0]);

  // Root: embalagens with an EAN, on an active produto — the keys the pipeline
  // cares about — then everything that references them.
  const embalagemIds = await ids(
    `SELECT e.id FROM embalagem e
       JOIN produto p ON p.id = e.produtoid
      WHERE e.codigobarras IS NOT NULL AND p.status = 'A'
      ORDER BY e.id LIMIT $1`,
    [N_EMBALAGENS],
  );
  const produtoIds = await ids(`SELECT DISTINCT produtoid AS id FROM embalagem WHERE id = ANY($1)`, [embalagemIds]);
  const itemRecRows = (
    await c.query(`SELECT * FROM itemrecebimentofisico WHERE embalagemid = ANY($1) LIMIT $2`, [
      embalagemIds,
      MAX_RECEIPT_ITEMS,
    ])
  ).rows;
  const recebimentoIds = [...new Set(itemRecRows.map((r) => r.recebimentofisicoid))];
  const itemOfferRows = (
    await c.query(`SELECT * FROM itemcadernooferta WHERE embalagemid = ANY($1)`, [embalagemIds])
  ).rows;
  const cadernoIds = [...new Set(itemOfferRows.map((r) => r.cadernoofertaid))];
  const itemOfferIds = itemOfferRows.map((r) => r.id);

  const produtoRows = (await c.query(`SELECT * FROM produto WHERE id = ANY($1)`, [produtoIds])).rows;
  const fabricanteIds = [
    ...new Set([
      ...produtoRows.map((r) => r.fabricanteid),
      ...itemOfferRows.map((r) => r.fabricanteid).filter((v) => v != null),
    ]),
  ];
  const principioIds = [...new Set(produtoRows.map((r) => r.principioativoid).filter((v) => v != null))];
  const fabricanteRows = (
    await c.query(`SELECT * FROM fabricante WHERE id = ANY($1)`, [fabricanteIds])
  ).rows;
  const pessoaIds = [...new Set(fabricanteRows.map((r) => r.pessoaid))];
  // Classificacao referenced by produtos and offers, plus their full ancestor chain.
  const leafClassIds = [
    ...new Set([
      ...(await ids(`SELECT classificacaoid AS id FROM classificacaoproduto WHERE produtoid = ANY($1)`, [produtoIds])),
      ...itemOfferRows.map((r) => r.classificacaoid).filter((v) => v != null),
    ]),
  ];

  const rowsByTable: Record<string, Record<string, unknown>[]> = {
    pessoa: (await c.query(`SELECT * FROM pessoa WHERE id = ANY($1)`, [pessoaIds])).rows,
    fabricante: fabricanteRows,
    principioativo: (await c.query(`SELECT * FROM principioativo WHERE id = ANY($1)`, [principioIds])).rows,
    classificacao: (
      await c.query(
        `WITH RECURSIVE anc AS (
           SELECT * FROM classificacao WHERE id = ANY($1)
           UNION
           SELECT c.* FROM classificacao c JOIN anc a ON c.id = a.classificacaopaiid
         ) SELECT * FROM anc`,
        [leafClassIds],
      )
    ).rows,
    produto: produtoRows,
    embalagem: (await c.query(`SELECT * FROM embalagem WHERE id = ANY($1)`, [embalagemIds])).rows,
    custoproduto: (await c.query(`SELECT * FROM custoproduto WHERE produtoid = ANY($1)`, [produtoIds])).rows,
    classificacaoproduto: (
      await c.query(`SELECT * FROM classificacaoproduto WHERE produtoid = ANY($1)`, [produtoIds])
    ).rows,
    estoque: (await c.query(`SELECT * FROM estoque WHERE embalagemid = ANY($1)`, [embalagemIds])).rows,
    recebimentofisico: (await c.query(`SELECT * FROM recebimentofisico WHERE id = ANY($1)`, [recebimentoIds])).rows,
    itemrecebimentofisico: itemRecRows,
    cadernooferta: (await c.query(`SELECT * FROM cadernooferta WHERE id = ANY($1)`, [cadernoIds])).rows,
    itemcadernooferta: itemOfferRows,
    itemcadernoofertaquantidade: (
      await c.query(`SELECT * FROM itemcadernoofertaquantidade WHERE itemcadernoofertaid = ANY($1)`, [itemOfferIds])
    ).rows,
  };

  // Column metadata for DDL + value serialization.
  const cols = (
    await c.query(
      `SELECT table_name, column_name, ordinal_position, data_type,
              character_maximum_length, numeric_precision, numeric_scale, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1)
        ORDER BY table_name, ordinal_position`,
      [TABLE_ORDER],
    )
  ).rows;
  const colsByTable: Record<string, typeof cols> = {};
  for (const col of cols) (colsByTable[col.table_name] ??= []).push(col);

  await c.end();

  const out: string[] = [
    '-- A7Pharma ERP sample — generated by scripts/dump-a7pharma-sample.ts',
    `-- Source slice: ${embalagemIds.length} embalagens (+ ${produtoIds.length} produtos) and their related rows.`,
    'SET client_min_messages = warning;',
    '',
  ];

  for (const t of TABLE_ORDER) {
    const tcols = colsByTable[t];
    out.push(`DROP TABLE IF EXISTS public.${t} CASCADE;`);
    const colDefs = tcols.map(
      (col) => `  ${col.column_name} ${ddlType(col)}${col.is_nullable === 'NO' ? ' NOT NULL' : ''}`,
    );
    out.push(`CREATE TABLE public.${t} (\n${colDefs.join(',\n')}\n);`);

    const rows = rowsByTable[t];
    if (rows.length) {
      const colNames = tcols.map((col) => col.column_name);
      const typeByName = Object.fromEntries(tcols.map((col) => [col.column_name, col.data_type]));
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const values = chunk
          .map((r) => `  (${colNames.map((n) => literal(r[n], typeByName[n])).join(', ')})`)
          .join(',\n');
        out.push(`INSERT INTO public.${t} (${colNames.join(', ')}) VALUES\n${values};`);
      }
    }
    out.push('');
    console.log(`  ${t.padEnd(28)} ${rows.length} rows`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out.join('\n'));
  console.log(`\nWrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
