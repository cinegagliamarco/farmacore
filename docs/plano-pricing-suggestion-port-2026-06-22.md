# Plano de Implementação — Regras de Sugestão + Sugestão de Preços (farmacore)

> Porte do pricy-shelf para o farmacore. Documento vivo, verificado contra o código real das duas pontas em 2026-06-22. Fases 1 e 2 **portadas no backend** (PR #33, branch `cinegagliamarco/pricing-suggestion-port`) — sem consumidor/tela ainda (ver §9 e §17). Fase 3 **planejada** e detalhada aqui, com lacunas de negócio explicitamente em aberto (§17).
> Fonte canônica (legado): `pricy-shelf-master/florence/artifacts/api-server/src/functions/` (`_shared/pricing-suggestion-engine.ts`, `pricing-suggestions-products.ts`, `_shared/pricing-suggestion-rules-store.ts`, `_shared/product-clusters-store.ts`).

---

## 1. Sumário executivo

Trazemos para o farmacore (NestJS 11, multi-tenant schema-per-tenant, TypeORM, RabbitMQ) duas rotinas do pricy-shelf: **Regras de Sugestão de Preços** (config de como precificar, por classificação ou por cluster) e **Sugestão de Preços** (motor que calcula o preço sugerido por produto + endpoint que serve a lista filtrável). No legado isso sustenta as telas `/precos/sugestoes` e `/regras`. O motor é TypeScript puro portado quase-verbatim (rede de segurança = suíte unitária sem DB), generalizado para **N origens de concorrente** em vez dos 3 campos fixos do legado.

**Estado atual:** o **backend** das Fases 1 (CRUD de regras e clusters) e 2 (motor + `GET /pricing/suggestions`) está portado e testado (unit + e2e). **Mas nenhuma tela consome o contrato** — o front pricy valida via Zod e exige `id`/`curve`/campos fixos por origem que a nova API não retorna (§14, §17.1). Logo o **valor ao usuário hoje é zero**: as Fases 1–2 são "backend pronto, não exercitável por operador". Falta a Fase 3 (aplicar em massa + agendar via pipeline RabbitMQ) e várias **decisões de negócio** que travam tanto o front quanto a Fase 3 (§17).

## 2. Objetivos e não-objetivos

**Objetivos**
- CRUD de regras de sugestão (`pricing_suggestion_rule`) com validação idêntica à do legado.
- CRUD de clusters de produto (`product_cluster` + `product_cluster_member`) com bloqueio de delete em uso.
- Motor de cálculo determinístico, coberto por testes que rodam sem DB.
- Endpoint `GET /pricing/suggestions` que carrega o catálogo cruzado com concorrentes, calcula em memória e serve com filtros/paginação e contagens.
- Generalizar para as N origens de concorrente habilitadas do tenant (não hard-codar drogal/drogasil/michelassi).
- (Fase 3) Aplicar preço em massa e agendar, reusando o apply por-EAN já existente e o pipeline RabbitMQ — **com trilha de auditoria, congelamento do preço aprovado e guarda-corpos de sanidade** (§9).

**Não-objetivos**
- Não recriar arredondamento de preço (já vive em `core`, band/bucket) nem origens de concorrente (já em `core.tenant_competitor_origin`).
- Não há frontend neste repo (o farmacore é só backend). **Mas a quebra de contrato com o front pricy não é não-objetivo — é item de escopo com dono/prazo a definir (§14, §17.1).**
- Não há "tipos" de arredondamento (`priceRoundingTypeId`): o farmacore tem um conjunto único por tenant.
- Fase 3 não reimplementa o ERP-proxy `/scheduling` do legado — usa o apply A7Pharma já existente. **Consequência de confiabilidade registrada em §9.5 e §17.2.**

## 3. Contexto e motivação

**Negócio.** No pricy-shelf, o operador de preços usa duas telas: `/regras` (cadastra regras: "genéricos com margem mínima de 30%", "este cluster de campeões de venda segue a Drogal -2%") e `/precos/sugestoes` (lista cada produto com o preço sugerido, o motivo, a margem resultante e a origem da regra; filtra por caderno, direção e "só com sugestão"; **edita o preço sugerido linha a linha**; aplica em lote, agora ou agendado). É a ferramenta que transforma coleta de concorrência + custo em ação de preço.

**Técnico.** O farmacore é o app novo que substitui o pricy-shelf. Já tem catálogo, concorrência (scrapers populam `shared_catalog.product`), arredondamento e apply por-EAN — mas **não tinha** o módulo de sugestão. Este porte fecha essa lacuna reusando o que já existe em `core` e em `catalog`, sem duplicar. O legado aplicava preço via ERP-proxy `/scheduling`; o farmacore não tem esse proxy e usa o apply A7Pharma por-EAN (§9.5).

## 4. Domínio e glossário

| Termo | Significado no código |
|---|---|
| **Regra** (`pricing_suggestion_rule`) | Config de precificação. Mira **classificação** (por prefixo) **XOR cluster**. Estratégia `margem` ou `concorrencia`. |
| **Cluster** (`product_cluster`) | Conjunto de EANs escolhidos a dedo, atravessando as classificações do ERP. Membership estática (manual/CSV) em `product_cluster_member`. |
| **Classificação** | Caminho hierárquico do ERP (`MEDICAMENTOS > GENÉRICOS > DOR`). Regra casa por **prefixo** com delimitador. |
| **Combate** (`concorrencia`) | Estratégia que mira o preço do concorrente, combinado por `competitorMode` (`weighted`/`cascade`/`lowest`). |
| **PBM** | Programa de Benefício em Medicamentos — preço subsidiado, não preço de gôndola. Hoje lido de `shared_catalog.product.metadata->>'isPbm' = 'true'` **do concorrente** (limitação em §8 e §17.5). Concorrência **nunca** segue PBM. |
| **Caderno / Oferta** (`book`, `precoOferta`) | Campanha promocional (`offer_book`). Se há `precoOferta > 0`, o motor mira a oferta; senão o preço de venda. `offer_book.external_id` = `idCadernoOferta` da A7Pharma. |
| **Campanha** (`tenant_offer_campaign`) | Caderno de oferta do ERP com `external_id` (unique), `active`, `start_date`, `expiration_date`. Liga a `offer_book` por `offer_book.external_id = tenant_offer_campaign.external_id`. |
| **Origem** (`CompetitorOrigin`) | Concorrente: `DROGAL`, `DROGASIL`, `PAGUE_MENOS`, `IKESAKI`, `MICHELASSI`, `PACHECO`, `SAO_PAULO`, `VENANCIO`, `INDIANA`. Habilitada por tenant em `core.tenant_competitor_origin` (`enabled`, `priority`). |
| **Basis** | De onde veio o preço sugerido: `concorrencia`, `margem_minima`, `margem_sem_concorrente`. |
| **Motivo** (`NoSuggestionReason`) | Por que **não** há sugestão: `sem_regra`, `sem_custo`, `margem_ok`, `sem_concorrente`, `pbm`, `acima_do_venda`, `ja_no_alvo`. |
| **Origem (da linha)** | `{clusterId, clusterName, overrodeRuleName}` quando uma regra de **cluster** governou (e qual classificação ela sobrepôs). |

## 5. Arquitetura da solução

**Componentes** (todos em `src/tenant-api/pricing/`, registrados em `tenant-api.module.ts`):

| Arquivo | Papel |
|---|---|
| `pricing-suggestion.engine.ts` (+ `.spec.ts`) | Motor puro, sem deps Nest. Funções: `findRuleForProduct`, `findClusterRuleForProduct`, `resolveWinner`, `computeSuggestion`, `applyPriceRounding`, `suggestionDelta`. |
| `suggestion-rules.{service,controller}.ts` | CRUD + validação das regras. |
| `clusters.{service,controller}.ts` | CRUD dos clusters + membership. |
| `pricing-suggestions.{service,controller}.ts` | Orquestração do `GET /pricing/suggestions`. |
| `dto/{suggestion-rule,cluster}.dto.ts`, `dto/list-suggestions.query.ts` | DTOs `class-validator`. |
| Entidades em `src/database/entities/tenant/` | `pricing-suggestion-rule`, `product-cluster`, `product-cluster-member`. |

**Fluxo de um `GET /pricing/suggestions` (passo a passo):**

```
HTTP GET /pricing/suggestions?...        JwtAuthGuard + RolesGuard (global)
  └─ SearchPathInterceptor: search_path = tenant_<slug>, shared_catalog, public
  └─ Controller: @TenantEm() em, @CurrentUser() user.tenantId(=slug), @Query() dto
      └─ PricingSuggestionsService.suggestions(em, slug, q)
          1. enabledOrigins(em, slug)
               resolveTenantId(em,slug) → SELECT origin FROM core.tenant_competitor_origin
               WHERE tenant_id=$1 AND enabled=true ORDER BY priority,origin
               + filtra contra Object.values(CompetitorOrigin) ← ÚNICA barreira do join dinâmico (§12)
          2. loadProducts(em, origins, name, classification)
               raw SQL: product p
                 LEFT JOIN classification c, LEFT JOIN offer_book ob,
                 + 1 LEFT JOIN shared_catalog.product POR ORIGEM habilitada
               WHERE (p.cost>0 OR p.price>0 OR ob.target_price>0)   ← descarta "só do concorrente"
                 [+ name ILIKE, classification ILIKE]
          3. availableBooks(allRows)   ← antes do filtro de cadernos
          4. filtra por books[] (in-memory)
          5. rules = SuggestionRulesService.list(em) onde active
               → clusterRules (clusterId != null) / classRules
          6. membership: ClustersService.loadActiveClusterMembership(em)  ← só se alguma regra usa cluster
          7. roundingRanges: PriceRoundingService.list(em,slug) → PriceRoundingRange  ← só se applyRounding
          8. por produto: toSuggestionProduct → competitorPrices{} + pbm(OR sobre origens — §8/§17.5)
               clusterRule = findClusterRuleForProduct(...)
               classRule   = findRuleForProduct(...)
               {winner, overrodeRule} = resolveWinner(...)
               result = winner ? computeSuggestion(...) : {kind:'none', reason:'sem_regra'}
          9. filtros pós-cálculo: onlyWithSuggestion, origem, direction (suggestionDelta)
         10. contagens (count, suggestionCount, lockCount) ANTES de paginar
         11. slice(page, perPage)
```

**De onde nasce cada dado:** custo/venda/classificação/caderno → schema do tenant (`product`, `classification`, `offer_book`). Preço/PBM de concorrente → `shared_catalog.product` (scrapers). Origens habilitadas + arredondamento → `core.*` (keyed by `tenant_id`, fora do search_path). Regras + clusters → schema do tenant.

## 6. Modelo de dados

Migration `migrations/tenant/1700000000010-create-pricing-suggestion-tables.ts` (classe `CreatePricingSuggestionTables1700000000010`). **Ordem de criação importa:** `product_cluster` antes de `pricing_suggestion_rule` (FK `cluster_id`), depois `product_cluster_member`. `down` dropa na ordem inversa.

### `product_cluster` (schema do tenant, estende BaseEntity)
| coluna | tipo | default | nullable |
|---|---|---|---|
| `id` | uuid PK | `uuid_generate_v4()` | não |
| `name` | text | — | não |
| `created_at` / `updated_at` | timestamptz | `now()` | não |
| `deleted_at` | timestamptz | — | sim (soft delete) |

### `pricing_suggestion_rule` (schema do tenant, estende BaseEntity)
| coluna | tipo | default | nullable |
|---|---|---|---|
| `id` | uuid PK | `uuid_generate_v4()` | não |
| `name` | text | — | não |
| `classifications` | jsonb (`string[]`) | `'[]'` | não |
| `cluster_id` | uuid | — | sim · **FK → `product_cluster(id)`** (sem ON DELETE: delete bloqueado no app) |
| `exclude_cluster_ids` | jsonb (`string[]`) | `'[]'` | não |
| `strategy` | text | `'margem'` | não · **CHECK `IN ('margem','concorrencia')`** |
| `min_margin` | numeric(6,2) | — | não |
| `competitor_mode` | text | `'weighted'` | não · **CHECK `IN ('weighted','cascade','lowest')`** |
| `competitors` | jsonb (`{competitor,weight}[]`) | `'[]'` | não |
| `variation_pct` | numeric(6,2) | `0` | não |
| `no_competitor_margin` | numeric(6,2) | — | sim |
| `price_controlled` | boolean | `false` | não |
| `ignore_pbm` | boolean | `false` | não |
| `apply_rounding` | boolean | `true` | não |
| `active` | boolean | `true` | não |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | `now()` / `now()` / — | não / não / sim |

Índice: `IX_PRICING_SUGGESTION_RULE_ACTIVE` em `(active)`.

**CHECK XOR classificação/cluster — a adicionar (decisão tomada).** Hoje a migration **não** tem CHECK e a invariante é só validada na borda (`SuggestionRulesService.validate`). Como esse dado **governa preço** e qualquer escrita fora do service (import CSV, migração, script, Fase 3) poderia inserir uma regra sem alvo (catch-all silencioso) ou com os dois, vale o cinto-e-suspensório mesmo sob o princípio de simplicidade: adicionar à migration 010 (ou numa migration de follow-up se 010 já rodou em produção)
```sql
ALTER TABLE pricing_suggestion_rule
  ADD CONSTRAINT CK_RULE_CLASS_XOR_CLUSTER
  CHECK ((cluster_id IS NOT NULL) <> (jsonb_array_length(classifications) > 0));
```
O service continua a traduzir a violação para `400` claro (mesmo caminho do `runOrMapFk`).

### `product_cluster_member` (tabela de junção, **não** estende BaseEntity)
| coluna | tipo |
|---|---|
| `cluster_id` | uuid · **FK → `product_cluster(id)` ON DELETE CASCADE** |
| `ean` | text |
| PK composta `(cluster_id, ean)` · índice `IX_PRODUCT_CLUSTER_MEMBER_EAN` em `(ean)` |

### Reusado de `core` (não recriado)
- `core.price_rounding_range` + `core.price_rounding_rule` (band `[price_min,price_max]` → buckets de decimal com `round_to`), via `PriceRoundingService.list(em, slug)`.
- `core.tenant_competitor_origin` (`tenant_id`, `origin`, `enabled`, `priority`), via raw SQL qualificado + `resolveTenantId`.

### Tabelas da Fase 3 (a criar — convenção explícita)
Migration tenant `011-create-pricing-apply-tables`. Ordem: `pricing_apply_run` → `pricing_apply_item` (FK + `ON DELETE CASCADE`) → `pricing_schedule`. `down` na inversa.

- **`pricing_apply_run`** (schema do tenant, **estende BaseEntity** → `id` uuid, `created_at`, `updated_at`, `deleted_at`). **Fino, sem contabilidade de fan-in** (essa é do `core.pipeline_run` — §9.2). Campos próprios: `idempotency_key` text **unique**, `pipeline_run_id` uuid (== `applyRunId`, cruza com `core.pipeline_run`), `requested_by` text (ator; **sem FK** — usuário vive fora do schema do tenant), `mode` `agora|agendado`, `schedule_id` uuid nullable. Índice em `(pipeline_run_id)` e em `(idempotency_key)`.
- **`pricing_apply_item`** (schema do tenant, **tabela crua**, como `product_cluster_member` — sem BaseEntity). Guarda **só o resultado por-EAN** + o **snapshot do que foi aprovado** (auditoria/undo — §9.6): `apply_run_id` uuid **FK ON DELETE CASCADE**, `ean` text, `target` text, `price_new` numeric(12,2), `price_old_sell` numeric(12,2) nullable, `price_old_offer` numeric(12,2) nullable, `caderno_id` bigint nullable, `cost_at_apply` numeric(12,2) nullable, `basis` text nullable, `rule_id` uuid nullable, `cluster_id` uuid nullable, `status` `pending|applying|applied|skipped|failed`, `reason` text nullable (motivo estruturado — §9.4), `erp_result` text nullable, `applied_at` timestamptz nullable. PK `(apply_run_id, ean)` (dedup por-EAN dentro do run — §9.3). Índice em `(apply_run_id, status)` para o `GET /apply/:id`.
- **`pricing_schedule`** (schema do tenant, **estende BaseEntity**). `filters jsonb` (mesmos do `GET /suggestions`), `run_at` timestamptz nullable, `cron` text nullable, **CHECK `(run_at IS NOT NULL) <> (cron IS NOT NULL)`**, `active` boolean default true, `last_run_id` uuid nullable, `max_items` int nullable, `max_variation_pct` numeric(6,2) nullable (guarda-corpo — §9.7). Índice em `(active, run_at)`.

**Retenção/limpeza:** runs/itens antigos são auditoria de preço aplicado no PDV — **não** são apagados por rollback de schema (§14, §17.7). Política de TTL/arquivamento fica como decisão operacional aberta (§17.7).

## 7. Contrato de API

Todas as rotas são tenant-scoped (sem prefixo global), `JwtAuthGuard`+`RolesGuard` globais. Mutações exigem `@Roles(OPERATOR, ADMIN)`.

**Leitura de pricing é restrita (decisão tomada).** As respostas de `GET /pricing/suggestions` e `GET /pricing/suggestion-rules` expõem **custo, margem e composição de preço com pesos por concorrente** — inteligência competitiva sensível, não dado público. Logo, **leitura também exige `@Roles(OPERATOR, ADMIN)`** (não "qualquer autenticado"). Se surgir necessidade de um perfil só-leitura, criar `VIEWER_PRICING` em vez de abrir a rota.

### 7.1 `GET /pricing/suggestion-rules`
- Auth: OPERATOR/ADMIN. Resposta `200`: `SuggestionRuleApi[]` ordenado por `updated_at DESC`, `deleted_at IS NULL`. Erros: `401`, `403`.

### 7.2 `POST /pricing/suggestion-rules`
- Auth: OPERATOR/ADMIN. Body: `UpsertSuggestionRuleDto`. Resposta `201`: `SuggestionRuleApi`.
- Validações (DTO): `name` 1–120; `classifications` `string[]` ≤200; `clusterId` UUID; `excludeClusterIds` UUID[] ≤100; `strategy ∈ {margem,concorrencia}`; `minMargin` 0–95 (obrigatório); `competitorMode ∈ {weighted,cascade,lowest}`; `competitors` (cada com `competitor ∈ CompetitorOrigin`, `weight` 0–100); `variationPct` -90..90; `noCompetitorMargin` 0–95; flags boolean. **Esses limites de borda (minMargin/noCompetitorMargin ≤95, variationPct em -90..90) são a defesa contra divisão-por-zero/alvo≤0 no motor** — o motor só guarda `minMargin ≥ 100` (§8).
- Cross-field (service): classificação **XOR** cluster; não excluir o próprio cluster; cada classificação ≤200 chars; **o `weight` só é validado e usado em `weighted` (`0<w≤100`); em `cascade`/`lowest` o `weight` do input é ignorado e gravado como `1`**; `concorrencia` exige ≥1 concorrente; **concorrentes duplicados são deduplicados silenciosamente (o primeiro vence), não rejeitados** (ver §17.4 — confirmar se deveria ser `400`); `noCompetitorMargin` só em `concorrencia` (coage `null` fora).
- Erros: `400` (validação/cross-field; FK `23503` de cluster inexistente → 400 claro; CHECK XOR violado → 400), `401`, `403`.

### 7.3 `PATCH /pricing/suggestion-rules/:id`
- Auth: OPERATOR/ADMIN. `:id` UUID (`ParseUUIDPipe`). Body: mesmo DTO. Resposta `200`: `SuggestionRuleApi`. Erros: `400`, `401`, `403`, `404`.

### 7.4 `DELETE /pricing/suggestion-rules/:id`
- Auth: OPERATOR/ADMIN. Soft delete. Resposta `200`: `{id, deleted: true}`. Erros: `401`, `403`, `404`.

### 7.5 `GET /pricing/clusters` · `GET /pricing/clusters/:id`
- Auth: OPERATOR/ADMIN. Lista: `ClusterApi[]` (`{id, name, memberCount, createdAt, updatedAt}`) ordenado por `updated_at DESC`. Get: `ClusterApi & {eans: string[]}`. Erros: lista `401`/`403`; get `401`/`403`/`404`.

### 7.6 `POST /pricing/clusters` · `PATCH /pricing/clusters/:id`
- Auth: OPERATOR/ADMIN. Body `UpsertClusterDto`: `name` 1–120; `eans?` `string[]`. No service: EANs `^\d{6,14}$`, dedup, ≤5000. PATCH sem `eans` só renomeia; com `eans` substitui a membership inteira. Resposta: `ClusterApi & {eans}`. Erros: `400` (EAN inválido / >5000), `401`, `403`, `404` (patch).

### 7.7 `DELETE /pricing/clusters/:id`
- Auth: OPERATOR/ADMIN. Resposta `200`: `{id, name}`. **`409`** se alguma regra (não deletada) mira (`cluster_id=$1`) ou exclui (`exclude_cluster_ids @> [id]`) o cluster — mensagem lista as regras. Erros: `401`, `403`, `404`, `409`.

### 7.8 `GET /pricing/suggestions`
- Auth: OPERATOR/ADMIN. Query `ListSuggestionsQueryDto`: `page≥1`, `perPage` 1–1000 (default 50), `name?`, `classification?`, `books?` (csv), `onlyWithSuggestion?` (`'true'`), `direction ∈ {todas,subir,abaixar}`, `origem ∈ {todas,cluster,classificacao}`. Erros: `400` (query inválida), `401`, `403`.
- **`Cache-Control: private, max-age=30`** (paridade com o legado — mitiga recomputo a cada página; §13).

**Semântica das contagens de cabeçalho (para a tela rotular certo):**
- `count` — total de **linhas após filtros** (inclui produtos **sem** sugestão). É o universo paginado.
- `suggestionCount` — subconjunto de `count` com `result.kind === 'suggestion'`. É o que o operador pode aplicar.
- `lockCount` — sugestões com `lockApplied === true` (travadas no piso de margem). `lockCount` alto = regra de concorrência agressiva demais.
- `activeRuleCount` — nº de regras ativas consideradas.
- O filtro `direction` (`subir`/`abaixar`) compara **sugestão vs. preço vivo**, então só faz sentido sobre `suggestionCount` (linhas sem sugestão são descartadas pelo `suggestionDelta === null`).

**Campos do produto na resposta — origem e significado:**
- `averageVariation` ← `product.average_variation` (métrica do ERP/pipeline; "variação média de venda"). `status` ← `product.status` (status do item no ERP). Ambos são repassados crus para a tela exibir; o motor **não** os usa. A tela do legado usava `curve`/`status` como sinais visuais — **`curve` não existe na nova API** (§14, §17.1).

**Shape da resposta (200):**
```jsonc
{
  "count": 1234,             // total após filtros, antes de paginar (inclui sem sugestão)
  "suggestionCount": 210,    // linhas com result.kind === 'suggestion' (pós-filtro)
  "lockCount": 17,           // sugestões com lockApplied === true (travadas no piso)
  "activeRuleCount": 8,      // nº de regras ativas consideradas
  "availableBooks": [{ "value": "Caderno A", "label": "Caderno A" }],
  "rows": [
    {
      "product": {
        "ean": "789...", "name": "...", "supplier": "...", "classification": "...",
        "book": "...", "cost": 6, "priceForSell": 8, "priceForOffer": 0,
        "margin": 25, "averageVariation": 1.2, "status": "OK",
        "competitors": [{ "origin": "DROGAL", "price": 12, "isPbm": false, "van": null }]
      },
      "result": { /* discriminated union, abaixo */ },
      "origem": { "clusterId": "...", "clusterName": "...", "overrodeRuleName": "Genéricos" } // ou null
    }
  ]
}
```
> Diferença vs. legado (quebra de contrato — §14): a resposta **não** inclui `product.id` (numérico do ERP) nem `curve`, e troca `precoDrogal/precoDrogasil/precoMichelassi`+`*IsPbm`+`*Van` por `competitors[]`. O front pricy (Zod) rejeita esse shape. Decisão de fechamento do contrato em §17.1; a chave de apply ponta-a-ponta é EAN (§9.8).

**`result` — discriminated union (`kind`):**
```ts
// COM sugestão
{ kind: 'suggestion', suggestion: {
    price: number, margin: number,
    target: 'precoVenda' | 'precoOferta',
    basis: 'concorrencia' | 'margem_minima' | 'margem_sem_concorrente',
    lockApplied: boolean,
    priceComposition: { competitor: string; price: number; weight: number }[] | null,
    rule: SuggestionRule
} }
// SEM sugestão
{ kind: 'none', reason:
    'sem_regra'|'sem_custo'|'margem_ok'|'sem_concorrente'|'pbm'|'acima_do_venda'|'ja_no_alvo',
  rule?: SuggestionRule }
```

## 8. O motor de cálculo

`computeSuggestion(product, rule, roundingRanges)` — porte quase-verbatim do legado. Diferença única: preços de concorrente vêm de `product.competitorPrices: Partial<Record<CompetitorOrigin, number>>` (mapa por origem) em vez dos 3 campos fixos; `competitorPrice(product, origin)` faz o lookup (0 = sem preço).

**Algoritmo, passo a passo:**

1. **Base e guardas.** `basePrice = precoOferta>0 ? precoOferta : precoVenda`. Se `custo ≤ 0` ou `basePrice ≤ 0` ou `minMargin ≥ 100` → `{none, sem_custo}`. **Esta é a única guarda numérica do motor.** `noCompetitorMargin ≥ 100` e `variationPct` extremo **não** têm guarda própria: a defesa é a borda (DTO limita a 95 e -90..90). Se mesmo assim chegasse `margin ≥ 100` (ex.: escrita fora do service), `priceForMargin` daria `Infinity`/negativo e o motor cairia em `sem_custo` no passo 7 (`!Number.isFinite || price ≤ 0`). O spec cobre `noCompetitorMargin` próximo de 95 e `variationPct` negativo extremo para travar essa borda.
2. **PBM.** Se `product.pbm && (strategy==='concorrencia' || rule.ignorePbm)` → `{none, pbm}`. **Limitação conhecida (§17.5):** em `margem` com `ignorePbm=false` (default) **um item PBM recebe sugestão de gôndola normalmente**; e o flag `product.pbm` é um **OR sobre TODAS as origens** (basta um concorrente marcar `isPbm`), derivado do **scraping de concorrente**, não do ERP do próprio tenant — então pode falso-positivar e falso-negativar. Decisão de negócio (bloquear PBM por padrão também em margem? derivar PBM do ERP do tenant?) em §17.5.
3. **Piso de margem.** `floor = custo/(1 - minMargin/100)`.
4. **Estratégia concorrência** → calcula `alvo`:
   - **`weighted`**: média ponderada dos concorrentes com `price>0 && weight>0`; renormaliza pelo `totalWeight` dos presentes; `alvo = média × (1+variationPct/100)`; `priceComposition` = os presentes.
   - **`cascade`**: **o primeiro concorrente na ordem do array `rule.competitors` (ordem de inserção do usuário) que tiver `price>0`** — **não** a `priority` do `core.tenant_competitor_origin`. `alvo = price × (1+variationPct/100)`; composition = 1 item. (Se o desejado fosse seguir a priority do tenant, o motor precisaria reordenar — hoje **não** reordena; decisão em §17.6.)
   - **`lowest`**: menor `price>0`; mesma fórmula; composition = 1 item.
   - **Trava de margem:** se `alvo < floor` → `target=floor`, `lockApplied=true`, `basis='concorrencia'`; senão `target=alvo`.
5. **Sem alvo de concorrência** (`target===null`):
   - Se `strategy==='concorrencia' && noCompetitorMargin != null` → `alvo = custo/(1 - noCompetitorMargin/100)`, com a mesma trava no `floor`; `basis='margem_sem_concorrente'`. (`noCompetitorMargin === 0` é ≠ `null` → entra aqui e clampa.)
   - Senão (estratégia margem, ou concorrência sem preço e sem margem-alvo): `currentMargin = (basePrice-custo)/basePrice×100`. Se `currentMargin ≥ minMargin` → `{none, sem_concorrente}` (se concorrência) ou `{none, margem_ok}` (se margem). Caso contrário `target=floor`, `basis='margem_minima'`.
6. **Arredondamento.** `price = round2(target)`; se `applyRounding`, `applyPriceRounding(price, ranges, floor)`: acha a faixa por `[price_min,price_max]`, dentro dela a regra de decimal por `[decimal_min,decimal_max]`, snap para `integer + round_to`; **se o resultado < floor, sobe um inteiro** (`integer+1+round_to`) para não furar a margem. **Faixa ausente/incompleta:** se `price` não cai em nenhuma `range` (ou em nenhuma regra de decimal), `applyPriceRounding` **retorna o `price` sem arredondar** (fallback explícito). Para um tenant com faixas mal configuradas (buraco de cobertura) isso aplicaria um preço não-arredondado em produção. Mitigação: validar na criação das ranges que cobrem `[0, +inf)` sem buracos (responsabilidade do módulo de price-rounding); o spec testa o caminho "sem range cobrindo o preço" para fixar o comportamento.
7. **Pós-arredondamento.** Se `!finite || price ≤ 0` → `{none, sem_custo}`. Se `|price - basePrice| < 0.005` → `{none, ja_no_alvo}`.
8. **Alvo oferta vs venda.** `target = (priceControlled || precoOferta>0) ? 'precoOferta' : 'precoVenda'`. Se mira oferta e `precoVenda>0 && price > precoVenda` → `{none, acima_do_venda}`.
9. **Sucesso.** Retorna `{suggestion: {price, margin=round2((price-custo)/price×100), rule, target, basis, lockApplied, priceComposition}}`.

> **O motor não conhece o estado de aplicabilidade do EAN** (monitorado, sem `external_id` no ERP, sem credencial A7). Ele sugere preço para itens que a Fase 3 vai **rejeitar no apply** (§9.4/§17). Isso infla `suggestionCount`. Fonte do flag para sinalizar "bloqueado/não aplicável": `product.monitored` e `product.external_id` do tenant, já no join (adicionar ao SELECT/contrato na Fase 3).

**Match de classificação por prefixo** (`findRuleForProduct`): normaliza (trim+uppercase); casa se `p === r` ou `p.startsWith(r + delimitador)` com delimitadores `' > '`, `' / '`, `' - '`. `classifications=[]` = catch-all (`matchLen=0`). Vence o **mais específico** (maior `matchLen`); desempate por **`createdAt` asc → `id` asc**. Exclusão: `excludeClusterIds` ∩ clusters do produto → regra fora.

**Precedência de cluster** (`findClusterRuleForProduct` + `resolveWinner`): regra de cluster cobre o produto se `clusterId ∈ clusterIds`; mesmo desempate. `resolveWinner(clusterRule, classRule)`: se há regra de cluster, ela **vence em definitivo** — mesmo que compute `none`, a classificação não volta; `overrodeRule` = a classificação que teria vencido (para a badge "Origem").

**Os 7 motivos e onde nascem:**
| Motivo | Emitido em |
|---|---|
| `sem_regra` | **Orquestração** (`pricing-suggestions.service`), quando `winner === null`. Nunca pelo motor. |
| `sem_custo` | Motor passo 1 (guardas) e passo 7 (preço final inválido). |
| `pbm` | Motor passo 2. |
| `margem_ok` | Motor passo 5 (estratégia margem, já acima do piso). |
| `sem_concorrente` | Motor passo 5 (concorrência sem preço, sem margem-alvo, já acima do piso). |
| `ja_no_alvo` | Motor passo 7 (`|price-base| < 0.005`). |
| `acima_do_venda` | Motor passo 8 (oferta sugerida > preço de venda). |

## 9. Plano de fases e milestones

### Fase 1 — Regras + Clusters (CRUD) · **BACKEND PORTADO (PR #33)**
Entidades, migration 010, DTOs, services e controllers de regras e clusters; validação espelhando o legado; bloqueio de delete de cluster em uso.
**Critérios de aceitação técnicos (atendidos):** CRUD completo nas 7 rotas; `400` em classificação+cluster juntos, concorrência sem concorrente, UUID malformado, FK de cluster inexistente; `409` ao deletar cluster em uso; `401`/`403` por RBAC. Coberto pelo e2e.
**Critério observável pelo usuário (PENDENTE):** "operador cria a regra X na tela `/regras` e a vê listada" — **não exercitável sem front** (§14, §17.1). Marcar como *backend pronto, não exercitável por operador*.

### Fase 2 — Motor + `GET /pricing/suggestions` · **BACKEND PORTADO (PR #33)**
Motor puro + spec; orquestração com origens habilitadas, join dinâmico por origem, partição cluster/classe, membership única, arredondamento único, filtros e contagens.
**Critérios de aceitação técnicos (atendidos):** spec cobre 2 estratégias, 3 modos, 7 motivos, precedência/exclusão de cluster, `noCompetitorMargin`, trava de margem, arredondamento (`npm test`, sem DB). E2e confirma `margem 40% → 6/0.6 = 10` (`basis margem_minima`) e `concorrência lowest → segue DROGAL 12` (`basis concorrencia`), com `competitors[]` por origem.
**Critério observável pelo usuário (PENDENTE):** "operador cria regra `margem 30%` e vê o produto Y com preço sugerido Z na tela `/precos/sugestoes`" — **não exercitável sem front**.

### Fase 3 — Aplicar em massa + Agendamento · **PLANEJADO**

No legado a tela tem **dois modos distintos** (`handleConfirmPriceChange` `mode 'now'` vs `'scheduled'`): **aplicar agora** (push imediato ao ERP) e **agendar** (grava `executionDate` no ERP-proxy `/scheduling`; o **ERP** aplica depois). O farmacore **não tem** o `/scheduling` do ERP. A Fase 3 implementa os dois modos sobre o apply A7Pharma por-EAN já existente (`CatalogMutationService.updatePrice` / `upsertOffer`) + pipeline RabbitMQ. **A diferença de confiabilidade vs. legado é material e está registrada em §17.2.**

#### 9.1 Registro do step no pipeline (pré-requisito — sem isto nada consome)
A topologia do farmacore é **estática**: filas derivam do enum `PipelineStep` via `STEP_QUEUES`/`BATCHED_STEPS`/`PER_ORIGIN_STEPS` + `STEP_PREFETCH`, declaradas no boot em `queue.module.ts` (`queueWithDlq`; cada fila com `.dlq` sob o DLX). Um `APPLY_PRICE` novo **não existe em nenhum registro** — sem registrá-lo, o `RabbitSubscribe` não acha a fila e nada consome. Tarefas:
1. Adicionar `APPLY_PRICE` ao enum `PipelineStep`.
2. Registrar em `BATCHED_STEPS` (gera dispatch + batch) e em `STEP_PREFETCH` (`dispatchStep(APPLY_PRICE): 1`, `batchStep(APPLY_PRICE): 1` — apply é serial por segurança).
3. `allStepQueueNames`/`queueWithDlq` passam a cobrir `apply-price.dispatch`, `apply-price.batch` e seus `.dlq` automaticamente (já iteram `BATCHED_STEPS`).
4. **Standalone, fora do DAG diário:** apply roda via `publishSingleStep` sob demanda (POST) ou pelo cron de schedule — **não** entra no pipeline diário.

#### 9.2 Fronteira de estado: `core.pipeline_run` é dono do ciclo de vida
O fan-in e o status do run **já vivem** em `core.pipeline_run`, keyed por `(pipeline_run_id, step, batch_seq)`, com incremento atômico em `completeBatchAndIncrement` (CTE idempotente em redelivery; só conta a transição `running→completed`; `batches_done/planned` no DB sobrevivem a restart). **Não duplicar isso.** Regra: `core.pipeline_run` é dono de status/fan-in; `pricing_apply_run` é fino (idempotency + `pipeline_run_id` + `requested_by` + `mode`); `pricing_apply_item` guarda só o resultado/snapshot por-EAN. **`applyRunId === pipelineRunId`**, para o `GET /pricing/apply/:id` cruzar os dois.

#### 9.3 Idempotência e reentrância (por estado, não por "no-op do ERP")
**É falso assumir que "reaplicar o mesmo preço é no-op no ERP".** `CatalogMutationService.updatePrice`/`upsertOffer` fazem `POST` que altera preço no ERP (não comprovadamente idempotente: pode gerar histórico/webhook). Com RabbitMQ at-least-once + prefetch, a mesma mensagem de batch pode ser entregue 2×. Defesa:
- **Claim atômico por item antes do push:** `UPDATE pricing_apply_item SET status='applying' WHERE apply_run_id=$1 AND ean=$2 AND status='pending' RETURNING ean`. Só quem ganhou a linha empurra ao ERP. Item já `applied`/`applying` é pulado.
- **Idempotência de submissão:** `idempotency_key` unique em `pricing_apply_run` → reenvio do mesmo POST retorna o run existente (não cria outro).
- **Fan-in idempotente:** usa `completeBatchAndIncrement` (já à prova de redelivery).
- **Retry só em erro transitório:** o batch consumer só faz `throw` (→ DLQ + redelivery) em erro **transitório** (rede/5xx A7). Erros **permanentes** (ver §9.4) viram `failed`/`skipped` no item e a mensagem é **ack**ada — senão a mensagem volta ao DLQ e re-tenta para sempre.

#### 9.4 `POST /pricing/apply` — modelo, revalidação e motivos de rejeição
```jsonc
{
  "idempotencyKey": "uuid",
  "mode": "agora",            // "agora" | "agendado" (agendado vai por POST /schedules)
  "items": [
    { "ean": "789...", "target": "precoVenda" | "precoOferta",
      "price": 10.0,          // PREÇO APROVADO PELO OPERADOR (pode ser override manual — §9.8)
      "cadernoId": 123 }      // obrigatório se target=precoOferta (origem: §9.8)
  ]
}  // → 202 { applyRunId, accepted, rejected: [{ean, reason}] }
```
**Revalidação = segurança, não "recalcular-e-aplicar".** O servidor **não** recalcula e aplica um preço diferente do que o operador viu (isso seria "escrever preço errado em produção", §17.3). Em vez disso, **congela o preço aprovado** (`price` do item) e o valida contra guarda-corpos, reusando o **mesmo caminho** do `PricingSuggestionsService` (load do EAN + `computeSuggestion`):
- Recomputa a sugestão para o EAN e compara `suggestion.price` com o `price` aprovado dentro de **banda** (não igualdade — senão o **override manual legítimo** seria sempre rejeitado, §17.8). A banda mínima: `price ≥ floor` (não fura a margem mínima da regra) **e**, se `target=precoOferta`, `price ≤ precoVenda` (não passa do preço de venda). Se a regra **sumiu** ou agora computa `none`, e o `price` ainda respeita os guarda-corpos absolutos (`≥ custo`, dentro do `max_variation_pct` do tenant), aceita o **valor aprovado congelado** — não rejeita por falta de regra. Tolerância numérica `0.005` (mesma do motor).
- **Aplica exatamente o `price` congelado**, nunca um recálculo.
- **Onde revalidar:** no `POST` (síncrono) para devolver `rejected[]` cedo ao operador; a **campanha ativa** é re-checada de novo no **batch consumer** (TOCTOU — §9.9).
- **Motivos estruturados de `rejected`/`skipped`** (cada `ConflictException` do `CatalogMutationService` mapeia para um `reason` estável): `monitored` (produto monitorado, preço travado), `sem_external_id` (sem id ERP), `a7_nao_configurado` (sem credencial A7), `em_campanha` (§9.9), `recalculo_divergente` (preço aprovado fura guarda-corpo), `sem_sugestao` (sem regra e sem preço aprovado válido), `sem_caderno` (`precoOferta` sem caderno resolvível — §9.8), `expirado` (sugestão divergiu além da tolerância e precisa reaprovação humana).

`GET /pricing/apply/:applyRunId` (OPERATOR/ADMIN): relatório `{ status, total, applied, skipped, failed, items: [{ean, status, reason?, priceNew, priceOld, basis, ruleId, appliedAt}] }`. `status` reflete `core.pipeline_run` (`queued|running|done|failed`). **`404`** se o run não existe **no schema do tenant** (cross-tenant já barrado pelo search_path). `items[]` é **paginado** (`?page&perPage`) para runs grandes. Enquanto `queued|running`, `200` com parciais (polling).

#### 9.5 Aplicar agora vs. agendar, e guarda-corpos de sanidade
- **Aplicar agora (`mode: agora`):** `POST /pricing/apply` cria run + itens, publica `apply-price.dispatch`. Push imediato ao ERP via batch consumer.
- **Agendar (`mode: agendado`):** vai por `POST /pricing/schedules` (§9.7). **Não há paridade com o ERP-scheduled do legado** — roda no cron do farmacore: se o farmacore cai, o agendamento não dispara (o ERP-scheduled não tinha esse risco). Registrado em §17.2.
- **Guarda de sanidade (circuit breaker) por run:** abortar o run (status `failed`, nada aplicado) se `> N%` dos itens divergirem na revalidação **ou** se o delta médio/algum item exceder um teto absoluto (ex.: nenhum preço cai `> X%` ou sobe `> Y%` sem flag explícita). Limites configuráveis por tenant; valores default são **decisão de negócio** (§17.9).
- **Pré-checagem de credencial A7 no dispatch:** se o tenant **não** tem credencial A7, abortar o run cedo com erro claro — em vez de falhar item-a-item gerando milhares de chamadas sem efeito.

#### 9.6 Atomicidade ERP↔espelho e auditoria
`CatalogMutationService.updatePrice` faz o push A7 **antes** do `em.update` local — num lote, falha parcial deixa ERP novo e espelho velho. Fronteira da Fase 3:
- **Gravar `pricing_apply_item.status='applied'` só após o push A7 retornar OK**, na mesma transação tenant que espelha local; em falha de push, `status='failed'` e **não** espelhar.
- **Preferir o push em lote real** onde existir (`a7.changePrices` já aceita array) para reduzir chamadas; o batch consumer agrupa por tipo (venda × oferta) e por caderno.
- **Auditoria por item (obrigatória antes de ir a produção — §17.10):** gravar `price_old_sell`/`price_old_offer` (para auditar e **desfazer**), `price_new`, `target`, `basis`, `rule_id`, `cluster_id`, `cost_at_apply`, `requested_by`, `applied_at`, `erp_result`. Sem o preço anterior não há undo nem trilha forense. **Aplicar preço em massa no PDV sem registro de quem aplicou o quê é risco operacional/compliance numa farmácia** — o legado emitia `auditLog` em cada mutação (`precos.cluster.create/update`, `precos.preco.schedule`); o farmacore **não tem auditoria hoje** e isso precisa existir pelo menos para apply/schedule (e idealmente para CRUD de regra/cluster). Id de correlação ligando o `GET /suggestions` visto ao run aplicado.

#### 9.7 Agendamento (`pricing_schedule` + cron)
- **Host:** singleton na **API** (espelha `DailyPipelineCron`: `@Cron` com early-return se `process.env.WORKER_MODE === '1'`, `timeZone: 'UTC'` explícito). Granularidade do `@Cron`: por minuto.
- **Anti-disparo-duplicado em múltiplas réplicas de API:** o scan usa `SELECT ... FOR UPDATE SKIP LOCKED` (ou advisory lock por tenant) sobre `pricing_schedule` vencidos — só uma réplica pega cada schedule.
- **Semântica `run_at` vs `cron`:** mutuamente exclusivos (CHECK no DB, §6). `run_at` único → após disparar, `active=false`. `cron` recorrente → permanece ativo; `last_run_id` guarda o último run.
- **Recálculo vs. congelamento — decisão de negócio aberta (§17.9):** o plano propõe que o schedule guarde **filtros** e **recalcule na hora**. Mas entre agendar e executar, custo/concorrência/regra mudam — e aplicar automaticamente, em escala, um preço que o operador **nunca viu** é a maior superfície de "preço errado em produção" do plano (um bug numa regra criado depois do agendamento iria a toda a base). Por isso o agendamento **exige guarda-corpo**: `max_items` (teto de quantos itens um schedule move por execução), `max_variation_pct` (rejeita item cujo delta exceda o teto → `expirado`), e **alerta de anomalia** se um schedule mover muito mais itens que a execução anterior. A alternativa (congelar preços como o legado) está em §17.9.

#### 9.8 Chave de apply, override manual e origem do `cadernoId`
- **Chave canônica = EAN**, ponta a ponta. `CatalogMutationService.updatePrice` resolve `EAN→external_id` internamente. A UI legada limpava seleção por `productId` numérico; como o novo contrato não expõe `id`, a limpeza de seleção do front passa a ser **por EAN** (decisão de contrato §17.1). O mapeamento `ean↔productId` fica interno ao `CatalogMutationService`.
- **Override manual é legítimo:** o operador edita o preço sugerido linha a linha na tela; o `price` enviado ao apply é o valor editado, **não** o `suggestion.price`. A revalidação (§9.4) garante **segurança** (não fura margem, não passa do preço de venda), **sem proibir** o ajuste manual. Igualdade com o recálculo **não** é exigida.
- **Origem do `cadernoId` quando `target=precoOferta`:** derivar do `offer_book.external_id` existente do EAN. Se o EAN não tem caderno, **rejeitar** (`reason='sem_caderno'`) — não inventar caderno. No **agendamento** (sem EANs congelados) isso é resolvido **por-EAN no recálculo**, não no payload.

#### 9.9 Bloqueio de campanha ativa (join + TOCTOU)
`offer_book` (por-EAN) tem `external_id` = `idCadernoOferta`; "campanha ativa" vive em `tenant_offer_campaign` (`external_id` unique, `active`, `start_date`, `expiration_date`). Predicado de bloqueio:
```sql
EXISTS (
  SELECT 1 FROM offer_book ob
  JOIN tenant_offer_campaign c ON c.external_id = ob.external_id
  WHERE ob.ean = $ean AND c.active = true
    AND (c.start_date IS NULL OR c.start_date <= now())
    AND (c.expiration_date IS NULL OR c.expiration_date > now())
)
```
- **`target=precoVenda`:** se o EAN está em campanha ativa → `skipped`/`em_campanha` (não sobrescreve preço promocional vigente).
- **`target=precoOferta`:** não sofre esse bloqueio (é justamente a campanha), mas o `cadernoId` precisa ser coerente com a campanha-alvo do EAN (§9.8).
- **Re-checar no MOMENTO do apply (batch consumer), não só no dispatch.** Uma campanha pode iniciar/terminar entre dispatch e batch (minutos/horas na fila) — é TOCTOU. O legado fazia `campaignQuery.refetch` antes de aplicar; espelhamos isso: a checagem roda **dentro da transação** do batch consumer que faz o push, marcando `skipped/em_campanha` atomicamente.

#### 9.10 Multi-tenancy na fila (validar tenant da mensagem)
A Fase 3 roda **fora do request HTTP**, na fila. O `TenantTransactionService.runWithTenant` já valida o nome do schema com regex (`^[a-z_][a-z0-9_]{0,62}$`) antes de `SET LOCAL search_path TO "<schema>"` — defende contra injeção de identificador, mas **não** garante que o schema corresponde a um tenant real. Defesa adicional: o batch/dispatch consumer **resolve o `tenantId` da mensagem contra `core.tenant`** (aborta se inexistente) e deriva o nome do schema **do `core.tenant` validado**, nunca da string crua da mensagem. Teste de integração: mensagem com `tenantId` forjado/inexistente **não escreve em nenhum schema**.

**Tarefas concretas e dependências**
1. Migration tenant `011-create-pricing-apply-tables` (3 tabelas, BaseEntity onde indicado, CHECKs, índices). *(dep: nenhuma)*
2. Registro do step `APPLY_PRICE` (enum + `BATCHED_STEPS` + `STEP_PREFETCH` + filas/DLQ). *(dep: nenhuma)*
3. `PricingApplyService` (cria run/itens com snapshot, revalida via motor reusando `PricingSuggestionsService`, idempotency_key, circuit breaker). *(dep: 1, Fase 2)*
4. `apply-price.dispatch.consumer` (claim/slice, pré-checa credencial A7, marca `monitored`/`sem_external_id`/`em_campanha` cedo). *(dep: 1, 2, 3)*
5. `apply-price.batch.consumer` (claim atômico por item, push A7 → espelho na mesma tx, re-checa campanha, mapeia 409→reason, fan-in via `completeBatchAndIncrement`). *(dep: 4, `CatalogMutationService`)*
6. Validação de tenant da fila contra `core.tenant` (§9.10). *(dep: 4, 5)*
7. `pricing-apply.controller` (`POST /apply`, `GET /apply/:id` paginado). *(dep: 3)*
8. `PricingScheduleService` + `PricingScheduleCron` (API singleton, `FOR UPDATE SKIP LOCKED`, guarda-corpos) + `pricing-schedules.controller` (`POST/GET/DELETE`). *(dep: 3, 4)*
9. Auditoria por-item + logs estruturados (§11) + id de correlação. *(dep: 5)*
10. Testes Fase 3 (§10). *(dep: tudo)*

**Critérios de aceitação Fase 3 (verificáveis):**
- `POST /apply mode=agora` cria run, aplica via A7Pharma o **preço aprovado congelado**, reflete `applied/skipped/failed` com `reason` estruturado; `GET /apply/:id` traz o relatório com preço anterior e novo.
- Reenvio do mesmo `idempotencyKey` retorna o **mesmo** run, sem reaplicar.
- EAN `monitored`/`sem_external_id`/`a7_nao_configurado`/`em_campanha` → `skipped`/`failed` com o `reason` certo, **sem** loop de DLQ.
- Item cujo `price` aprovado fura o piso de margem → `rejected reason=recalculo_divergente`; override manual **dentro** da banda → aplicado.
- Campanha que inicia entre dispatch e batch → o EAN vira `em_campanha` no batch (não sobrescreve).
- Mensagem com `tenantId` inexistente → nenhuma escrita em schema.
- `POST /schedules` com `run_at` dispara no horário, respeita `max_items`/`max_variation_pct`, `active=false` após run único; múltiplas réplicas de API não duplicam disparo.

## 10. Estratégia de testes

| Nível | Cobre | Comando |
|---|---|---|
| **Unit (motor)** | 2 estratégias, 3 modos, 7 motivos, precedência/exclusão de cluster, `noCompetitorMargin` (inclusive ~95), `variationPct` negativo extremo (alvo≤0 → `sem_custo`), trava de margem, arredondamento **com e sem range cobrindo o preço**, `suggestionDelta`. **Roda sem DB** — rede de segurança principal. | `npm test` (`pricing-suggestion.engine.spec.ts`) |
| **e2e (Fases 1–2)** | Boota `AppModule` real, provisiona tenant `e2epricing`, semeia produto + concorrente DROGAL em `shared_catalog` + habilita origem, login, CRUD com validação, `409` de cluster em uso, `403` de RBAC em leitura, motor margem (`10`) e concorrência (`12`). | `npm run test:e2e` (`test/pricing-suggestions.e2e-spec.ts`) |
| **Unit/integração (Fase 3)** | **dispatch consumer:** slicing, skip de `monitored`/`em_campanha`, pré-checa A7. **batch consumer:** claim atômico (reentrância via status, não no-op), `applied`/`failed`/`skipped`, mapeamento 409→reason, push A7 mockado (`A7PharmaApiClient`, já mockado em `catalog-mutation.service.spec`). **idempotência:** POST duplicado → mesmo run. **revalidação:** preço fura piso → rejeitado; override dentro da banda → aceito. **bloqueio de injeção:** origin maliciosa em `tenant_competitor_origin` é descartada pelo whitelist (§12). **tenant forjado:** mensagem com tenant inexistente não escreve. | `npm test` / `npm run test:e2e` |
| **e2e (Fase 3)** | `POST /apply mode=agora` → run `done` → `GET /apply/:id` com relatório (preço anterior/novo, reasons); schedule `run_at` dispara e respeita guarda-corpos. | `npm run test:e2e` |
| **Build + lint** | Typecheck contra entidades/serviços reais; estilo. | `npm run build` · `npm run lint` |
| **Manual** | Fluxo ponta-a-ponta com dados reais. | Sequência abaixo |

**Pré-requisitos do e2e/manual** (stack docker, postgres `:5433`, rabbitmq `:5673`, `NODE_ENV=development`):
```
docker compose up -d
npm run migration:run:app          # core + shared_catalog
npm run seed:system-admin
npm run seed:local-tenant          # cria tenant macfarma + roda migration tenant (010, +011 na Fase 3)
# (e2e provisiona o próprio tenant e roda: npm run migration:tenant e2epricing)
```
**Manual:** habilitar uma origem em `core.tenant_competitor_origin` → criar regra `margem 30%` → `GET /pricing/suggestions` e conferir `price = custo/(1-0.30)` arredondado → (Fase 3) `POST /pricing/apply` e conferir o preço no ERP A7 + o relatório.

## 11. Observabilidade e operação

- **Logs estruturados.** O `GET /suggestions` é read-only; um erro de SQL sobe como `500` com stack. Na Fase 3 o pipeline já loga por step; o apply loga `apply-price dispatch: N batch(es), M skipped (em_campanha / monitored / sem_external_id)` e, por item que falha, `{ean, reason, erp_result}`.
- **Contadores de cabeçalho do GET:** `count`, `suggestionCount`, `lockCount`, `activeRuleCount` (semântica em §7.8). `lockCount` alto = regras de concorrência agressivas demais.
- **Apply em massa (Fase 3):** logar por run `{applyRunId, total, applied, skipped, failed}` ao fechar o fan-in; relatório persistido em `pricing_apply_run/_item` para auditoria (com preço anterior — §9.6). Id de correlação ligando a visualização do operador ao run.
- **Auditoria (Fase 3 — requisito de produção).** Ator, EANs, preço anterior e novo, `basis`/regra que justificou, timestamp, resultado bruto do push A7 — por item. Sem isso não há trilha forense nem undo (§9.6, §17.10).
- **Métricas candidatas:** applies/dia, taxa de falha A7Pharma, itens bloqueados por campanha, itens `monitored`/`sem_external_id` por run (sinal de catálogo desalinhado com o ERP).

## 12. Segurança e multi-tenancy

- **Isolamento por search_path (HTTP).** `SearchPathInterceptor` seta `search_path = tenant_<slug>, shared_catalog, public`. `product`, `classification`, `offer_book`, regras, clusters e `tenant_offer_campaign` resolvem sem qualificação; `shared_catalog.product` resolve por estar no path.
- **`core` é fora do path.** `core.tenant_competitor_origin` e `core.price_rounding_*` são qualificados e keyed por `tenant_id` via `resolveTenantId(em, slug)` — cross-tenant impossível por construção.
- **Multi-tenancy na fila (Fase 3).** `TenantTransactionService` valida o schema com regex antes do `SET LOCAL search_path TO "<schema>"`, mas o nome do schema **deve** vir de `core.tenant` validado, **não** da string crua da mensagem RabbitMQ (§9.10). Teste prova que tenant forjado não escreve.
- **Injeção SQL no join dinâmico — invariante explícita e testada.** `loadProducts` interpola o nome da origem direto no SQL (`AND ${a}.origin = '${origin}'` e o alias `o_${origin}`). **A ÚNICA barreira hoje é o whitelist** em `enabledOrigins` (`.filter(o => Object.values(CompetitorOrigin).includes(o))`). Riscos: se alguém adicionar uma `origin` free-text em `core.tenant_competitor_origin`, ou tornar o enum dinâmico, vira injeção de segunda ordem direto na query do catálogo; e o alias `o_${origin}` quebraria com qualquer caractere não-identificador. Endurecimento (a fazer): **(a)** teste que injeta uma origin maliciosa em `tenant_competitor_origin` e prova que a query a descarta; **(b)** mapear `origin → alias seguro` por índice numérico (`o_0`, `o_1`…) em vez do nome; **(c)** parametrizar o literal `origin = $n` (só o `JOIN`/alias precisa de interpolação, e essa usa o índice). Todo o resto (`name`, `classification`) já é parametrizado.
- **RBAC.** **Leitura de pricing (suggestions/rules) e mutações exigem `@Roles(OPERATOR, ADMIN)`** — custo/margem/composição são inteligência competitiva (§7). `JwtAuthGuard`+`RolesGuard` globais; `:id` via `ParseUUIDPipe`. Decisão sobre exigir ADMIN/aprovação para apply em massa em §17.3.
- **Validação na borda.** DTOs `class-validator` + cross-field no service. FK `23503` (cluster inexistente) traduzida para `400` claro; CHECK XOR (§6) traduzido para `400`.

## 13. Performance e escalabilidade

O `GET /suggestions` **carrega o catálogo inteiro do tenant cruzado com N origens (sem `LIMIT`), calcula em memória e filtra/pagina depois**. Isso é deliberado e **espelha o legado**: as contagens (`count`, `suggestionCount`, `lockCount`) e `availableBooks` precisam ser sobre o conjunto **inteiro** pós-cálculo, antes de paginar — empurrar isso para o SQL exigiria reimplementar o motor em SQL.

- **Custo e mitigação.** Cada request faz um scan pesado + objeto grande em memória, e a rota é exposta a OPERATOR/ADMIN sem rate limit. Mitigações: **`Cache-Control: private, max-age=30`** (paridade com o legado, que o port havia removido — reintroduzir); empurrar os filtros baratos (`name`/`classification`/`books`) para o SQL onde possível; teto de `perPage` (já 1000) e **medir** o tempo do GET com catálogo realista (dezenas de milhares de SKUs × N origens). Acima do volume aceitável, o caminho é **materializar** as sugestões num passo de pipeline e servir do banco (§18). Avaliar rate limit/timeout na rota.
- **Cargas únicas.** Membership (`loadActiveClusterMembership`) e arredondamento (`roundingRanges`) são carregados **uma vez por request**, nunca por produto. O join por origem é um `LEFT JOIN` por origem habilitada (3–9 joins típicos).
- **Índices.** `IX_PRODUCT_CLUSTER_MEMBER_EAN` (membership por EAN), `IX_PRICING_SUGGESTION_RULE_ACTIVE` (filtro de regras ativas). O join principal usa as PKs de `product`/`classification`/`offer_book`; conferir índice em `product(classification_id)` e `offer_book(ean)`.

## 14. Rollout, migração e compatibilidade

- **Ordem das migrations.** `core`/`shared_catalog` (via `migration:run:app`) **antes** do tenant. A tenant 010 (e 011 na Fase 3) criam as tabelas **no schema de cada tenant** — `migration:tenant <slug>` (um) ou `migration:tenant:all` (todos). **Tenants provisionados durante o deploy** pegam as migrations pendentes no provisionamento; documentar a ordem provisionamento × migration runner para não deixar tenant sem as tabelas.
- **Reversibilidade estrutural vs. dados de auditoria.** `down()` das migrations dropa as tabelas (estrutura, reversível). **Mas `pricing_apply_run/_item` guardam o histórico de preços realmente escritos no ERP** — dropar isso num rollback apaga trilha forense. Política: tratar essas tabelas como **dados de auditoria** (exportar/preservar antes de qualquer rollback; nunca dropar como rotina). Plano de rollback **de preço** (não de schema): usar o snapshot `price_old_*` por item para desfazer um run no ERP (§9.6).
- **Quebra de contrato com o front pricy — item de escopo, não nota de rodapé.** O hook `usePricingSuggestionProducts.ts` valida via **Zod** e **exige** `product.id` (number), `drogalPrice/drogasilPrice/michelassiPrice`, `drogalIsPbm/drogasilIsPbm`, `drogalVan/drogasilVan` e `curve`. A nova API **não** retorna `id` nem `curve` e troca os campos fixos por `competitors:[{origin,price,isPbm,van}]`. **No dia do corte a tela de Sugestão quebra inteira (Zod rejeita), não degrada.** Logo: as Fases 1–2 entregam **backend**, não valor ao usuário, até o front ser reescrito. Decisão de fechamento (manter `id`/`curve`, versionar endpoint, ou entregar back+front no mesmo PR) com dono/prazo em **§17.1**.
- **Sem feature flag** no backend: rotas novas, sem alterar comportamento existente.

## 15. Riscos e mitigações

| # | Risco | Prob / Impacto | Mitigação | Ref |
|---|---|---|---|---|
| 1 | Divergência de cálculo vs legado | Média / Alto | Motor portado quase-verbatim; spec replica casos e roda sem DB; e2e confere 10 e 12. | §8, §10 |
| 2 | PBM via `metadata->>'isPbm'` ausente/inconsistente; OR sobre origens; em `margem` não bloqueia | Média / Médio→Alto | Hoje conservador só em concorrência; **revisar com negócio** se margem sobre PBM é intencional e derivar PBM do ERP do tenant. | §8, §17.5 |
| 3 | Origem não habilitada / sem coleta | Média / Médio | `enabledOrigins` filtra `enabled=true`; sem preço cai fora (renormaliza/ignora). | §5 |
| 4 | Custo do load-all em catálogo grande / DoS interno | Média / Médio | `Cache-Control:30s`, medir, materializar se crescer; rate limit a avaliar. | §13 |
| 5 | FK de cluster apagado entre listar e salvar | Baixa / Baixo | `23503`→`400`; delete de cluster em uso bloqueado (`409`). | §7 |
| 6 | Regra sem alvo (nem classe nem cluster) por escrita fora do service | Baixa / Alto | **CHECK XOR no DB** (cinto-e-suspensório). | §6 |
| 7 | **Divergência ERP↔espelho local em falha parcial** (Fase 3) | Média / Alto | Gravar `applied` só após push OK na mesma tx; em falha não espelhar; push em lote. | §9.6 |
| 8 | **Injeção de 2ª ordem via `tenant_competitor_origin`** | Baixa / Alto | Whitelist contra enum é a barreira; teste de regressão + alias por índice + literal parametrizado. | §12 |
| 9 | **Cross-tenant write na fila por `tenantId` forjado** (Fase 3) | Baixa / Alto | Resolver tenant contra `core.tenant`; schema vem do validado; teste de tenant forjado. | §9.10 |
| 10 | **TOCTOU de campanha** (inicia/termina entre dispatch e batch) | Média / Alto | Re-checar campanha **no batch consumer**, dentro da tx do push. | §9.9 |
| 11 | **PBM aplicado em estratégia margem** | Média / Alto | Decisão de negócio: bloquear por padrão também em margem. | §8, §17.5 |
| 12 | **Agendamento auto-aplicando regra bugada em escala** | Média / Alto | `max_items`/`max_variation_pct`, alerta de anomalia, ou congelar preço aprovado. | §9.7, §17.9 |
| 13 | **Credencial A7 ausente derruba o lote inteiro item-a-item** | Média / Médio | Pré-checar credencial no dispatch e abortar cedo. | §9.5 |
| 14 | **Ausência de preço-anterior/auditoria → sem undo nem trilha** | Alta / Alto | Snapshot `price_old_*` + auditoria por item antes da Fase 3 ir a produção. | §9.6, §17.10 |
| 15 | **Apply duplicado por retry de fila** (Fase 3) | Média / Médio | Claim atômico por item antes do push; idempotency_key no run; fan-in idempotente. | §9.3 |
| 16 | **Preço recalculado ≠ preço aprovado pelo operador** (apply assíncrono) | Média / Alto | **Congelar** o preço aprovado; revalidação só rejeita (não recalcula-e-aplica); circuit breaker. | §9.4, §9.5, §17.3 |
| 17 | **Override manual rejeitado pela revalidação por igualdade** | Média / Médio | Revalidar por **banda** (piso de margem / ≤ preço de venda), não igualdade. | §9.4, §9.8, §17.8 |
| 18 | Tela quebra no corte (Zod rejeita contrato novo) | Alta / Alto | Decisão de contrato com dono/prazo; back+front no mesmo PR ou versionar. | §14, §17.1 |

## 16. Dependências

- **`core` price-rounding** (`price_rounding_range/_rule` + `PriceRoundingService`) — já existe e é reusado.
- **`core.tenant_competitor_origin`** (`tenant_id`, `enabled`, `priority`) — já existe; popula as origens consideradas.
- **`shared_catalog.product`** populado pelos scrapers (preço, `metadata.isPbm`, `metadata.van`) — fonte da concorrência.
- **`core.pipeline_run`** — dono do fan-in/status do apply (Fase 3).
- **`tenant_offer_campaign`** (`external_id`, `active`, `start_date`, `expiration_date`) — bloqueio de campanha (Fase 3).
- **Pipeline RabbitMQ** (`src/pipeline`, `src/queue`) + `CatalogMutationService` + `A7PharmaApiClient` + `IntegrationConnectionService` (credencial A7) — Fase 3.

## 17. Questões em aberto / decisões a confirmar

> Itens abaixo são **decisões de negócio** que travam o front e/ou a Fase 3. Cada um tem proposta default, mas **não** deve ser implementado sem confirmação.

1. **Fechamento do contrato vs. front pricy (BLOQUEADOR de valor).** A tela atual (Zod) exige `id`/`curve`/campos fixos por origem; a nova API não os tem → tela quebra no corte. Opções: (a) manter `id`/`curve` e os 3 campos fixos por compat; (b) versionar o endpoint; (c) entregar back + front reescrito no mesmo PR. **Dono e prazo a definir.** Até lá, Fases 1–2 são "backend pronto, não exercitável por operador".
2. **Agendar: ERP-scheduled (paridade) vs. cron do farmacore (novo).** O legado grava `executionDate` no ERP e o ERP aplica (resiliente a queda do farmacore). A proposta usa cron do farmacore (se o farmacore cai, não dispara). Confirmar se a perda de resiliência é aceitável ou se precisamos de paridade.
3. **RBAC do apply em massa.** Hoje OPERATOR aplica. Confirmar se apply em massa (e/ou schedule) exige **ADMIN** ou um passo de **aprovação**. Decisão também sobre `VIEWER_PRICING` para leitura.
4. **Dedup silencioso de concorrentes.** O service deduplica `competitors` repetidos (primeiro vence) sem erro. Confirmar se é desejado ou se duplicata deve ser `400`.
5. **PBM em estratégia margem e fonte do flag.** (a) Bloquear PBM por padrão também em `margem` (hoje só em concorrência)? (b) Derivar o status PBM do **ERP do tenant** (metadata do próprio item) em vez do **OR sobre concorrentes** (que falso-positiva/negativa)? Impacta `competitorPrices`/`pbm` e a auditoria.
6. **`cascade` segue ordem do usuário, não `priority`.** O motor usa a ordem do array `rule.competitors`. Se o negócio espera "ranking por prioridade do tenant", o motor precisa reordenar pela `priority` de `core.tenant_competitor_origin` — mudança de comportamento. Confirmar a semântica desejada.
7. **Retenção/TTL dos runs de apply.** São auditoria de preço no PDV. Definir política de arquivamento/limpeza e se há exigência regulatória de retenção mínima.
8. **Override manual — banda de tolerância.** Proposta: aceitar o preço do operador se `≥ floor` (e `≤ precoVenda` para oferta) e dentro do `max_variation_pct`. Confirmar a banda (e se há piso/teto absoluto por categoria).
9. **Schedule: recalcular com guarda-corpo vs. congelar preço aprovado.** Proposta: recalcular com `max_items`/`max_variation_pct`/alerta de anomalia. Alternativa mais segura (e paridade com legado): congelar o preço que o operador viu. Decisão de negócio — define a maior superfície de risco do plano.
10. **Auditoria mínima antes de produção.** Confirmar o conjunto obrigatório por item (ator, preço anterior/novo, regra/basis, timestamp, resultado A7) e se CRUD de regra/cluster também precisa de `auditLog` (o legado tinha).
11. **N origens na tela.** O backend generalizou para 9 origens; a tela/legado é hard-coded em 3 colunas com PBM/van só de Drogal+Drogasil. A tela vai mostrar colunas dinâmicas por origem habilitada ou um subconjunto fixo? Como exibir PBM/van para N origens? Isso fecha o shape final de `competitors[]` e desbloqueia o redesign do front.

## 18. Roadmap futuro / fora de escopo

- **Materializar sugestões** num passo de pipeline e servir do banco (escala além do load-all; §13).
- **Histórico de aplicações** e rollback de preço via snapshot `price_old_*` (base já no modelo da Fase 3, §6/§9.6).
- **Simulação / dry-run** de uma regra antes de salvar, e dry-run de um schedule.
- **Frontend** das telas `/regras` e `/precos/sugestoes` no novo app (este repo é só backend) — **pré-condição para valor ao usuário** (§14, §17.1).

## 19. Anexo A — Divergências do plano legado (verificação)

| # | Plano antigo dizia | Correção aplicada na v1 |
|---|---|---|
| 1 | Módulo novo `src/pricing/` | Vive em **`src/tenant-api/pricing/`** (controller+service por feature), registrado em `tenant-api.module.ts`. |
| 2 | Fonte em `…/nagoya/…` | Fonte canônica é **`florence`** (`krakow` é cópia velha sem clusters/`competitorMode`). |
| 3 | Preencher stubs de price-rounding no tenant | **Reusado** `core.price_rounding_range/_rule` via `PriceRoundingService` — não recriado. |
| 4 | Regra tem `priceRoundingTypeId` | **Removido** — farmacore tem conjunto único por tenant; `applyRounding` (bool) basta. |
| 5 | PBM em coluna booleana | Lido de **`shared_catalog.product.metadata->>'isPbm' = 'true'`** (OR sobre origens — limitação §8/§17.5). |
| 6 | `tenant_competitor_origin` no tenant | Está em **`core`** (keyed `tenant_id`, fora do search_path) — qualificado + `resolveTenantId`. |
| 7 | Construir repository do zero | **Modelado sobre `catalog.crossed()`**, generalizado para N origens (join dinâmico). |
| 8 | Script `migrate:tenant` | É **`migration:tenant`**. |
| 9 | Engine só média ponderada | Portado **tudo**: `weighted`/`cascade`/`lowest`, `noCompetitorMargin`, `priceComposition`. |
| 10 | Apply/agendamento em escopo da v1 | **Diferido** para Fase 3 (apply por-EAN já existe em `CatalogMutationService`). |
| 11 | Leitura aberta a qualquer autenticado | **Restrita a OPERATOR/ADMIN** (custo/margem/composição são sensíveis). |

## 20. Anexo B — Rastreabilidade rota legada → rota farmacore

| Legado (pricy-shelf) | farmacore |
|---|---|
| `pricing-suggestion-rules-list` | `GET /pricing/suggestion-rules` |
| `pricing-suggestion-rules-save` (create) | `POST /pricing/suggestion-rules` |
| `pricing-suggestion-rules-save` (update) | `PATCH /pricing/suggestion-rules/:id` |
| `pricing-suggestion-rules-delete` | `DELETE /pricing/suggestion-rules/:id` |
| `clusters-list` / `clusters-get` | `GET /pricing/clusters` / `GET /pricing/clusters/:id` |
| `clusters-save` / `clusters-delete` | `POST /pricing/clusters` , `PATCH /pricing/clusters/:id` / `DELETE /pricing/clusters/:id` |
| `pricing-suggestions-products` | `GET /pricing/suggestions` |
| ERP `/scheduling` `UPDATE_PRICE` (mode `now`) | (Fase 3) `POST /pricing/apply mode=agora` → pipeline → `CatalogMutationService.updatePrice` |
| ERP `/scheduling` `UPDATE_PRICE_OFFER` (mode `now`) | (Fase 3) `POST /pricing/apply` (`precoOferta`) → `CatalogMutationService.upsertOffer` |
| ERP `/scheduling` (mode `scheduled`, `executionDate`) | (Fase 3) `POST /pricing/schedules` → cron do farmacore (sem paridade de resiliência — §17.2) |

---

**Arquivos relevantes (caminhos absolutos):**
- Plano: `/Users/marcocinegaglia/conductor/workspaces/farmacore/pattaya/docs/plano-pricing-suggestion-port-2026-06-22.md`
- Motor + spec: `/Users/marcocinegaglia/conductor/workspaces/farmacore/pattaya/src/tenant-api/pricing/pricing-suggestion.engine.ts` (+ `.spec.ts`)
- Orquestração: `/Users/marcocinegaglia/conductor/workspaces/farmacore/pattaya/src/tenant-api/pricing/pricing-suggestions.service.ts`
- Regras: `.../pricing/suggestion-rules.{service,controller}.ts`; Clusters: `.../pricing/clusters.{service,controller}.ts`; DTOs: `.../pricing/dto/`
- Entidades: `/Users/marcocinegaglia/conductor/workspaces/farmacore/pattaya/src/database/entities/tenant/{pricing-suggestion-rule,product-cluster,product-cluster-member}.entity.ts`
- Migration 010: `/Users/marcocinegaglia/conductor/workspaces/farmacore/pattaya/migrations/tenant/1700000000010-create-pricing-suggestion-tables.ts`
- E2E: `/Users/marcocinegaglia/conductor/workspaces/farmacore/pattaya/test/pricing-suggestions.e2e-spec.ts`
- Fase 3 (reuso): `/Users/marcocinegaglia/conductor/workspaces/farmacore/pattaya/src/tenant-api/catalog/catalog-mutation.service.ts` · `/Users/marcocinegaglia/conductor/workspaces/farmacore/pattaya/src/queue/{constants.ts,queue.module.ts,pipeline-run.service.ts}` · `/Users/marcocinegaglia/conductor/workspaces/farmacore/pattaya/src/pipeline/daily-pipeline.cron.ts` · `/Users/marcocinegaglia/conductor/workspaces/farmacore/pattaya/src/tenant/tenant-transaction.service.ts` · `/Users/marcocinegaglia/conductor/workspaces/farmacore/pattaya/src/database/entities/tenant/tenant-offer-campaign.entity.ts`
