# Backend: Regras de Preço + Sugestão de Preços (port do legado → farmacore)

## Context

A feature é a tela **`/precos/sugestoes`** ("Sugestão de Precificação") + **`/precos/sugestoes/regras`**
("Regras de Sugestão") do **pricy-shelf** (frontend React em `artifacts/pricy` + backend legado
Express em `artifacts/api-server`):
- `…/pages/precos/SugestaoPrecificacao.tsx` — tabela de produtos com **preço sugerido** calculado,
  filtros (nome, classificação, cadernos, direção subir/abaixar, origem cluster/classificação,
  "só com sugestão"), edição inline do preço e **aplicar/agendar** mudança de preço.
- `…/pages/precos/RegrasSugestao.tsx` — CRUD das regras de sugestão.

O objetivo é **portar esse backend legado para o novo app farmacore** (NestJS 11, multi-tenant,
TypeORM, schema-per-tenant), que está sendo reconstruído e ainda **não tem esse módulo**.

O farmacore-legacy (`precos` / `legacy-app`) tinha apenas `offer-book-rules` e
`strategic-price` — **não** tem o motor de sugestão por estratégia margem/concorrência.
Portanto este módulo é **novo no farmacore**, modelado sobre a implementação do pricy-shelf.

**Legado a portar (fonte da verdade):**
- `…/pricy-shelf-master/nagoya/artifacts/api-server/src/functions/_shared/pricing-suggestion-engine.ts` — o motor (funções puras).
- `…/_shared/pricing-suggestion-rules-store.ts` — CRUD + validação das regras.
- `…/pricing-suggestions-products.ts` — orquestração do endpoint de sugestões.
- `…/_shared/product-clusters-store.ts` + `clusters-{list,get,save,delete}.ts` — clusters.
- `…/price-rounding-proxy.ts` / `price-rounding-types-proxy.ts` — arredondamento.
- Schema Drizzle: `…/lib/db/src/schema/pricing-suggestion-rules.ts`, `product-clusters.ts`.

**Pré-condição (logística):** o código do farmacore vive em **outro repo**
(`github.com/cinegagliamarco/farmacore`, hoje em `…/farmacore2/new-york/farmacore`, branch
`main`), separado do repo `farmacore2` ao qual este workspace (`bogota`) pertence. Conforme
decidido, o primeiro passo é **trazer o app farmacore para este workspace** e trabalhar aqui
(ver Fase 0).

## Alvo: convenções do farmacore que o módulo deve seguir

- **Multi-tenant por schema.** Cada request autenticado roda dentro de uma transação com
  `SET LOCAL search_path TO "tenant_<slug>", shared_catalog, public` —
  `src/tenant/interceptors/search-path.interceptor.ts` + `src/tenant/tenant-transaction.service.ts`.
  O `EntityManager` tenant-scoped é anexado em `req.entityManager`.
- **Entidades** estendem `BaseEntity` (`src/database/entities/base.entity.ts`: `id` uuid,
  `createdAt`, `updatedAt`, `deletedAt`). Entidades tenant ficam em `src/database/entities/tenant/`.
- **Repositórios** são classes simples que recebem o `EntityManager` no construtor e usam
  `this.em.getRepository(Entity)` — ex.: `src/database/repositories/tenant/offer-book.repository.ts`.
- **DTOs** com `class-validator` + `class-transformer` (validação só na borda).
- **Migrations tenant** em `migrations/tenant/` (templated por schema; runner em
  `scripts/migrate-tenant.ts`). Princípio do projeto (`CLAUDE.md`): **simplicidade dura** —
  zero abstração prematura, validar só em fronteiras.
- **Auth:** JWT (`/auth/login`); `TenantContext` (request-scoped) expõe `tenantSlug`/`schemaName`.
  As rotas deste módulo são **do usuário-tenant** (não system-admin), protegidas por JWT e
  escopadas automaticamente pelo `SearchPathInterceptor`.

**Scaffold já existente no farmacore** (stubs vazios, a preencher/realinhar):
`src/database/entities/tenant/price-rounding-rule.entity.ts` e
`price-rounding-decimal-range.entity.ts` (placeholders de ~14 linhas). **Não existe** nada de
`pricing_suggestion_rule` nem `product_cluster`.

## Modelo de dados (schema do tenant)

Novas entidades TypeORM em `src/database/entities/tenant/` (espelham o schema Drizzle do legado):

1. **`pricing-suggestion-rule.entity.ts`** → tabela `pricing_suggestion_rule`
   - `name` text; `classifications` jsonb `string[]` (default `[]`);
     `clusterId` uuid nullable; `excludeClusterIds` jsonb `string[]`;
     `strategy` text (`'margem'`|`'concorrencia'`); `minMargin` numeric(6,2);
     `competitors` jsonb `{competitor,weight}[]`; `variationPct` numeric(6,2);
     `priceControlled` bool; `ignorePbm` bool; `applyRounding` bool;
     `priceRoundingTypeId` int nullable; `active` bool.
   - CHECK: regra mira **classificação OU cluster** (não os dois) — `clusterId` setado ⇒ `classifications=[]`.
2. **`product-cluster.entity.ts`** (`product_cluster`: `name`) + **`product-cluster-member.entity.ts`**
   (`product_cluster_member`: PK `(clusterId, ean)`). Membership **estática Fase 1** (manual/CSV).
3. **Arredondamento** — preencher os stubs alinhando ao modelo do precos
   (`…/repos/precos/src/database/entities/price-rounding-*.entity.ts`):
   `price_rounding_rule` (nome, active, tipo) + `price_rounding_decimal_range`
   (faixa de preço `priceRangeMin/Max` → faixas decimais `decimalRangeFrom/To` → `roundTo`).
   O motor consome no formato `PriceRoundingRange { price_min, price_max, rules:[{decimal_min, decimal_max, round_to}] }`.

Uma migration em `migrations/tenant/` cria as 3+ tabelas. Indexar `pricing_suggestion_rule(active)`
e `product_cluster_member(ean)`.

## Dependência-chave: dados do produto direto no banco

O motor precisa, por produto: **custo, preço de venda, preço de oferta, margem, classificação,
preços de concorrentes e flag PBM**. No legado isso vinha do ERP via `products-proxy` (uma API).
**Aqui NÃO — consultar diretamente o banco** (schema do tenant + `shared_catalog`) via TypeORM
QueryBuilder/SQL. **Sem endpoint/API `crossed`, sem proxy.** Construir um repositório de leitura
(ex. `pricing-product-data.repository.ts`) que faz o join direto:

- **tenant `product`** (`cost`/`averageUnitCost`, `price`/`unitSalePrice`, `margin`,
  `classificationId`, `deals`) — `src/database/entities/tenant/product.entity.ts`
- **tenant `offer_book`** (`targetPrice` = preço de oferta, por `ean`)
- **`shared_catalog.product`** (preço do concorrente por `ean`+`origin`), filtrado pelas
  origens habilitadas em **`tenant_competitor_origin`** (`enabled=true`).

Tudo numa única query (o `search_path` já resolve tabelas do tenant; `shared_catalog.product`
é referenciado por schema). Paginação/filtros server-side no próprio SQL quando possível.

- **PBM:** vem de uma **coluna no banco** (booleana — produto é PBM ou não) na competitor
  `shared_catalog.product`, por origem. O read agrega: `product.pbm = true` se qualquer origem
  habilitada do tenant marcar PBM, e expõe a flag por origem no contrato (como o legado
  `drogalIsPbm`/`drogasilIsPbm`). Lida direto da coluna — sem metadata/fallback.
- **Concorrentes:** o motor legado fixa `drogal|drogasil|michelassi`; farmacore tem 5 origens
  (`CompetitorOrigin`). Generalizar a lista de concorrentes da regra para as origens habilitadas
  do tenant (mapear `competitor` → `CompetitorOrigin`).

## O motor (port quase verbatim)

`pricing-suggestion-engine.ts` é **TypeScript puro, sem dependências** → portar como
`src/pricing/services/pricing-suggestion-engine.ts` mantendo a lógica:
- **Estratégia `margem`:** alvo = `custo/(1 - minMargin/100)`.
- **Estratégia `concorrencia`:** média **ponderada** dos concorrentes × `(1 + variationPct/100)`,
  com **trava** no piso de margem (`lockApplied`); sem concorrente → cai pra margem/`sem_concorrente`.
- **Match de classificação:** prefixo com delimitadores `>`/`/`/`-`, **mais específico vence**,
  desempate `createdAt` asc → `id` asc.
- **Cluster vence classificação em definitivo** (mesmo que compute `none`); `excludeClusterIds` subtrai.
- **Arredondamento** por faixa (com piso de margem).
- **Alvo** `precoOferta` vs `precoVenda` (controlado/oferta > 0 ⇒ oferta).
- **7 motivos de não-sugestão:** `sem_regra`, `sem_custo`, `margem_ok`, `sem_concorrente`,
  `pbm`, `acima_do_venda`, `ja_no_alvo`.

A orquestração (`pricing-suggestions-products.ts`) vira `pricing-suggestions.service.ts`:
carrega regras ativas → particiona cluster/classe → carrega membership (uma vez) → carrega faixas
de arredondamento por tipo (uma vez por tipo) → carrega crossed products → `map → compute → filtra
(onlyWithSuggestion/direction/origem) → pagina`.

## Componentes a criar (módulo `src/pricing/`)

```
src/pricing/
  pricing.module.ts
  dto/                       upsert-suggestion-rule.dto.ts, upsert-cluster.dto.ts,
                             upsert-price-rounding.dto.ts, list-suggestions-query.dto.ts
  controllers/               suggestion-rules.controller.ts, clusters.controller.ts,
                             price-rounding.controller.ts, pricing-suggestions.controller.ts
  services/                  suggestion-rules.service.ts, clusters.service.ts,
                             price-rounding.service.ts, pricing-suggestions.service.ts,
                             pricing-suggestion-engine.ts (+ .spec.ts)
src/database/entities/tenant/   pricing-suggestion-rule.entity.ts, product-cluster.entity.ts,
                                product-cluster-member.entity.ts, price-rounding-*.entity.ts (flesh out)
src/database/repositories/tenant/  pricing-suggestion-rule.repository.ts, product-cluster.repository.ts,
                                   price-rounding.repository.ts, pricing-product-data.repository.ts (join direto no banco)
migrations/tenant/           <timestamp>-CreatePricingTables.ts
```

Os serviços obtêm o `EntityManager` tenant-scoped do request (padrão existente: `req.entityManager`
populado pelo `SearchPathInterceptor`) e instanciam os repositórios `new XRepository(em)`.

## Superfície HTTP (nova, tenant-scoped, JWT)

| Método | Rota | Origem legada |
|---|---|---|
| GET | `/pricing/suggestion-rules` | `pricing-suggestion-rules-list` |
| POST | `/pricing/suggestion-rules` | `pricing-suggestion-rules-save` (create) |
| PATCH | `/pricing/suggestion-rules/:id` | `pricing-suggestion-rules-save` (update) |
| DELETE | `/pricing/suggestion-rules/:id` | `pricing-suggestion-rules-delete` |
| GET | `/pricing/clusters` · `/:id` | `clusters-list` · `clusters-get` |
| POST | `/pricing/clusters` · DELETE `/:id` | `clusters-save` · `clusters-delete` |
| GET/POST/PATCH/DELETE | `/configurations/price-rounding[/:id]` | `price-rounding-proxy` |
| GET | `/configurations/price-rounding-types` | `price-rounding-types-proxy` |
| GET | `/pricing/suggestions` (filtros: `page,perPage,name,classification,books,onlyWithSuggestion,direction,origem`) | `pricing-suggestions-products` |
| POST | `/pricing/apply` (aplica preços selecionados: `{productId, price, priceType: 'offer'\|'sell'}[]`) | `usePriceMutations` (legado) |
| POST | `/pricing/schedules` (agenda aplicação: `{scheduled_at, items[]}`) — **Fase 3, opcional** | `usePriceSchedules` (legado) |

**Contrato de `GET /pricing/suggestions`** (o frontend depende exatamente disto — `usePricingSuggestionProducts.ts`):
```
{ count, suggestionCount, lockCount, activeRuleCount,
  availableBooks: {value,label}[],
  rows: { product, result, origem }[] }
```
- `product`: `id, ean, name, supplier, classification, book, cost, priceForSell, priceForOffer,
  averageVariation, margin, curve, status` + **preços de concorrente por origem** (em vez dos 3
  campos fixos `drogalPrice/drogasilPrice/michelassiPrice` do legado, usar
  `competitors: {origin, price, isPbm, van}[]` com as origens habilitadas do tenant — o frontend
  evolui junto). Preços como string/number.
- `result`: `{kind:'suggestion', suggestion:{price, margin, rule, target, basis, lockApplied}}`
  ou `{kind:'none', reason}` (os 7 motivos).
- `origem`: `{clusterId, clusterName, overrodeRuleName} | null` (badge "Origem" quando cluster venceu).

As colunas da tabela (`SugestaoPrecificacao.tsx`) consumidas: EAN, Nome, Fab., Class., Caderno,
Custo, P. Venda, P. Oferta, Margem, Direção, **Preço Sugerido**, **Margem Sug.**, **Aplica em**
(P. Oferta/P. Venda + trava + campanha), **Origem**.

## Fases sugeridas

- **Fase 0 — Fundação:** trazer o app farmacore para o workspace `bogota`; instalar deps; subir
  ambiente local (`docker-compose`, `seed:local-tenant`, `migrate:tenant`). Construir o
  `pricing-product-data.repository.ts` (join direto no banco) e cobrir com um teste de integração
  contra o tenant semeado — **sem** expor endpoint `crossed`.
- **Fase 1 — Regras (config):** entidades + migration; CRUD de **suggestion-rules**, **clusters**
  e **price-rounding** (entities, DTOs, repos, services, controllers). Espelhar validações do legado.
- **Fase 2 — Sugestões (motor):** portar `pricing-suggestion-engine.ts` + `.spec.ts`; construir
  `pricing-suggestions.service.ts` e `GET /pricing/suggestions` com filtros e paginação.
- **Fase 3 — Aplicar & agendar (EM ESCOPO):** `POST /pricing/apply` grava o preço sugerido no
  produto do tenant (`precoVenda`/`precoOferta` conforme `priceType`) — em massa para a seleção;
  `POST /pricing/schedules` agenda a aplicação para data/hora. Bloqueio de produtos em campanha de
  oferta ativa (igual ao legado). Aplicação em massa/agendada via pipeline RabbitMQ (`src/pipeline`),
  análogo ao `executeScheduledOfferBookRules` legado.

## Verificação

1. **Unit (motor):** `pricing-suggestion-engine.spec.ts` cobrindo as 2 estratégias e os 7 motivos
   (margem mínima, trava de concorrência, exclusão por cluster, precedência cluster>classe,
   `ja_no_alvo`, `acima_do_venda`, `pbm`). É a rede de segurança principal do port.
2. **e2e:** `/auth/login` como usuário-tenant → CRUD de uma regra → `GET /pricing/suggestions`.
3. **Manual:** `seed:local-tenant` → rodar pipeline de import (popula tenant `product` +
   `shared_catalog.product`) → criar regra `margem` (ex. 30%) → `GET /pricing/suggestions` e
   conferir `price = custo/(1-0.30)` arredondado; criar regra `concorrencia` e validar média
   ponderada + trava. Comparar amostra contra o legado pricy-shelf.

## Decisões (resolvidas)

- **Concorrentes:** ✅ **por-tenant**. A lista de concorrentes vem das origens habilitadas do
  tenant em `tenant_competitor_origin` e muda conforme a escolha de cada tenant (não fixa
  `drogal|drogasil|michelassi`). A regra valida `competitor` contra as origens habilitadas; o read
  puxa o preço de cada origem habilitada; a resposta carrega os preços **por origem** (evolui os
  3 campos fixos do legado — ver "Contrato").
- **Clusters:** ✅ membership **estática Fase 1** (manual/CSV), igual ao legado — sem cluster dinâmico.
- **PBM:** ✅ vem de uma **coluna no banco** (booleana, por produto/origem em `shared_catalog.product`)
  — lida direto, sem metadata/fallback.
- **Profundidade do v1:** ✅ entregar **completo** — Fases 0–3, incluindo aplicar em massa e agendamento.
