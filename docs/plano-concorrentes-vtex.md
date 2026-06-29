# Plano — adicionar concorrentes VTEX (comparação de preço, grupo por tenant)

**Repo:** `farmacore` (NestJS, tenant-api). **Objetivo:** cadastrar mais
concorrentes para comparação de preço, **no mesmo padrão do Drogal** (uma classe
de scraper por loja — sem abstração genérica). Cada tenant continua tendo o seu
**grupo de concorrentes** (origens habilitadas), modelo que já existe.

> Princípio (CLAUDE.md): simplicidade dura. Mantemos a decisão documentada em
> `scrapers.module.ts` — "no shared base class, each origin's API differs enough".
> Cada nova loja = uma classe nova, espelhando uma das classes VTEX existentes.

---

## 1. Concorrentes a adicionar (verificados ao vivo em 2026-06-19)

Probe real do endpoint VTEX `…/api/catalog_system/pub/products/search?fq=alternateIds_Ean:<ean>`
(EAN de teste `7891058002602` = Dipirona Monoid):

| Loja | Domínio | Enum | VTEX | search-by-EAN | Captura | Observação |
|---|---|---|---|---|---|---|
| Drogaria Pacheco | `www.drogariaspacheco.com.br` | `PACHECO` | ✅ | ✅ 200 | **product-only** | grupo **DPSP** — backend idêntico ao São Paulo |
| Drogaria São Paulo | `www.drogariasaopaulo.com.br` | `SAO_PAULO` | ✅ | ✅ 200 | **product-only** | grupo **DPSP** (mesmo catálogo/preço do Pacheco) |
| Drogaria Venâncio | `www.drogariavenancio.com.br` | `VENANCIO` | ✅ | ✅ 200 | **product-only** | `referenceId` com prefixo `v_` (mas `itemId`/`productReferenceCode` é numérico) |
| Farmácia Indiana | `www.farmaciaindiana.com.br` | `INDIANA` | ✅ | ✅ 200 | **product-only** | limpo |
| Drogaria Araujo | `www.araujo.com.br` | `ARAUJO` | ✅ (é VTEX) | ❌ **403** | — | **bloqueado por Akamai WAF** → **adiado** (ver §6, decisão 1) |
| ~~Pague-Menos~~ | `www.paguemenos.com.br` | `PAGUE_MENOS` | — | — | — | **já existe** no enum, não refazer |

**Captura "product-only":** as 4 lojas limpas devolvem **preço
numa única chamada** — `commertialOffer.Price` (+ `ListPrice`). Não têm
PBM exposto nos produtos testados. Logo, o padrão correto a espelhar é
**Pague-Menos / Ikesaki** (`implements ProductScraper`), **não** o Drogal
completo (que tem checkout + measures + PBM próprios).

> "Baseado na Drogal" = mesma **estrutura/wiring** de um concorrente VTEX. Como
> estas lojas são mais simples que o Drogal (sem checkout/measures/PBM), o
> arquivo de scraper é uma cópia do `pague-menos.scraper.ts`, não do
> `drogal.scraper.ts`.

---

## 2. "Grupo de concorrentes por tenant" — já existe, nada novo

`core.tenant_competitor_origin` (`tenant_id`, `origin`, `enabled`, `priority`,
`config` jsonb) é o grupo por tenant. O fluxo:

- **Onboarding** (`tenant-onboarding.service.ts:101`) já faz `for (origin of Object.values(CompetitorOrigin))`
  e insere uma linha `enabled=false` por origem → **novos tenants pegam as novas
  origens automaticamente**.
- **Habilitar/priorizar** por tenant: `PUT /admin/tenants/:slug/competitor-origins`
  (`competitor-origins.controller.ts`) → `CompetitorOriginAdminService.bulkUpdate`
  (faz `UPDATE` das linhas existentes). É só por aqui que cada tenant escolhe o
  seu grupo.
- O dispatcher (`import-competitor-products.dispatch.consumer.ts:133`) lê
  `WHERE tenant_id AND enabled=true` e fan-out por (origem, ean) → **já é
  data-driven**. Habilitou, entra no scrape; desabilitou, sai.

Nada de tabela de "grupo" nova. Só precisamos garantir que as novas origens
existam como linha para **todos** os tenants (backfill, §3 passo 8).

---

## 3. Fase 1 — Ingestão (cadastrar + scrapear)

Para **cada** nova origem (`PACHECO`, `SAO_PAULO`, `VENANCIO`, `INDIANA`),
espelhando Pague-Menos. Passos na ordem, com os arquivos exatos:

1. **Enum** — `src/database/enums/competitor-origin.enum.ts`: adicionar os 4
   valores.
2. **Scraper** — `src/scrapers/<loja>/<loja>.scraper.ts` + `types.ts`: copiar
   `src/scrapers/pague-menos/*`, trocar `SEARCH_URL` (base URL da loja) e o
   `origin` em todos os pontos. `implements ProductScraper` (product-only).
   - Venâncio: o `productReferenceCode` é numérico (ok); não usar o `referenceId`
     com prefixo `v_`.
3. **Module** — `src/scrapers/scrapers.module.ts`: registrar a classe em
   `providers` **e** `exports`.
4. **Queue** — `src/queue/constants.ts`:
   - adicionar a origem ao array de `PER_ORIGIN_STEPS[IMPORT_COMPETITOR_PRODUCTS]`
     (cria a fila `import-competitor-products.<ORIGIN>` + DLQ via `QueueModule`);
   - adicionar entrada em `STEP_PREFETCH` com `originStep(...)` → prefetch **8**
     (mesma classe de carga de Pague-Menos/Ikesaki; ver nota legacy no arquivo).
5. **Consumer** — `src/pipeline/consumers/import-competitor-products.batch.consumers.ts`:
   novo `QUEUE_<LOJA> = originStep(IMPORT_COMPETITOR_PRODUCTS, <ORIGIN>)` + nova
   subclasse `ImportCompetitorProducts<Loja>Consumer extends CompetitorProductsBatchBase`
   com `@RabbitSubscribe({ queue: QUEUE_<LOJA>, routingKey: \`*.${QUEUE_<LOJA>}\`, … })`
   (copiar o bloco do `…PagueMenosConsumer`). Registrar a classe em
   `src/pipeline/pipeline-steps.module.ts` (`CONSUMERS`).
   - *Por que uma classe por origem:* `@RabbitSubscribe` liga **uma fila por
     método**. É o custo mecânico aceito do padrão atual (comentário em
     `batch.consumers.ts:50`).
6. **Import step** — `src/pipeline/steps/import-competitor-products.step.ts`:
   injetar o novo scraper no construtor + `case` em `scraperFor()`.
7. **Import manual (admin)** — `src/products/products.service.ts`: **não mexer**
   (decisão 4). As novas origens ficam só no pipeline; o import manual de 1 EAN
   segue com `drogal/drogasil/michelassi`.
8. **Migration (app)** — `migrations/core/1700000000037-add-vtex-competitors.ts`
   (próximo número; o datasource `migrations_app` carrega `core/*` **e**
   `shared_catalog/*`, então um arquivo só altera as duas tabelas):
   - `ALTER TABLE shared_catalog.product DROP CONSTRAINT chk_product_origin`,
     recriar com a lista de 5 + 4 novos valores;
   - `ALTER TABLE core.tenant_competitor_origin DROP CONSTRAINT chk_core_tco_origin`,
     recriar idem;
   - **backfill**: para cada nova origem,
     `INSERT INTO core.tenant_competitor_origin (tenant_id, origin, enabled)
     SELECT id, '<ORIGIN>', false FROM core.tenant ON CONFLICT DO NOTHING`
     (tenants já existentes ganham a linha; ficam `enabled=false` até o tenant
     habilitar). `down()` reverte os CHECKs para os 5 originais.

**Depois da Fase 1:** as novas origens são scrapeadas e gravadas em
`shared_catalog.product` (via `SharedProductRepository.upsertScrapes`, que já é
genérico sobre qualquer `origin`); cada tenant habilita o seu grupo pelo
endpoint admin.

---

## 4. Fase 2 — superfície de comparação de preço (read path)

É o que faz o concorrente novo **aparecer na comparação**. O read path do
catálogo tem hoje **colunas fixas por loja** (`drogalPrice`, `drogasilPrice`,
`michelassiPrice`) que **não escalam** para um grupo configurável por tenant.

**Já funciona de graça (genérico):** a decisão **combate / por-loja**
(`active-ingredients/crossed` + `decision-counts`) usa um LATERAL
`competitorCombate` = "concorrente com menor preço" **agnóstico de
origem** (`catalog.service.ts`) → as novas origens **já entram** na decisão
`subir/abaixar/ok` automaticamente, assim que habilitadas e scrapeadas.

**Precisa generalizar** (de colunas fixas por loja → array `competitors[]` sobre
as origens habilitadas do tenant) — todos em `src/tenant-api/catalog/catalog.service.ts`:

| Superfície | Hoje | Mudança |
|---|---|---|
| `crossed()` (lista cruzada) | `drogalPrice/drogasilPrice/michelassiPrice` (joins `origin='DROGAL'…`) | `competitors: [{origin, price, isPbm}]` por origem habilitada |
| `active-ingredients/crossed` `variants[]` | per-variant `drogalPrice/drogasilPrice` | idem (array por variante) |
| `exportCsv()` | colunas fixas `drogal/drogasil/michelassi` | colunas por origem habilitada |
| `calc-base-product-metrics.step.ts` `averageVariation` | só `DROGAL + DROGASIL` | **incluir as novas** (decisão 3) — generalizar o JOIN/agregação |
| `update-base-product-properties.step.ts` | só `DROGAL + DROGASIL` (`p.origin IN ('DROGAL','DROGASIL')` no repo) | provavelmente **manter** — é enriquecimento de propriedade do produto base, não comparação |

⚠️ **Isto muda o contrato da API** (impacto no frontend). O
`docs/plano-backend-regras-preco-e-sugestao.md` (§Contrato) **já previa** migrar
os 3 campos fixos para `competitors: {origin, price, isPbm, van}[]` — então a
Fase 2 alinha com aquele plano. Recomendação: contrato genérico `competitors[]`
(decisão 2, §6).

---

## 5. Verificação

1. **Unit (scraper):** um spec por loja espelhando um scraper VTEX existente
   (`drogasil.scraper.spec.ts` / `michelassi.scraper.spec.ts` como molde) —
   mapear preço/availability de um fixture de resposta VTEX, e o caminho
   `found:false` (EAN inexistente).
2. **e2e/manual:** habilitar a origem para o tenant semeado
   (`PUT /admin/tenants/:slug/competitor-origins`) → rodar o import
   (`POST …/pipeline/start` ou o step) → conferir linhas da nova `origin` em
   `shared_catalog.product`; conferir que entram na decisão combate
   (`GET /products/active-ingredients/crossed?subsidiary=…&tolerance=…`).
3. **Smoke do scrape (já validado neste plano):** EAN `7891058002602` retorna
   1 produto com `Price` em Pacheco, São Paulo, Venâncio e Indiana.

---

## 6. Decisões (resolvidas pelo Marco)

1. **Araujo** (Akamai `403`): **adiado do v1**. Fica de fora do enum, dos
   scrapers, da migration e do backfill. Reabrir quando houver tratamento
   (headless/proxy). → escopo v1 = **PACHECO, SAO_PAULO, VENANCIO, INDIANA**.
2. **Fase 2 — contrato:** _(em definição — ver mensagem; recomendação:
   `competitors[]` genérico)._
3. **`averageVariation`** (`calc-base-product-metrics`): **incluir** as novas
   origens no cálculo da variação média/`status` (generalizar o LEFT JOIN/agregação
   hoje fixos em `DROGAL + DROGASIL`).
4. **Import manual de 1 EAN** (`products.service`): **deixar só no pipeline** —
   não adicionar as novas em `productScrapers` (mantém o comportamento atual; não
   mexer no passo 7 da Fase 1).
5. **DPSP (Pacheco + São Paulo):** **2 origens separadas**, um registro/classe
   cada (dados iguais esperados).
