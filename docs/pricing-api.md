# Pricing API — Referência

> Gerado de `docs/pricing-api.openapi.json` (OpenAPI 3.1.0) por `scripts/gen-pricing-api-md.cjs`. **Fonte de verdade é o JSON** (importável no Swagger UI / Postman); este arquivo é a versão legível.

## Convenções

- API REST do módulo de precificação (multi-tenant por JWT).
- Sem prefixo global; o tenant vem do token (não há `:tenant` na URL nem header de tenant).
- Todas as rotas exigem JWT salvo as marcadas como públicas.
- RBAC por `x-roles` (admin/operator/viewer): role insuficiente → 403.
- ValidationPipe global (whitelist + forbidNonWhitelisted) → 400 para body/query inválido ou campo extra.
- `:id` é UUID (ParseUUIDPipe → 400 se malformado).

**Auth:** `Authorization: Bearer <accessToken>` (JWT). `x-roles` indica os papéis exigidos; sem JWT → 401, role insuficiente → 403.

## Operações

| Método | Path | Roles | Resumo |
|---|---|---|---|
| POST | `/auth/login` | público | Login (público) |
| POST | `/auth/refresh` | público | Renova tokens (público) |
| POST | `/auth/logout` | autenticado | Logout |
| GET | `/auth/me` | autenticado | Identidade do token |
| GET | `/pricing/suggestion-rules` | operator/admin | Lista regras |
| POST | `/pricing/suggestion-rules` | operator/admin | Cria regra (auditado) |
| PATCH | `/pricing/suggestion-rules/{id}` | operator/admin | Atualiza regra (auditado) |
| DELETE | `/pricing/suggestion-rules/{id}` | operator/admin | Remove regra (soft-delete, auditado) |
| GET | `/pricing/clusters` | operator/admin | Lista clusters |
| POST | `/pricing/clusters` | operator/admin | Cria cluster (auditado) |
| GET | `/pricing/clusters/{id}` | operator/admin | Detalhe do cluster (com eans) |
| PATCH | `/pricing/clusters/{id}` | operator/admin | Atualiza cluster (rename e/ou substitui eans; auditado) |
| DELETE | `/pricing/clusters/{id}` | operator/admin | Remove cluster (soft-delete, auditado) |
| GET | `/pricing/competitor-origins` | operator/admin | Origens de concorrente do tenant (para o seletor da regra) |
| GET | `/pricing/suggestions` | operator/admin | Gera sugestões (full-scan; Cache-Control private 30s) |
| POST | `/pricing/suggestions/preview` | operator/admin | Dry-run: calcula a base com UMA regra transitória (não persiste) |
| GET | `/pricing/apply` | operator/admin | Histórico de runs (não-deletados, recentes primeiro) |
| POST | `/pricing/apply` | operator/admin | Aplica preços em massa (assíncrono; enfileira dispatch ao ERP) |
| POST | `/pricing/apply/preview` | operator/admin | Dry-run do apply: revalida os itens sem persistir |
| GET | `/pricing/apply/{id}` | operator/admin | Relatório do run (polling enquanto pending/running) |
| POST | `/pricing/apply/{id}/rollback` | operator/admin | Reaplica o preço anterior dos itens aplicados (auditado, idempotente) |
| POST | `/pricing/apply/{id}/approve` | admin | Aprova run pendente e despacha (admin, auditado) |
| POST | `/pricing/apply/{id}/reject` | admin | Rejeita run pendente; itens viram failed (admin, auditado) |
| GET | `/pricing/schedules` | operator/admin | Lista agendamentos |
| POST | `/pricing/schedules` | operator/admin | Cria agendamento (one-shot, recorrente via cronExpr, recalc; auditado) |
| GET | `/pricing/schedules/{id}` | operator/admin | Detalhe do agendamento |
| DELETE | `/pricing/schedules/{id}` | operator/admin | Cancela agendamento pendente (auditado) |
| GET | `/pricing/audit` | admin | Trilha de auditoria (admin) |

## Endpoints

### auth — Login / sessão

#### `POST /auth/login`

- **Roles:** público
- **Resumo:** Login (público)
- **Body:** [LoginDto](#tipo-logindto)
- **Respostas:**
  - `200` — OK → [LoginResponse](#tipo-loginresponse)
  - `400` — Body inválido → [Error](#tipo-error)
  - `401` — Credenciais inválidas → [Error](#tipo-error)

#### `POST /auth/refresh`

- **Roles:** público
- **Resumo:** Renova tokens (público)
- **Body:** [RefreshDto](#tipo-refreshdto)
- **Respostas:**
  - `200` — OK → [LoginResponse](#tipo-loginresponse)
  - `400` — Body inválido → [Error](#tipo-error)
  - `401` — Refresh token inválido/expirado → [Error](#tipo-error)

#### `POST /auth/logout`

- **Roles:** autenticado
- **Resumo:** Logout
- **Respostas:**
  - `204` — Sem conteúdo
  - `401` — Sem JWT → [Error](#tipo-error)

#### `GET /auth/me`

- **Roles:** autenticado
- **Resumo:** Identidade do token
- **Respostas:**
  - `200` — OK → [JwtPayload](#tipo-jwtpayload)
  - `401` — Sem JWT → [Error](#tipo-error)

### suggestion-rules — CRUD de regras de sugestão (operator/admin)

#### `GET /pricing/suggestion-rules`

- **Roles:** operator/admin
- **Resumo:** Lista regras
- **Respostas:**
  - `200` — OK → [SuggestionRuleApi](#tipo-suggestionruleapi)[]
  - `401` — Sem JWT → [Error](#tipo-error)
  - `403` — Role insuficiente → [Error](#tipo-error)

#### `POST /pricing/suggestion-rules`

- **Roles:** operator/admin
- **Resumo:** Cria regra (auditado)
- **Body:** [UpsertSuggestionRuleDto](#tipo-upsertsuggestionruledto)
- **Respostas:**
  - `201` — Criada → [SuggestionRuleApi](#tipo-suggestionruleapi)
  - `400` — Validação (XOR classe/cluster, concorrente duplicado/inválido, peso, etc.) → [Error](#tipo-error)
  - `403` — Role insuficiente → [Error](#tipo-error)

#### `PATCH /pricing/suggestion-rules/{id}`

- **Roles:** operator/admin
- **Resumo:** Atualiza regra (auditado)
- **Body:** [UpsertSuggestionRuleDto](#tipo-upsertsuggestionruledto)
- **Respostas:**
  - `200` — OK → [SuggestionRuleApi](#tipo-suggestionruleapi)
  - `400` — Validação → [Error](#tipo-error)
  - `404` — Regra não encontrada → [Error](#tipo-error)

#### `DELETE /pricing/suggestion-rules/{id}`

- **Roles:** operator/admin
- **Resumo:** Remove regra (soft-delete, auditado)
- **Respostas:**
  - `200` — OK → object
  - `404` — Regra não encontrada → [Error](#tipo-error)

### clusters — CRUD de clusters de produto (operator/admin)

#### `GET /pricing/clusters`

- **Roles:** operator/admin
- **Resumo:** Lista clusters
- **Respostas:**
  - `200` — OK → [ClusterApi](#tipo-clusterapi)[]
  - `403` — Role insuficiente → [Error](#tipo-error)

#### `POST /pricing/clusters`

- **Roles:** operator/admin
- **Resumo:** Cria cluster (auditado)
- **Body:** [UpsertClusterDto](#tipo-upsertclusterdto)
- **Respostas:**
  - `201` — Criado → [ClusterDetail](#tipo-clusterdetail)
  - `400` — >5000 EANs ou body inválido → [Error](#tipo-error)

#### `GET /pricing/clusters/{id}`

- **Roles:** operator/admin
- **Resumo:** Detalhe do cluster (com eans)
- **Respostas:**
  - `200` — OK → [ClusterDetail](#tipo-clusterdetail)
  - `404` — Cluster não encontrado → [Error](#tipo-error)

#### `PATCH /pricing/clusters/{id}`

- **Roles:** operator/admin
- **Resumo:** Atualiza cluster (rename e/ou substitui eans; auditado)
- **Body:** [UpsertClusterDto](#tipo-upsertclusterdto)
- **Respostas:**
  - `200` — OK → [ClusterDetail](#tipo-clusterdetail)
  - `400` — Validação → [Error](#tipo-error)
  - `404` — Cluster não encontrado → [Error](#tipo-error)

#### `DELETE /pricing/clusters/{id}`

- **Roles:** operator/admin
- **Resumo:** Remove cluster (soft-delete, auditado)
- **Respostas:**
  - `200` — OK → object
  - `404` — Cluster não encontrado → [Error](#tipo-error)
  - `409` — Cluster em uso por regra ativa → [Error](#tipo-error)

### competitor-origins — Origens de concorrente habilitadas do tenant (leitura)

#### `GET /pricing/competitor-origins`

- **Roles:** operator/admin
- **Resumo:** Origens de concorrente do tenant (para o seletor da regra)
- **Respostas:**
  - `200` — OK → [CompetitorOriginView](#tipo-competitororiginview)[]
  - `403` — Role insuficiente → [Error](#tipo-error)

### suggestions — Motor de sugestão + dry-run (operator/admin)

#### `GET /pricing/suggestions`

- **Roles:** operator/admin
- **Resumo:** Gera sugestões (full-scan; Cache-Control private 30s)
- **Query:**
  - `page`: integer
  - `perPage`: integer
  - `name`: string — Filtro por nome (ILIKE)
  - `classification`: string
  - `books`: string — CSV de cadernos: "Caderno A,Caderno B"
  - `onlyWithSuggestion`: `true`
  - `direction`: `todas` \| `subir` \| `abaixar`
  - `origem`: `todas` \| `cluster` \| `classificacao`
- **Respostas:**
  - `200` — OK → [SuggestionsResponse](#tipo-suggestionsresponse)
  - `403` — Role insuficiente → [Error](#tipo-error)

#### `POST /pricing/suggestions/preview`

- **Roles:** operator/admin
- **Resumo:** Dry-run: calcula a base com UMA regra transitória (não persiste)
- **Query:**
  - `page`: integer
  - `perPage`: integer
  - `onlyWithSuggestion`: `true`
- **Body:** [UpsertSuggestionRuleDto](#tipo-upsertsuggestionruledto)
- **Respostas:**
  - `200` — OK → [SuggestionsResponse](#tipo-suggestionsresponse)
  - `400` — Regra inválida (mesma validação do create) → [Error](#tipo-error)

### apply — Aplicação de preço em massa, histórico, rollback, aprovação

#### `GET /pricing/apply`

- **Roles:** operator/admin
- **Resumo:** Histórico de runs (não-deletados, recentes primeiro)
- **Query:**
  - `page`: integer
  - `perPage`: integer
- **Respostas:**
  - `200` — OK → [ApplyRunSummary](#tipo-applyrunsummary)[]

#### `POST /pricing/apply`

- **Roles:** operator/admin
- **Resumo:** Aplica preços em massa (assíncrono; enfileira dispatch ao ERP)
- **Detalhe:** Idempotente por `idempotencyKey` (reenvio → `idempotent:true`). Circuit breaker: lote ≥10 com >50% rejeitado → 422. Se `PRICING_APPLY_REQUIRES_APPROVAL=1`, retorna `approvalStatus:"pending"` e NÃO despacha até `/approve`.
- **Body:** [ApplyPricesDto](#tipo-applypricesdto)
- **Respostas:**
  - `202` — Run criado (ou idempotente) → [ApplyResponse](#tipo-applyresponse)
  - `400` — Body inválido → [Error](#tipo-error)
  - `403` — Role insuficiente → [Error](#tipo-error)
  - `422` — Lote abortado pelo circuit breaker → [CircuitBreakerError](#tipo-circuitbreakererror)

#### `POST /pricing/apply/preview`

- **Roles:** operator/admin
- **Resumo:** Dry-run do apply: revalida os itens sem persistir
- **Body:** [PreviewApplyDto](#tipo-previewapplydto)
- **Respostas:**
  - `200` — OK → [ApplyPreview](#tipo-applypreview)
  - `400` — Body inválido → [Error](#tipo-error)

#### `GET /pricing/apply/{id}`

- **Roles:** operator/admin
- **Resumo:** Relatório do run (polling enquanto pending/running)
- **Query:**
  - `page`: integer
  - `perPage`: integer
- **Respostas:**
  - `200` — OK → [ApplyReport](#tipo-applyreport)
  - `404` — Run não encontrado → [Error](#tipo-error)

#### `POST /pricing/apply/{id}/rollback`

- **Roles:** operator/admin
- **Resumo:** Reaplica o preço anterior dos itens aplicados (auditado, idempotente)
- **Respostas:**
  - `202` — Run de rollback criado → [ApplyResponse](#tipo-applyresponse)
  - `404` — Run não encontrado → [Error](#tipo-error)
  - `422` — Run sem item aplicado reversível → [Error](#tipo-error)

#### `POST /pricing/apply/{id}/approve`

- **Roles:** admin
- **Resumo:** Aprova run pendente e despacha (admin, auditado)
- **Respostas:**
  - `202` — OK → object
  - `403` — Não-admin → [Error](#tipo-error)
  - `404` — Run não encontrado → [Error](#tipo-error)
  - `409` — Run não está aguardando aprovação → [Error](#tipo-error)

#### `POST /pricing/apply/{id}/reject`

- **Roles:** admin
- **Resumo:** Rejeita run pendente; itens viram failed (admin, auditado)
- **Respostas:**
  - `200` — OK → object
  - `403` — Não-admin → [Error](#tipo-error)
  - `404` — Run não encontrado → [Error](#tipo-error)
  - `409` — Run não está aguardando aprovação → [Error](#tipo-error)

### schedules — Agendamentos (one-shot, recorrente, recálculo)

#### `GET /pricing/schedules`

- **Roles:** operator/admin
- **Resumo:** Lista agendamentos
- **Respostas:**
  - `200` — OK → [ScheduleView](#tipo-scheduleview)[]
  - `403` — Role insuficiente → [Error](#tipo-error)

#### `POST /pricing/schedules`

- **Roles:** operator/admin
- **Resumo:** Cria agendamento (one-shot, recorrente via cronExpr, recalc; auditado)
- **Body:** [CreateScheduleDto](#tipo-createscheduledto)
- **Respostas:**
  - `201` — Criado → [ScheduleView](#tipo-scheduleview)
  - `400` — Body inválido ou cron inválido → [Error](#tipo-error)

#### `GET /pricing/schedules/{id}`

- **Roles:** operator/admin
- **Resumo:** Detalhe do agendamento
- **Respostas:**
  - `200` — OK → [ScheduleView](#tipo-scheduleview)
  - `404` — Agendamento não encontrado → [Error](#tipo-error)

#### `DELETE /pricing/schedules/{id}`

- **Roles:** operator/admin
- **Resumo:** Cancela agendamento pendente (auditado)
- **Respostas:**
  - `200` — OK → object
  - `404` — Não encontrado → [Error](#tipo-error)
  - `409` — Já disparado (fired) — não cancelável → [Error](#tipo-error)

### audit — Trilha de auditoria (admin)

#### `GET /pricing/audit`

- **Roles:** admin
- **Resumo:** Trilha de auditoria (admin)
- **Query:**
  - `entity`: `suggestion_rule` \| `cluster` \| `apply_run` \| `schedule`
  - `entityId`: string
  - `page`: integer
  - `perPage`: integer
- **Respostas:**
  - `200` — OK → [AuditView](#tipo-auditview)[]
  - `403` — Não-admin → [Error](#tipo-error)

## Tipos

### Tipo: Error

> Envelope de erro padrão do NestJS

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `statusCode` | integer |  |  |
| `message` | string \| string[] |  |  |
| `error` | string |  |  |

### Tipo: CircuitBreakerError

> 422 do circuit breaker (apply)

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `message` | string |  |  |
| `aborted` | `"true"` |  |  |
| `rejected` | [ApplyRejection](#tipo-applyrejection)[] |  |  |

### Tipo: LoginDto

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `email` | string (email) | ✓ |  |
| `password` | string | ✓ | len 1..256 |
| `tenantSlug` | string | ✓ | regex `^[a-z][a-z0-9-]{2,31}$` |

### Tipo: RefreshDto

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `refreshToken` | string | ✓ |  |

### Tipo: LoginResponse

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `accessToken` | string | ✓ |  |
| `refreshToken` | string | ✓ |  |
| `expiresIn` | integer | ✓ | segundos |

### Tipo: JwtPayload

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `sub` | string (uuid) | ✓ |  |
| `tenantId` | string | ✓ | slug do tenant |
| `role` | [UserRole](#tipo-userrole) | ✓ |  |
| `iat` | integer |  |  |
| `exp` | integer |  |  |

### Tipo: UserRole

Enum: `admin`, `operator`, `viewer`.

### Tipo: CompetitorOrigin

Enum: `DROGAL`, `DROGASIL`, `PAGUE_MENOS`, `IKESAKI`, `MICHELASSI`, `PACHECO`, `SAO_PAULO`, `VENANCIO`, `INDIANA`.

### Tipo: CompetitorOriginView

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `origin` | [CompetitorOrigin](#tipo-competitororigin) | ✓ |  |
| `priority` | integer | ✓ | menor = antes (cascade por prioridade) |
| `enabled` | boolean | ✓ |  |

### Tipo: SuggestionStrategy

Enum: `margem`, `concorrencia`.

### Tipo: CompetitorMode

Enum: `weighted`, `cascade`, `lowest`.

### Tipo: SuggestionTarget

Enum: `precoVenda`, `precoOferta`.

### Tipo: SuggestionBasis

Enum: `concorrencia`, `margem_minima`, `margem_sem_concorrente`.

### Tipo: NoSuggestionReason

Enum: `sem_regra`, `sem_custo`, `margem_ok`, `sem_concorrente`, `pbm`, `acima_do_venda`, `ja_no_alvo`.

### Tipo: ApplyRejectionReason

Enum: `nao_encontrado`, `sem_custo`, `preco_invalido`, `abaixo_do_piso`, `variacao_excessiva`, `acima_do_venda`, `sem_caderno`.

### Tipo: ApplyItemStatus

Enum: `pending`, `applied`, `skipped`, `failed`.

### Tipo: RunStatus

Enum: `pending`, `running`, `done`, `failed`.

### Tipo: ApprovalStatus

Enum: `pending`, `approved`, `rejected` (nullable).

### Tipo: ScheduleStatus

Enum: `pending`, `fired`, `cancelled`.

### Tipo: RuleCompetitor

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `competitor` | [CompetitorOrigin](#tipo-competitororigin) | ✓ |  |
| `weight` | number | ✓ | % em weighted; 1 em cascade/lowest |

### Tipo: RuleCompetitorInput

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `competitor` | [CompetitorOrigin](#tipo-competitororigin) | ✓ |  |
| `weight` | number |  | 0..100; obrigatório/efetivo só em weighted |

### Tipo: SuggestionRuleApi

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `id` | string (uuid) | ✓ |  |
| `name` | string | ✓ |  |
| `classifications` | string[] | ✓ |  |
| `clusterId` | string (uuid) \| null | ✓ | nullable |
| `clusterName` | string \| null | ✓ | nullable |
| `excludeClusterIds` | string (uuid)[] | ✓ |  |
| `strategy` | [SuggestionStrategy](#tipo-suggestionstrategy) | ✓ |  |
| `minMargin` | number | ✓ |  |
| `competitorMode` | [CompetitorMode](#tipo-competitormode) | ✓ |  |
| `competitors` | [RuleCompetitor](#tipo-rulecompetitor)[] | ✓ |  |
| `variationPct` | number | ✓ |  |
| `noCompetitorMargin` | number \| null | ✓ | nullable |
| `priceControlled` | boolean | ✓ |  |
| `ignorePbm` | boolean | ✓ |  |
| `blockPbmInMargin` | boolean | ✓ | Bloqueia PBM também na estratégia margem (default false) |
| `cascadeByPriority` | boolean | ✓ | Cascade segue a priority do tenant (default false) |
| `applyRounding` | boolean | ✓ |  |
| `active` | boolean | ✓ |  |
| `createdAt` | string (date-time) | ✓ |  |
| `updatedAt` | string (date-time) | ✓ |  |

### Tipo: UpsertSuggestionRuleDto

> Validações cruzadas no service: classificações XOR cluster; concorrência exige ≥1 concorrente; concorrente duplicado → 400.

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `name` | string | ✓ | len 1..120 |
| `classifications` | string[] |  | itens 0..200 |
| `clusterId` | string (uuid) \| null |  | nullable |
| `excludeClusterIds` | string (uuid)[] |  | itens 0..100 |
| `strategy` | [SuggestionStrategy](#tipo-suggestionstrategy) |  |  |
| `minMargin` | number | ✓ | 0..95 |
| `competitorMode` | [CompetitorMode](#tipo-competitormode) |  |  |
| `competitors` | [RuleCompetitorInput](#tipo-rulecompetitorinput)[] |  |  |
| `variationPct` | number |  | -90..90 |
| `noCompetitorMargin` | number \| null |  | 0..95; nullable |
| `priceControlled` | boolean |  |  |
| `ignorePbm` | boolean |  |  |
| `blockPbmInMargin` | boolean |  |  |
| `cascadeByPriority` | boolean |  |  |
| `applyRounding` | boolean |  |  |
| `active` | boolean |  |  |

### Tipo: ClusterApi

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `id` | string (uuid) | ✓ |  |
| `name` | string | ✓ |  |
| `memberCount` | integer | ✓ |  |
| `createdAt` | string (date-time) | ✓ |  |
| `updatedAt` | string (date-time) | ✓ |  |

### Tipo: ClusterDetail

Composto (`allOf`): [ClusterApi](#tipo-clusterapi) & object.

### Tipo: UpsertClusterDto

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `name` | string | ✓ | len 1..120 |
| `eans` | string[] |  | Ausente = só renomeia; presente = substitui a membership (dedup, regex ^\d{6,14}$, máx 5000) |

### Tipo: CompetitorView

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `origin` | [CompetitorOrigin](#tipo-competitororigin) | ✓ |  |
| `price` | number \| null |  | nullable |
| `isPbm` | boolean | ✓ |  |
| `van` | string \| null |  | nullable |

### Tipo: ResponseProduct

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `ean` | string | ✓ |  |
| `name` | string | ✓ |  |
| `supplier` | string \| null |  | nullable |
| `classification` | string \| null |  | nullable |
| `book` | string \| null |  | nullable |
| `cost` | number \| null |  | nullable |
| `priceForSell` | number \| null |  | nullable |
| `priceForOffer` | number \| null |  | nullable |
| `margin` | number \| null |  | nullable |
| `averageVariation` | number \| null |  | nullable |
| `status` | string \| null |  | nullable |
| `competitors` | [CompetitorView](#tipo-competitorview)[] | ✓ |  |

### Tipo: PriceSuggestion

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `price` | number | ✓ |  |
| `margin` | number | ✓ |  |
| `target` | [SuggestionTarget](#tipo-suggestiontarget) | ✓ |  |
| `basis` | [SuggestionBasis](#tipo-suggestionbasis) | ✓ |  |
| `lockApplied` | boolean | ✓ |  |
| `priceComposition` | object[] |  | nullable |

### Tipo: SuggestionResult

União (`oneOf`) discriminada por `kind`:
- object — { kind, suggestion }
- object — { kind, reason }

### Tipo: ClusterOrigin

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `clusterId` | string (uuid) | ✓ |  |
| `clusterName` | string \| null |  | nullable |
| `overrodeRuleName` | string \| null |  | nullable |

### Tipo: ResponseRow

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `product` | [ResponseProduct](#tipo-responseproduct) | ✓ |  |
| `result` | [SuggestionResult](#tipo-suggestionresult) | ✓ |  |
| `origem` | [ClusterOrigin](#tipo-clusterorigin) \| null | ✓ |  |

### Tipo: SuggestionsResponse

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `rows` | [ResponseRow](#tipo-responserow)[] | ✓ |  |
| `count` | integer | ✓ |  |
| `suggestionCount` | integer | ✓ |  |
| `lockCount` | integer | ✓ |  |
| `activeRuleCount` | integer | ✓ |  |
| `availableBooks` | object[] | ✓ |  |

### Tipo: ApplyItem

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `ean` | string | ✓ |  |
| `target` | [SuggestionTarget](#tipo-suggestiontarget) | ✓ |  |
| `price` | number | ✓ | 0..∞ |
| `cadernoId` | integer |  | 1..∞; caderno do precoOferta; derivado do offer_book se ausente |

### Tipo: ApplyPricesDto

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `idempotencyKey` | string | ✓ | len 1..200 |
| `mode` | `agora` |  |  |
| `items` | [ApplyItem](#tipo-applyitem)[] | ✓ | itens 1..5000 |

### Tipo: PreviewApplyDto

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `items` | [ApplyItem](#tipo-applyitem)[] | ✓ | itens 1..5000 |

### Tipo: ApplyRejection

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `ean` | string | ✓ |  |
| `reason` | [ApplyRejectionReason](#tipo-applyrejectionreason) | ✓ |  |

### Tipo: ApplyResponse

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `applyRunId` | string (uuid) | ✓ |  |
| `accepted` | integer | ✓ |  |
| `rejected` | [ApplyRejection](#tipo-applyrejection)[] | ✓ |  |
| `idempotent` | boolean |  | true quando o run já existia (mesma idempotencyKey) |
| `approvalStatus` | `pending` |  | presente quando aprovação é exigida (não despachou) |

### Tipo: ApplyPreview

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `total` | integer | ✓ |  |
| `accepted` | object[] | ✓ |  |
| `rejected` | [ApplyRejection](#tipo-applyrejection)[] | ✓ |  |
| `wouldAbort` | boolean | ✓ | true se o circuit breaker barraria o lote real |

### Tipo: ApplyRunSummary

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `id` | string (uuid) | ✓ |  |
| `status` | [RunStatus](#tipo-runstatus) | ✓ |  |
| `mode` | string | ✓ |  |
| `approvalStatus` | [ApprovalStatus](#tipo-approvalstatus) | ✓ |  |
| `total` | integer | ✓ |  |
| `applied` | integer | ✓ |  |
| `skipped` | integer | ✓ |  |
| `failed` | integer | ✓ |  |
| `createdAt` | string (date-time) | ✓ |  |

### Tipo: ApplyReportItem

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `ean` | string |  |  |
| `target` | [SuggestionTarget](#tipo-suggestiontarget) |  |  |
| `price` | number |  |  |
| `status` | [ApplyItemStatus](#tipo-applyitemstatus) |  |  |
| `reason` | string \| null |  | nullable; rejeição/skip: monitored, em_campanha, a7_nao_configurado, rejeitado, etc. |
| `basis` | string \| null |  | nullable |
| `priceOld` | number \| null |  | nullable |
| `cadernoId` | integer \| null |  | nullable |
| `ruleId` | string (uuid) \| null |  | nullable |
| `erpResult` | object \| null |  | nullable |
| `appliedAt` | string (date-time) \| null |  | nullable |

### Tipo: ApplyReport

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `id` | string (uuid) | ✓ |  |
| `status` | [RunStatus](#tipo-runstatus) | ✓ |  |
| `mode` | string | ✓ |  |
| `approvalStatus` | [ApprovalStatus](#tipo-approvalstatus) | ✓ |  |
| `total` | integer | ✓ |  |
| `applied` | integer | ✓ |  |
| `skipped` | integer | ✓ |  |
| `failed` | integer | ✓ |  |
| `items` | [ApplyReportItem](#tipo-applyreportitem)[] | ✓ | paginado por page/perPage |

### Tipo: CreateScheduleDto

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `runAt` | string (date-time) | ✓ |  |
| `items` | [ApplyItem](#tipo-applyitem)[] | ✓ | itens 1..5000 |
| `cronExpr` | string |  | len 9..100; Recorrência (validado no backend). Granularidade efetiva: por minuto. |
| `recalc` | boolean |  | Recalcula o preço pelo motor no disparo, usando o alvo escolhido pelo motor (default false = congelado) |

### Tipo: ScheduleView

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `id` | string (uuid) | ✓ |  |
| `runAt` | string (date-time) | ✓ |  |
| `status` | [ScheduleStatus](#tipo-schedulestatus) | ✓ |  |
| `applyRunId` | string (uuid) \| null | ✓ | nullable |
| `itemCount` | integer | ✓ |  |
| `cronExpr` | string \| null | ✓ | nullable |
| `recalc` | boolean | ✓ |  |
| `createdAt` | string (date-time) | ✓ |  |

### Tipo: AuditView

| Campo | Tipo | Obrig. | Notas |
|---|---|:--:|---|
| `actor` | string (uuid) \| null | ✓ | nullable; user.sub que executou |
| `action` | string | ✓ | create|update|delete|apply|apply_pending|approve|reject|rollback|schedule_create|schedule_cancel |
| `entity` | string | ✓ | suggestion_rule|cluster|apply_run|schedule |
| `entityId` | string \| null | ✓ | nullable |
| `changes` | object | ✓ | payload/resultado da ação (jsonb) |
| `createdAt` | string (date-time) | ✓ |  |

