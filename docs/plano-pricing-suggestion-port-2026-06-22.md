# Port: Regras de Sugestão + Sugestão de Preços (pricy-shelf → farmacore)

> Data: 2026-06-22. Plano de implementação verificado contra o código real das
> duas pontas. **Substitui** o desenho de `plano-backend-regras-preco-e-sugestao.md`
> (que continua no repo por histórico, mas está parcialmente desatualizado — ver
> "Revisão do plano antigo" abaixo).

## Objetivo

Trazer para o app novo **farmacore** (NestJS 11, multi-tenant schema-per-tenant,
TypeORM) duas rotinas do **pricy-shelf** (repo legado, hoje no worktree
`pricy-shelf-master/florence` / branch `cleanup-dead-code`):

1. **Regras de Sugestão de Preços** (`pricing-suggestion-rules`) — CRUD da config.
2. **Sugestão de Preços** (`pricing-suggestions`) — o motor que calcula o preço
   sugerido por produto e o endpoint que o serve com filtros/paginação.

Refatorado para as convenções do farmacore (módulo `tenant-api`, leitura via
`EntityManager` tenant-scoped, raw SQL parametrizado, DTOs `class-validator`).

## Fonte da verdade (canônica)

`…/pricy-shelf-master/florence/artifacts/api-server/src/functions/`:
- `_shared/pricing-suggestion-engine.ts` — o motor (TS puro, sem deps).
- `_shared/pricing-suggestion-rules-store.ts` — CRUD + validação das regras.
- `_shared/product-clusters-store.ts` + `clusters-{list,get,save,delete}.ts` — clusters.
- `pricing-suggestions-products.ts` — orquestração do endpoint.
- Schema Drizzle: `…/florence/lib/db/src/schema/{pricing-suggestion-rules,product-clusters}.ts`.

> **Atenção a worktrees:** o worktree `krakow` (branch `dashboard-classificacoes-v1`)
> tem uma cópia **mais antiga** desse código — sem `competitorMode`,
> `noCompetitorMargin`, clusters e `origem`. **Usar `florence`.**

## Revisão do plano antigo (`plano-backend-regras-preco-e-sugestao.md`)

Verifiquei cada afirmação do plano antigo contra o código real. Veredito: **direção
certa, vários detalhes desatualizados.** Correções que este plano incorpora:

| # | Plano antigo dizia | Realidade | Impacto |
|---|---|---|---|
| 1 | Criar módulo novo `src/pricing/` | A convenção é um controller+service por feature **dentro de `src/tenant-api/`** (catalog, config). Não há sub-módulo por feature. | Vai em **`src/tenant-api/pricing/`**, registrado em `tenant-api.module.ts`. |
| 2 | Fonte em `…/nagoya/…` | `nagoya` não existe; o código está em `florence` (canônico) / `krakow` (velho). | Path corrigido. |
| 3 | Preencher stubs de price-rounding em `src/database/entities/tenant/` | Price-rounding **já foi movido para o schema `core`** (band/bucket, `tenant_id`), com `PriceRoundingController` + `PriceRoundingService` **prontos**. | **Reusar** `core.price_rounding_range/_rule` — não recriar. |
| 4 | `pricing_suggestion_rule` tem `priceRoundingTypeId` (tipo de arredondamento) | farmacore **não tem tabela de "tipos"** de arredondamento — é um único conjunto por tenant. | **Dropar** `priceRoundingTypeId` do entity. `applyRounding` (bool) basta. |
| 5 | PBM vem de **coluna booleana** em `shared_catalog.product` | Não existe coluna; PBM está em `metadata->>'isPbm'` (string `'true'`). `catalog.crossed()` já lê assim. | Ler de `metadata->>'isPbm'`. |
| 6 | `tenant_competitor_origin` é tabela do tenant, join inline | Foi movida para **`core`** (`tenant_id`, `enabled`), **fora do search_path** do tenant. | Qualificar `core.tenant_competitor_origin` + `resolveTenantId(em, slug)`. |
| 7 | Construir `pricing-product-data.repository` do zero | `catalog.service.ts crossed()` **já faz** o join produto+concorrente+PBM. | **Modelar sobre `crossed()`**, generalizando para as origens habilitadas. |
| 8 | npm script `migrate:tenant` | É `migration:tenant`. | Comando corrigido. |
| 9 | Engine só com média ponderada | O motor canônico tem `competitorMode` = `weighted`/`cascade`/`lowest`, `noCompetitorMargin` (3º basis `margem_sem_concorrente`) e `priceComposition`. | Portar **tudo** isso. |
| 10 | Apply/agendamento (Fase 3) em escopo | Vai via ERP `/scheduling` no legado; o farmacore não tem aplicação em massa/agendada. Já existe apply por-EAN (`POST /products/:ean/price` e `/offer`). | **Deferir** apply em massa/agendamento (follow-up). Ver "Fora de escopo". |

## Modelo de dados (schema do tenant)

Novas entidades em `src/database/entities/tenant/` (estendem `BaseEntity`:
`id` uuid, `created_at`, `updated_at`, `deleted_at`). Ficam no schema do tenant
(igual a `offer-book-rule`), resolvidas pelo `search_path` — sem `tenant_id`.

### `pricing_suggestion_rule` (`pricing-suggestion-rule.entity.ts`)
Espelha o Drizzle canônico, **menos** `priceRoundingTypeId` (item 4):
- `name` text NOT NULL
- `classifications` jsonb `string[]` default `[]`
- `clusterId` (`cluster_id`) uuid nullable
- `excludeClusterIds` (`exclude_cluster_ids`) jsonb `string[]` default `[]`
- `strategy` text default `'margem'` (`'margem' | 'concorrencia'`)
- `minMargin` (`min_margin`) numeric(6,2) NOT NULL
- `competitorMode` (`competitor_mode`) text default `'weighted'` (`weighted|cascade|lowest`)
- `competitors` jsonb `{competitor, weight}[]` default `[]` (competitor = `CompetitorOrigin`)
- `variationPct` (`variation_pct`) numeric(6,2) default `0`
- `noCompetitorMargin` (`no_competitor_margin`) numeric(6,2) nullable
- `priceControlled` (`price_controlled`) bool default false
- `ignorePbm` (`ignore_pbm`) bool default false
- `applyRounding` (`apply_rounding`) bool default true
- `active` bool default true
- Índice em `(active)`. Sem CHECK XOR no DB; validar classificação-XOR-cluster na borda (mensagem clara).

### `product_cluster` (`product-cluster.entity.ts`)
- `name` text NOT NULL. Índice nenhum extra.

### `product_cluster_member` (`product-cluster-member.entity.ts`)
- PK composta `(cluster_id, ean)`. `clusterId` uuid, `ean` text. Índice em `(ean)`.
- **Não** estende `BaseEntity` (PK composta, sem `id`/timestamps) — tabela de junção.

### Migration
`migrations/tenant/1700000000010-create-pricing-suggestion-tables.ts`
(kebab-case; classe `CreatePricingSuggestionTables1700000000010`; `up`/`down`
reais — `down` dropa as 3 tabelas). A maior tenant migration atual é `…009`.

## O motor (`src/tenant-api/pricing/pricing-suggestion.engine.ts`)

Port quase-verbatim do `pricing-suggestion-engine.ts` (TS puro, sem deps Nest),
**generalizado para N origens**:
- `SuggestionProduct` troca os 3 campos fixos (`precoDrogal/…`) por
  `competitorPrices: Record<CompetitorOrigin, number>`; `COMPETITOR_PRICE_FIELD`
  vira lookup nesse mapa. `pbm` continua boolean (OR das origens habilitadas).
- Mantém **toda** a lógica: estratégia `margem` (`custo/(1-minMargin/100)`);
  `concorrencia` com 3 modos (`weighted` média ponderada renormalizada, `cascade`
  primeiro da ordem com preço, `lowest` menor preço) × `(1+variationPct/100)` com
  trava no piso de margem; `noCompetitorMargin` → basis `margem_sem_concorrente`;
  match de classificação por prefixo (delimitadores ` > ` ` / ` ` - `, mais
  específico vence, desempate `createdAt` asc → `id` asc); cluster vence
  classificação em definitivo (`resolveWinner`) + `excludeClusterIds`; arredondamento
  por faixa com piso; alvo oferta vs venda; `suggestionDelta` (filtro direção).
- **7 motivos**: `sem_regra` (emitido pela orquestração, não pelo motor),
  `sem_custo`, `margem_ok`, `sem_concorrente`, `pbm`, `acima_do_venda`, `ja_no_alvo`.
- Acompanha **`pricing-suggestion.engine.spec.ts`** (rede de segurança principal):
  2 estratégias, 3 `competitorMode`, todos os 7 motivos, precedência/ exclusão de
  cluster, `noCompetitorMargin`, trava de margem, arredondamento. **Roda sem DB.**

## Sugestão de Preços (orquestração)

`pricing-suggestions.service.ts` (espelha `pricing-suggestions-products.ts`):
1. **Origens habilitadas:** `resolveTenantId(em, slug)` → `core.tenant_competitor_origin WHERE tenant_id=$1 AND enabled=true` (qualificado, fora do search_path).
2. **Produtos crossed:** raw SQL modelado em `catalog.crossed()`, mas com **um LEFT JOIN `shared_catalog.product` por origem habilitada** (gerado dinamicamente), trazendo `price` e `metadata->>'isPbm'`/`->>'van'` por origem. Filtra fora produto sem custo E sem preço de venda E sem oferta (igual ao legado). Filtros server-side: `name`, `classification`.
3. **Regras ativas** (`suggestion-rules.service` list, só `active`), particionadas cluster/classe.
4. **Membership** (`Map<ean, clusterId[]>`) carregada uma vez se alguma regra usa cluster/exclusão (join em `product_cluster_member`).
5. **Faixas de arredondamento:** `core.price_rounding_*` do tenant, mapeadas para `PriceRoundingRange { price_min, price_max, rules:[{decimal_min, decimal_max, round_to}] }`. Conjunto único (sem "tipos").
6. Por produto: `mapProduct` → `competitorPrices` por origem, `pbm` = OR das origens; `findClusterRuleForProduct` + `findRuleForProduct` → `resolveWinner` → `computeSuggestion`; `origem` quando cluster venceu.
7. Filtros pós-cálculo: `onlyWithSuggestion`, `origem` (`cluster|classificacao`), `direction` (`subir|abaixar` via `suggestionDelta`). `availableBooks` sobre o conjunto filtrado por name/class (ignorando filtro de cadernos). Contagens **antes** da paginação. Pagina.

### Superfície HTTP (tenant-scoped, JWT global; sem prefixo global)

| Método | Rota | Origem legada |
|---|---|---|
| GET | `/pricing/suggestion-rules` | `pricing-suggestion-rules-list` |
| POST | `/pricing/suggestion-rules` | `pricing-suggestion-rules-save` (create) |
| PATCH | `/pricing/suggestion-rules/:id` | `pricing-suggestion-rules-save` (update) |
| DELETE | `/pricing/suggestion-rules/:id` | `pricing-suggestion-rules-delete` |
| GET | `/pricing/clusters` · `/pricing/clusters/:id` | `clusters-list` · `clusters-get` |
| POST | `/pricing/clusters` · DELETE `/pricing/clusters/:id` | `clusters-save` · `clusters-delete` |
| GET | `/pricing/suggestions` | `pricing-suggestions-products` |

Filtros de `GET /pricing/suggestions`: `page, perPage, name, classification,
books[], onlyWithSuggestion, direction (todas|subir|abaixar), origem (todas|cluster|classificacao)`.

**Contrato de resposta** (espelha o legado + evolução por-origem):
```
{ count, suggestionCount, lockCount, activeRuleCount,
  availableBooks: {value,label}[],
  rows: { product, result, origem }[] }
```
- `product`: `ean, name, supplier, classification, book, cost, priceForSell,
  priceForOffer, margin, averageVariation, status` + `competitors: {origin, price, isPbm, van}[]` (origens habilitadas).
- `result`: discriminated union do motor — `{kind:'suggestion', suggestion:{price, margin, target, basis, lockApplied, priceComposition, rule}}` ou `{kind:'none', reason}`.
- `origem`: `{clusterId, clusterName, overrodeRuleName} | null`.

## Validações (espelhar `pricing-suggestion-rules-store.ts`)

DTO `class-validator` + checagens cross-field no service: `name` ≤120; `classifications`
dedup, ≤200, cada ≤200 chars; `clusterId` UUID, **não** junto de `classifications`;
`excludeClusterIds` dedup ≤100 UUIDs, não pode excluir o próprio cluster;
`strategy ∈ {margem, concorrencia}`; `competitorMode ∈ {weighted, cascade, lowest}`;
`minMargin 0–95`; `competitors[].competitor ∈ origens habilitadas do tenant`,
`weighted` exige `weight 0<w≤100` (cascade/lowest gravam 1), dedup, `concorrencia`
exige ≥1 concorrente; `variationPct -90..90`; `noCompetitorMargin 0–95` só em
`concorrencia`. Cluster: `name` ≤120; EANs validados (`^\d{6,14}$`) dedup ≤5000;
delete bloqueia (409) se alguma regra mira/exclui o cluster.

## Componentes a criar

```
src/tenant-api/pricing/
  pricing-suggestion.engine.ts        (+ .spec.ts)   ← motor puro + testes
  suggestion-rules.service.ts  suggestion-rules.controller.ts
  clusters.service.ts          clusters.controller.ts
  pricing-suggestions.service.ts  pricing-suggestions.controller.ts
  dto/  suggestion-rule.dto.ts  cluster.dto.ts  list-suggestions.query.ts
src/database/entities/tenant/  pricing-suggestion-rule.entity.ts
                               product-cluster.entity.ts  product-cluster-member.entity.ts
migrations/tenant/1700000000010-create-pricing-suggestion-tables.ts
```
Registrar os 3 controllers + 3 services em `src/tenant-api/tenant-api.module.ts`.

## Fora de escopo (follow-up documentado)

- **Aplicar em massa / agendar** (`POST /pricing/apply`, `/pricing/schedules`): no
  legado vai pelo ERP `/scheduling` (`UPDATE_PRICE[_OFFER]`). O farmacore já aplica
  preço **por-EAN** (`POST /products/:ean/price` e `/offer` em `catalog-mutation.service`).
  Aplicação em massa/agendada acopla com pipeline/ERP — fica para um PR próprio.
- **Frontend**: o farmacore é só backend; o contrato evolui para `competitors[]`
  por-origem (o front pricy ajusta junto quando portado).

## Verificação

1. **Unit (motor):** `pricing-suggestion.engine.spec.ts` cobre 2 estratégias, 3
   modos, 7 motivos, cluster (precedência+exclusão), `noCompetitorMargin`, trava,
   arredondamento. `npm test`. **Rede de segurança principal — roda sem DB.**
2. **Build + lint:** `npm run build` (typecheck contra entidades/serviços reais) e `npm run lint`.
3. **e2e:** `test/pricing-suggestions.e2e-spec.ts` — sobe `AppModule`, semeia tenant
   + produto + concorrente em `shared_catalog` + habilita origem, `/auth/login`,
   cria regra via `POST /pricing/suggestion-rules`, `GET /pricing/suggestions` e
   confere o preço sugerido. Precisa do stack docker (postgres :5433, rabbitmq :5673)
   + `migration:run:app` + `seed:local-tenant`.
4. **Manual:** `docker compose up -d` → `migration:run:app` → `seed:system-admin`
   → `seed:local-tenant` (cria `macfarma` + roda a migration 010) → habilitar uma
   origem → criar regra `margem 30%` → `GET /pricing/suggestions` e conferir
   `price = custo/(1-0.30)` arredondado.

## Sequência de execução

1. Entidades (3) + migration 010.
2. Motor + spec (TDD: spec passa isolado).
3. `suggestion-rules` (DTO, service, controller) + `clusters` (DTO, service, controller).
4. `pricing-suggestions` (query DTO, service, controller) reusando `crossed()`.
5. Registrar no módulo. `npm run build` + `npm run lint` + `npm test`.
6. Subir docker, migrar, semear, rodar e2e + verificação manual.
7. PR.
