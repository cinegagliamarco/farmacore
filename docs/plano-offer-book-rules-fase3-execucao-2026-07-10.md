# Offer Book Rules — Fase 3: execução + relatório de alteração de preços (2026-07-10)

**Repo:** farmacore (app novo, `src/`). **Objetivo:** fechar a **Fase 3** do plano de
migração (`docs/plano-offer-book-rules-migracao-2026-06-21.md`, §5): executar uma regra
de oferta (aplicar os preços calculados aos produtos do caderno, escrevendo a oferta na
A7) e persistir um **relatório de auditoria** por execução, com os endpoints de leitura
que o FE já consome no legado.

> **Revisão v2 (2026-07-10):** revisão adversarial contra o código real reprovou o desenho
> "consumer bespoke + `reportId` como idempotência + índice `status='running'` + reset no
> boot" — três buracos de **dupla-escrita no ERP de produção**. O eixo mudou: **o execute
> é uma variante money-safe do `pricing_apply`** (ledger de items congelados + o consumer
> herda `BasePipelineConsumer` + recuperação por lock de idade + push em lote). As seções
> abaixo já refletem a correção; os pontos consertados estão marcados com `[v2]`.

> Princípio (CLAUDE.md): simplicidade dura, reuso do que já existe, validar só em
> fronteiras. Motor de cálculo, escrita no ERP e a máquina money-safe de apply **já existem**
> no app novo — a Fase 3 os costura; não reescreve nada disso.

## 1. O que falta hoje

`/offer-book-rules` expõe 5 rotas (Fase 1 preview + Fase 2 CRUD). **Não existe** execução nem
relatórios. As tabelas `offer_book_rule_execution_report(_item)` existem como **stub
minimalista** (criadas na `init-tenant`) e **nenhum código as lê/escreve** (drop/recreate
seguro). A `offer_book_rule` **não tem coluna de status** (não adicionada na Fase 2).

Endpoints-alvo (contrato do legado que o FE chama):

| Método | Rota                                      | O quê                                                          |
| ------ | ----------------------------------------- | -------------------------------------------------------------- |
| `POST` | `/offer-book-rules/:id/execute`           | dispara a execução (gera o relatório)                          |
| `GET`  | `/offer-book-rules/:id/execution-reports` | lista paginada dos relatórios de UMA regra (header, sem items) |
| `GET`  | `/offer-book-rules/execution-reports/:id` | detalhe de UM relatório com items paginados                    |
| `GET`  | `/offer-book-rules/execution-reports`     | lista global com filtros                                       |

## 2. O que já existe pra reusar (ancorado no código)

- **Máquina money-safe de apply** — `pricing_apply` é o **molde principal** (não só a escrita):
  `POST /pricing/apply` materializa `pricing_apply_run` + `pricing_apply_item` **status=pending**
  (preços **congelados**), guarda concorrência por `idempotency_key` **único**, enfileira via
  outbox após o commit, e o worker `ApplyPriceStep` (`src/pipeline/steps/apply-price.step.ts`,
  via `BasePipelineConsumer`) processa **só os items pending**, marca cada um dentro da tx e
  **nunca re-lança** — é isso que torna a redelivery segura (sem dupla-escrita). A Fase 3
  copia esse esqueleto.
- **Motor de cálculo** — `OfferBookRulesService.calculatePreviews` é **público**, mas
  `fetchProducts`/`attachCompetitorPrices`/`loadClassificationIndex`/`fetchRoundingRules` são
  **privados** e `fetchProducts` é **paginado (cap 1000)**. `[v2]` **Precisa de um método
  público novo** `computeForRule(em, slug, rule)` que orquestra o compute **não-paginado**
  (loop de páginas ou select-all) reusando os helpers — não dá pra "chamar fetchProducts
  direto" (`offer-book-rules.service.ts:442` público; `:873` privado+paginado).
- **Escrita no ERP em lote** — `A7PharmaApiClient.upsertOffer(creds, idCadernoOferta, items[])`
  aceita **array** de `{ idEmbalagem, precoOferta }` num único POST por caderno
  (`a7-pharma-api.client.ts:42`). `[v2]` **Não reusar `CatalogMutationService.upsertOffer`**
  (é 1-EAN → 1-POST, `catalog-mutation.service.ts:140`, e refaz `getApiCredentials` sem cache
  a cada chamada). O push da execução resolve a credencial **uma vez**, envia **N itens por
  chunk** (o caderno é constante = `rule.offerBookInfoId`, D4) e espelha `offer_book`/
  `product_item` **em bulk por chunk**.
- **Async / worker / tenant scoping** — worker headless (`main.worker.ts`, `WORKER_MODE=1`,
  `WorkerModule`), RabbitMQ (`queue.module.ts`, exchange + DLX), outbox
  (`outbox-publisher.service.ts`), `TenantTransactionService.runWithTenant` (`SET LOCAL
search_path`). Consumer resolve tenant por `tenants.findActive(msg.tenantId)` — `tenantId`
  = **slug** do JWT (idêntico ao molde `pricing-apply.service.ts:307`).
- **Padrão de cron** — `PricingScheduleCron` (guard `WORKER_MODE`, loop de tenants, claim com
  `FOR UPDATE SKIP LOCKED`). Reusar o **padrão**, não a tabela.

## 3. Decisões-chave (aprovar antes de codar)

**D1 — Relatório próprio × reusar `pricing_apply_run`.** _Rec: próprio._ Contrato do FE é
`/offer-book-rules/.../execution-reports`; o item carrega campos de oferta que
`pricing_apply_item` não tem. Mantém-se `offer_book_rule_execution_report(_item)` realinhado.

**D2 — Execução assíncrona via worker × síncrona.** _Rec: assíncrona._ Milhares de produtos ×
latência A7. Segue o caminho outbox + worker do apply.

**D3 `[v2]` — Money-safety da execução (o ponto crítico).** O guard **não** é um índice
`status='running'` (só protege na criação; deadlocka a regra se o run morre) nem reset no
boot (inexistente no app novo; atropela réplicas concorrentes). Em vez disso, **espelhar o
`pricing_apply`**:

- **Ledger de items congelados**: o `POST /execute` computa a regra e materializa **todos** os
  items na tabela do report na tx inicial — `pending` os que vão atualizar (preço e
  `external_id` de destino **congelados**), `skipped` os pulados. O preço e a embalagem A7 não
  são relidos no consumo (redelivery ou sync de produto não mudam o valor/destino escrito).
- **Concorrência por status + owner do report**: `offer_book_rule.status` (D5) vira `RUNNING`
  e `active_execution_report_id` cerca exatamente qual report pode renovar/finalizar a regra.
  Um `POST` concorrente recente → 409. Um `RUNNING` velho **retoma o mesmo ledger congelado**
  (não expira/recomputa): tenta o advisory lock do report e reenfileira o mesmo `reportId`.
- **Redelivery segura no consumo**: além do lease genérico, o step segura
  `pg_try_advisory_xact_lock` pela vida real do handler. Cada chunk usa transações tenant
  curtas. Após A7 2xx, primeiro commita `erp_applied`; só depois executa o mirror local e
  marca `applied`. Redelivery de `erp_applied` refaz apenas o mirror, sem novo POST à A7.
- **Finalização cercada**: o finalizador recusa report com `pending|erp_applied` e atualiza a
  regra somente se `active_execution_report_id = report.id`. Falha HTTP do chunk vira
  `failed` e o loop segue; falha de infraestrutura no mirror re-lança para DLQ preservando
  o checkpoint `erp_applied`.

**D4 — Escopo da escrita.** Sempre `precoOferta` no `cadernoId = rule.offerBookInfoId`, nunca
por-loja (caderno é do tenant inteiro).

**D5 `[v2, aprovado]` — Status na REGRA (fidelidade ao legado).** Adicionar `offer_book_rule.status`
(`IDLE|RUNNING|SUCCEEDED|PARTIALLY_SUCCEEDED|ERRORED`) e expô-la no `GET /` e `GET /:id`. É
onde mora o ciclo de vida da execução no legado e o **único lugar com PARTIALLY_SUCCEEDED**.
O **report** carrega `outcome` (`SUCCESS|FAILURE|NO_CHANGES`) + contadores, **sem** coluna de
status (igual ao legado).

**D6 `[v2]` — Semântica de `outcome`.** `outcome=FAILURE` se **qualquer** chunk falhou (parcial
OU total), com `error_message`; nunca colapsar parcial em SUCCESS. Total × parcial se
distingue pelo `status` da regra (`ERRORED` × `PARTIALLY_SUCCEEDED`).

**D7 `[v2, resolvido]` — Status-code do guard e nome do filtro.** Verificado no FE
(`farmacore-front` origin/main): ele está só na Fase 1 (chama **apenas** `POST
/offer-book-rules/preview`; nada de create/execute/reports — o próprio `offerBookRules.ts`
diz "save/apply/export come later"). Não há contrato de FE a preservar, e onde o FE trata
conflito ele usa `err.status === 409` (`ClustersPage`, `ProductsCrossedPage`), nunca 400.
**Decisão: guard concorrente → `409`; filtro da lista global → `ruleId` (uuid)** — casa a
convenção do FE e o esquema de id do app novo (uuid, não o PK numérico do legado). Os demais
filtros seguem o legado (`offerBookInfoId`, `executionType`, `outcome`, `startDate>=`,
`endDate<=`).

## 4. Modelo de dados (migration de realinhamento)

Tabelas vazias (sem writer) → drop/recreate (`DROP ... IF EXISTS`).

- **`offer_book_rule` (ALTER)** `[v2]`: `status` com CHECK dos 5 valores +
  `active_execution_report_id uuid`; CHECK garante owner presente somente em `RUNNING`.
- **`offer_book_rule_execution_report`**: `rule_id` (FK CASCADE), `offer_book_info_id bigint`,
  `executed_at timestamptz`, `execution_type text CHECK(MANUAL|SCHEDULED)`,
  `calculation_base_type text CHECK(...)`, `total_products int`, `products_updated int`,
  `products_skipped int`, `outcome text NULL CHECK(SUCCESS|FAILURE|NO_CHANGES)` (null enquanto
  o worker está executando),
  `error_message text`, timestamps. **Sem** coluna `status` (D5). `idempotency_key text UNIQUE`
  para dedup por execução (como `pricing_apply_run`, `1700000000011:33`).
- **`offer_book_rule_execution_report_item`**: `report_id` (FK CASCADE), `ean bigint`,
  `external_id text|null` (destino A7 congelado), `name`,
  `classification`, numéricos (`base_sale_price`, `current_price`, `current_margin`, `cost`,
  `percentage_value`, `applied_percentage_value`, `final_price`, `new_margin`),
  `action_type text|null`, as 6 flags (`price_lock_applied`, `discount_skipped`,
  `skipped_no_competitor_price`, `skipped_price_exceeds_limit`, `price_rounding_applied`,
  `was_updated`), e `[v2]`
  **`apply_status text CHECK(pending|erp_applied|applied|failed|skipped)`** +
  `apply_error text|null` (o ledger money-safe). `cost numeric(12,4)` preserva a auditoria da
  origem. Índice em `(report_id, apply_status)`.
- Enums novos `ExecutionType`, `ExecutionOutcome`, `OfferBookRuleStatus` em `src/database/enums/`.
- Os campos auditáveis batem com o legado; `external_id` é uma extensão money-safe necessária
  no worker assíncrono para impedir que um sync entre POST e consumo redirecione a escrita A7.

## 5. Execução (sub-fase 3.2) — o núcleo

**Endpoint** `POST /offer-book-rules/:id/execute` (`@Roles(OPERATOR, ADMIN)`), na tx do tenant:

1. 404 se a regra não existe; 409 se o caderno não está ativo/vigente ou se existe execução
   recente; execução velha é retomada pelo mesmo report (D3/D5). A vigência protege apenas
   o início de uma execução nova: um ledger existente pode concluir o mirror mesmo se a
   campanha expirou depois do POST original.
2. `computeForRule` (§2) → particiona `toUpdate` / `skipped`.
3. cria o report header + **materializa todos os items** (`toUpdate`=`pending` congelado,
   `skipped`=`skipped`); seta `rule.status=RUNNING`.
4. enfileira `EXECUTE_OFFER_BOOK_RULE` via **outbox** dentro da mesma tx `[v2]` com os campos
   **obrigatórios** do outbox: `pipelineRunId = report.id` (não há FK; uuid arbitrário ok,
   molde `pricing-apply.service.ts:307`), `step` (D8), payload `{ tenantId: slug, reportId }`.
5. responde `202 { reportId }`.

**Consumer** (worker), herdando `BasePipelineConsumer` `[v2]`:

- a transação externa segura o advisory lock; leituras/checkpoints/mirror usam transações
  curtas com fence pelo owner da regra;
- primeiro reconcilia `erp_applied`; depois lê `pending` em chunks e resolve credencial A7
  **uma vez**;
- antes de cada novo chunk, revalida a campanha; se ela expirou/inativou, preserva o que já
  foi reconciliado e fecha somente os `pending` como `failed/campanha_nao_vigente`;
- por chunk: `a7.upsertOffer(...)` → commit `erp_applied` → mirror bulk de
  `offer_book`/`product_item` → `applied`. Falha HTTP vira `failed`; falha do mirror preserva
  `erp_applied` e vai para DLQ;
- ao esgotar os `pending`: finaliza — `products_updated`/`products_skipped`/`total_products`,
  `outcome` (D6), `error_message`, e `rule.status` (`SUCCEEDED`/`PARTIALLY_SUCCEEDED`/`ERRORED`);
  `NO_CHANGES` + `SUCCEEDED` se não havia `toUpdate`.
- o consumer configura `MessageHandlerErrorBehavior.NACK`; colisão do advisory vai para a
  DLX em vez do default `REQUEUE` (que criaria hot-loop com prefetch 1).

**Exclusão**: `DELETE /:id` usa condição atômica `status <> RUNNING`; durante execução
retorna 409 para que o cascade nunca apague ledger/report enquanto a A7 está em voo.

**Wiring** `[v2]` (itens que o v1 omitia):

- prover `OfferBookRulesService` + `PriceRoundingService` no grafo do worker
  (`PipelineStepsModule`, como já foi feito com `CatalogMutationService`) — não vêm de
  `TenantApiModule`, que a API importa mas o worker não.
- adicionar o consumer ao array `CONSUMERS` (`pipeline-steps.module.ts`).
- **D8** — a wire-message do outbox exige `step: PipelineStep`: ou adicionar
  `PipelineStep.EXECUTE_OFFER_BOOK_RULE`, ou reusar um step e sobrescrever o routing com
  `queue: 'execute-offer-book-rule'` (routingKey = `${tenant}.${queue ?? step}`). O step é
  report-bound e fica excluído do trigger administrativo genérico, que não fornece `reportId`.
- nova fila via `queueWithDlq` em `queue.module.ts` + constante (nome inédito não quebra a
  topologia — DLX só falha ao **redeclarar** fila existente). Registrar um **channel dedicado
  com `prefetchCount:1`** (escrita à A7 serial, o efeito colateral caro) no mapa `channels`;
  `createQueueIfNotExists:false`.

## 6. Leitura dos relatórios (sub-fase 3.3) — os 3 GETs

No `OfferBookRulesController`, tenant-scoped:

- `GET /:id/execution-reports` — paginado, header sem items, `ORDER BY executed_at DESC`.
- `GET /execution-reports/:id` — report + items paginados (`perPage` obrigatório, `Max 100`;
  filtro `name` ILIKE); 404 se não existir.
- `GET /execution-reports` — lista global paginada, filtros `ruleId` (uuid)/
  `offerBookInfoId`/`executionType`/`outcome`/`startDate>=`/`endDate<=` (D7). Datas sem hora
  representam o dia civil inteiro em `America/Sao_Paulo` (`endDate` usa próximo dia exclusivo).
- **Ordem de rota**: declarar `/execution-reports` (literal) **antes** de `/:id` e de
  `/:id/execution-reports`, senão o `ParseUUIDPipe` do `GET /:id` (Fase 2) devolve 400.

## 7. Agendamento (sub-fase 3.4) — PR separada

Cron dedicado (padrão do `PricingScheduleCron`): guard `WORKER_MODE`, loop de tenants com
módulo `OFFER_BOOK_RULES`. `[v2]` **Timezone**: o app roda em UTC; o tenant é Brasil. Computar
dia/hora **no fuso do tenant**: `extract(dow from now() AT TIME ZONE 'America/Sao_Paulo')` e
`(executed_at AT TIME ZONE 'America/Sao_Paulo')::date`, com **janela de hora comercial** (o
legado usava 07–21). `[v2]` **`scheduled_days` é `jsonb`**, não `int[]`: usar
`scheduled_days @> to_jsonb(<dow>::int)` (o `int = ANY(jsonb)` do rascunho é SQL inválido).
Selecionar regras elegíveis que **ainda não rodaram hoje** (`NOT EXISTS` report `SCHEDULED`
com `executed_at` no dia local) e publicar a mesma mensagem `EXECUTE_OFFER_BOOK_RULE`
(`executionType=SCHEDULED`). Se o FE precisar de hora específica, adicionar `scheduled_hour`
numa migration.

## 8. Testes

- **Unit**: partição updates/skipped; montagem do item; `outcome`/`status` (todos ok /
  **parcial** / total / sem produtos — D6); dedup por `idempotency_key`. `em` + A7 mockados.
- **E2e** (`test/offer-book-rules.e2e-spec.ts`, A7 mockado): semear produtos+caderno+regra,
  `POST /:id/execute`, drenar/chamar o consumer, `GET` dos reports verificando contadores,
  items (`applied`+`skipped`), `outcome` e `rule.status`. Cobrir 409/400 (execute concorrente),
  NO_CHANGES, e **falha parcial** (A7 mock rejeita um chunk → `PARTIALLY_SUCCEEDED`/`FAILURE`).
  Verificar que **redelivery da mesma mensagem não re-empurra** items `applied`. Cobrir ainda:
  outcome nulo antes do worker; custo com 4 casas; campanha inativa/futura/expirada; duas
  entregas concorrentes; 81 itens (80+1) com falha parcial; trigger PostgreSQL abortando o
  mirror após A7 e replay somente do `erp_applied`; retomada do mesmo report; fim do dia local.

## 9. Riscos

- **Escrita de preços de oferta no ERP de produção, em massa** — o maior risco do módulo.
  Mitigado (v2) pelo ledger money-safe: items `pending` congelados, push dirigido por `pending`,
  marca `applied`/`failed` por chunk, `BasePipelineConsumer` roteia duplicata pro DLQ. Isso
  fecha os 3 buracos de dupla-escrita da v1.
- **Regra presa em `RUNNING`** se o run morre → após o lock de idade, o endpoint adquire o
  advisory e reenfileira o **mesmo report congelado**; não reseta no boot nem recomputa.
- **Migration de realinhamento** segura só porque as tabelas de report nunca tiveram writer
  (confirmado); tenant migrations podem atrasar um deploy (MEMORY) — sem perda de dado.

## 10. Sequência de PRs

1. **PR A (3.1 + 3.2 + 3.3)**: migration (status na regra + reports realinhados com ledger) +
   `POST /execute` money-safe + os 3 GETs. Entrega os endpoints de relatório + o que os
   alimenta, ponta-a-ponta.
2. **PR B (3.4)**: agendamento por `scheduled_days` (timezone-aware).

## 11. Checklist

- [x] Migration: `status`/owner na `offer_book_rule` + realinhar `offer_book_rule_execution_report(_item)`
      com o ledger (`apply_status`/`apply_error`, `idempotency_key`) + enums.
- [x] `computeForRule` (compute não-paginado reusando o motor).
- [x] `POST /:id/execute`: compute → materializa items congelados → `rule.status=RUNNING` →
      enfileira via outbox (com `pipelineRunId`+`step`).
- [x] Consumer herdando `BasePipelineConsumer`; push em lote (`a7.upsertOffer` N/chunk,
      credencial 1×, mirror bulk); marca `applied`/`failed`; nunca re-lança; finaliza
      `outcome`+`rule.status` (D6).
- [x] Wiring: prover motor no worker; consumer no `CONSUMERS`; `PipelineStep`/queue override;
      channel dedicado prefetch 1.
- [x] Recuperação por lock de idade retomando o mesmo ledger (não reset no boot).
- [x] Os 3 GETs (ordem de rota literal antes de `:id`; nomes de param D7).
- [x] Unit + e2e (incl. falha parcial e redelivery sem re-push) verdes; lint + build limpos.
- [x] (PR B) cron timezone-aware lendo `scheduled_days` (jsonb `@>`): `OfferBookRuleScheduleCron`
      (hora a hora, janela 07–21 local, dedup por report SCHEDULED do dia civil America/Sao_Paulo,
      reusa `execute(SCHEDULED)` money-safe).
