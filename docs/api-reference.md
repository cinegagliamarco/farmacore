# Farmacore API — Referência completa de endpoints

Guia de todos os 94 endpoints HTTP da API, escrito para quem nunca viu o sistema.
Fonte da verdade: os controllers em `src/` (cada seção aponta o arquivo). Para
testar na prática, importe `postman/farmacore.postman_collection.json` — toda
rota daqui existe lá com exemplo pronto.

---

## 1. Comece aqui

### O que é a API

O Farmacore é um SaaS **multi-tenant** de precificação para farmácias. Cada
farmácia (tenant) tem seu próprio schema no Postgres e conecta seu ERP
(A7Pharma) ao sistema. A API tem duas grandes metades:

- **`/admin/*`** — operação da plataforma (criar tenants, configurar
  integrações, rodar pipeline, inspecionar filas). Só o **system admin** acessa.
- **Todo o resto** — a API que o frontend de cada farmácia consome (catálogo,
  preços, sugestões, configurações). O escopo do tenant vem do JWT: você nunca
  passa o tenant na URL, o token já diz quem você é.

### Login em 30 segundos

```bash
# 1. Autentique (rota pública)
curl -X POST {{baseUrl}}/auth/login \
  -H 'Content-Type: application/json' \
  -d '{ "email": "<admin-email>", "password": "...", "tenantSlug": "minhafarmacia" }'
# → { "accessToken": "...", "refreshToken": "...", "expiresIn": 3600 }

# 2. Use o accessToken em TODAS as outras chamadas
curl {{baseUrl}}/products -H 'Authorization: Bearer <accessToken>'
```

O `accessToken` vale **1 hora**; o `refreshToken` vale **14 dias** e é
rotacionado a cada uso (ver `POST /auth/refresh`). Existe um guard JWT global:
**toda rota exige `Authorization: Bearer <token>`**, exceto as marcadas como
públicas (`/health`, `/auth/login`, `/auth/refresh`).

### Papéis (roles)

O JWT carrega `role`. Três papéis dentro de um tenant, mais o system admin:

| Papel | O que pode |
| --- | --- |
| `viewer` | Só as leituras abertas do tenant: grids de produto, cadernos, classificações, configurações, origens de concorrentes. Toda a área de pricing (apply, agendamentos, sugestões, regras, clusters, auditoria), lojas e regras de caderno é operator+ ou admin. |
| `operator` | Leituras + escritas operacionais: editar produto, trocar preço/oferta, aplicar e agendar preços, regras e clusters de sugestão. |
| `admin` (do tenant) | Tudo do operator + aprovar/rejeitar aplicações, configurações, lojas, auditoria, saúde da integração. |
| **system admin** | Token do tenant especial `system` com role `admin`. Único que acessa `/admin/*`. Não confundir com o admin do tenant. |

Cada endpoint abaixo diz **Quem pode**. Chamar sem o papel certo dá `403`.

### Módulos

Além do papel, o tenant precisa ter o **módulo** da feature habilitado
(`PUT /admin/tenants/:slug/modules`; o FE lê a lista em `GET /auth/me`).
Rota de módulo desligado responde `403`.

| Módulo | Libera |
| --- | --- |
| `crossed-products` | Grid cruzado com concorrentes (`/products/crossed`, `/products/export`) e escritas de preço/oferta. |
| `active-ingredient-analysis` | Análise por princípio ativo (`/products/active-ingredients*`) e escritas de preço/oferta. |
| `pricing-rules` | Aplicação em massa, agendamentos, sugestões, regras, clusters, auditoria e arredondamento. |
| `offer-book-rules` | Regras de caderno de oferta (preview, CRUD, execução assíncrona e relatórios, seção 15) e arredondamento. |
| `strategic-pricing` | Grid de preço estratégico (`/products/strategic-price`) e escritas de preço/oferta. |

As escritas de preço/oferta (`POST /products/:ean/price`, `POST/DELETE
/products/:ean/offer`) exigem **qualquer um** de crossed-products,
active-ingredient-analysis ou strategic-pricing.

### Lojas: dois identificadores (pegadinha nº 1)

Uma loja (`core.tenant_store`) tem **dois ids** e cada um aparece num lugar:

- **`storeId` (uuid)** — vai em **bodies**: `POST /products/:ean/price`,
  `items[].storeId` do apply/schedule, `storeIds[]` das regras de sugestão,
  `PUT /stores/:id`.
- **`store` (id externo numérico do ERP)** — vai em **query params** de
  leitura: `?store=3` nos grids de produto e nas sugestões.

`GET /products/stores` retorna os dois lado a lado (`storeId`,
`storeExternalId`) — comece por ele. Leituras com `?store=` projetam o
preço/custo daquela loja sobre os valores globais; sem o param, visão global.

### Convenções

- **Paginação**: listas grandes retornam `{ rows, count, page, perPage }`.
  Defaults `page=1`, `perPage=50` — exceto as leituras de `/pricing/apply`,
  onde `perPage` default é 100 (caps variam por rota; indicados abaixo).
- **EAN é string** de dígitos (até 14): `"<ean>"`, nunca número.
- **Datas** em ISO 8601 UTC: `"2026-07-15T03:00:00.000Z"`.
- **Erros**: `400` validação, `401` sem/token inválido, `403` papel ou módulo
  insuficiente, `404` não existe (ou não é seu), `409` conflito de estado,
  `422` lote abortado, `502` o ERP falhou na escrita.
- **POST** responde `201` por padrão (Nest); exceções anotadas (`200`/`202`/`204`).

### Mapa da API

| Área | Prefixo | Quem usa | Seção |
| --- | --- | --- | --- |
| Health | `/health` | infra | 2 |
| Auth | `/auth` | todos | 3 |
| Tenants | `/admin/tenants` | system admin | 4 |
| Integração ERP (admin) | `/admin/tenants/:slug/integration`, `/admin/integrations` | system admin | 5 |
| Concorrentes por tenant | `/admin/tenants/:slug/competitor-origins` | system admin | 6 |
| Pipeline | `/admin/tenants/:slug/pipeline` | system admin | 7 |
| DLQ | `/admin/dlq` | system admin | 8 |
| Catálogo global | `/admin/catalog` | system admin | 9 |
| Catálogo do tenant | `/products` | tenant | 10 |
| Cadernos de oferta | `/offer-campaigns` | tenant | 11 |
| Lojas e clusters de loja | `/stores`, `/store-clusters` | tenant admin | 12 |
| Configurações | `/settings`, `/classifications`, `/configurations` | tenant | 13 |
| Integração (visão do tenant) | `/integration` | tenant admin | 14 |
| Regras de caderno | `/offer-book-rules` | tenant | 15 |
| Aplicação e agendamento de preços | `/pricing/apply`, `/pricing/schedules` | tenant | 16 |
| Sugestões, regras e clusters | `/pricing/suggestions`, `/pricing/suggestion-rules`, `/pricing/clusters`, `/pricing/audit`, `/pricing/competitor-origins` | tenant | 17 |

No fim do documento, a seção **18. Receitas** encadeia os endpoints nos fluxos
completos (onboarding, troca de preço, sugestão → aplicação, DLQ).

---

## 2. Health

`src/health/health.controller.ts`

### `GET /health`

Liveness da API, usado pelo healthcheck do Fly e pelo Better Stack. **Público**
(sem token). Gate só no Postgres core — de propósito: um ERP de tenant fora do
ar **não** derruba a API do balanceador (para saúde de integração, ver seções
5 e 14).

Resposta: o shape do Terminus — `{ status, info, error, details }` — com dois
indicadores: `postgres` (ping real, timeout 1,5 s; derruba o check) e
`rabbitmq` (sempre reporta `up` para **não** tirar a API do ar, mas expõe
`connected: boolean` — é nesse campo que o monitoramento alerta).

---

## 3. Auth

`src/auth/auth.controller.ts` — login, refresh, logout e usuário atual.

### `POST /auth/login`

Autentica `email` + `password` **dentro de um tenant** (`tenantSlug`). Rota
pública. Responde `200`.

```json
{ "email": "<admin-email>", "password": "...", "tenantSlug": "minhafarmacia" }
```

Resposta: `{ accessToken, refreshToken, expiresIn: 3600 }`.

- Access token: 1 h. Refresh token: 14 dias.
- System admin loga com `tenantSlug: "system"`.
- O admin inicial de um tenant novo usa a `oneTimePassword` devolvida por
  `POST /admin/tenants`.

Erros: `401 Invalid credentials` para **qualquer** falha — senha errada,
tenant/usuário inexistente, tenant suspenso, usuário inativo. A mensagem é
idêntica e o tempo de resposta constante (verify dummy de argon2) para não
vazar quais e-mails existem. `400` se o DTO falha (slug: kebab-case minúsculo,
3–32 chars, começa com letra).

### `POST /auth/refresh`

Troca um `refreshToken` válido por um **par novo** (rotação). Rota pública.
Responde `200` com o mesmo shape do login.

```json
{ "refreshToken": "<refresh-token-atual>" }
```

Como funciona a rotação (importa para o FE):

- Cada uso **invalida** o token e emite outro — guarde sempre o mais recente.
- Há uma **janela de graça de 60 s**: duas abas que refrescam quase juntas
  ganham ambas um par válido, sem corrida.
- Reusar um token revogado **fora** da graça é tratado como roubo: a família
  inteira de tokens do usuário é revogada (todo mundo desloga).

Erros: `401` para token desconhecido, expirado, reusado fora da graça, usuário
inativo ou tenant suspenso.

### `GET /auth/me`

Identidade do token: `{ sub, tenantId, role, iat, exp, modules }`. `modules` é
a lista de módulos habilitados do tenant — é daqui que o FE decide o que
mostrar. Token do tenant `system` recebe todos os módulos. Qualquer papel.

Erro: `401` também quando o tenant foi offboardado com token ainda válido —
força o FE a derrubar a sessão.

### `POST /auth/logout`

Revoga **todos** os refresh tokens ativos do usuário (com `revokedAt` retroagido
60 s, para não sobrar carona na janela de graça). O access token atual continua
válido até expirar (até 1 h). Qualquer papel. Responde `204` sem body.

---

## 4. Admin — Tenants

`src/admin/controllers/tenants.controller.ts` — ciclo de vida dos tenants.
**Tudo aqui exige system admin.**

### `POST /admin/tenants`

Onboarding completo de uma farmácia em uma chamada:

1. cria a linha em `core.tenant` (status `active`, **todos os módulos ligados**);
2. cria o schema Postgres do tenant e roda as migrations;
3. semeia as origens de concorrentes (todas **desabilitadas** — ligue na seção 6);
4. cria o usuário admin inicial com senha aleatória de uso único.

```json
{ "slug": "farmacia-central", "name": "Farmácia Central Ltda", "adminEmail": "<admin-email>" }
```

Resposta: `{ slug, schemaName, initialAdminUser: { email, oneTimePassword } }`.
A `oneTimePassword` **só aparece aqui** — anote. Se qualquer passo falhar, tudo
é revertido (schema dropado, linha removida).

Erros: `400` slug reservado ou inválido; `409` slug já existe.

### `GET /admin/tenants`

Lista os tenants não deletados (inclusive pausados e suspensos), ordenados por
slug. Soft-deletados **não** aparecem (filtro automático do `deletedAt`).

### `GET /admin/tenants/:slug`

Um tenant pelo slug, qualquer status não deletado. `404` se não existe — ou se
foi soft-deletado (a linha é preservada, mas o filtro de `deletedAt` a esconde).

### `PATCH /admin/tenants/:slug/status`

Muda o status: `active` | `paused` | `suspended`. Body
`{ "status": "paused" }`. Responde `200` sem body. Tenant não-ativo não roda
pipeline e não loga.

### `PUT /admin/tenants/:slug/modules`

**Substitui** o conjunto de módulos do tenant — a lista enviada é a verdade
nova; módulo omitido é desligado. Valores válidos na tabela da seção 1.

```json
{ "modules": ["crossed-products", "pricing-rules"] }
```

Responde `200` sem body. Erros: `400` valor inválido ou duplicado; `404`.

### `DELETE /admin/tenants/:slug`

Soft-delete: seta `status=suspended` e carimba `deletedAt`. Linha e schema são
preservados (o expurgo com dump é follow-up do Plan 06). Responde `200` sem body.

---

## 5. Admin — Integração ERP

`src/admin/controllers/integration.controller.ts` e
`integration-health.controller.ts`. **System admin.** O tenant enxerga a
própria integração pela seção 14.

### `PUT /admin/tenants/:slug/integration`

Cria/atualiza a conexão com o banco do ERP do tenant (uma por tenant).

```json
{
  "origin": "a7pharma",
  "name": "ERP",
  "host": "erp-db.farmaciacentral.com.br",
  "port": 5432,
  "database": "a7pharma_prod",
  "username": "farmacore_ro",
  "password": "...",
  "sslMode": "require",
  "readOnly": true,
  "apiBaseUrl": "https://erp.example:8443",
  "apiKey": "<a7pharma-api-key>"
}
```

- `origin`: v1 só `a7pharma`.
- `sslMode`: `disable` | `require` | `verify-full`; opcional `sslCaCert` (PEM)
  e `connectionOptions` (objeto livre repassado ao driver pg).
- `password` e `apiKey` são criptografados em repouso (AES-256-GCM).
- `apiBaseUrl` + `apiKey` habilitam o **write-back** REST no A7Pharma (trocar
  preço/oferta). Sem eles, as escritas de preço respondem `409`.
- Omitir `apiBaseUrl`/`apiKey` **preserva** os valores já gravados.

Resposta: `{ "status": "active" }`. Invalida o cache de DataSource do tenant.

### `POST /admin/tenants/:slug/integration/test`

Teste real: abre uma conexão descartável e roda `SELECT 1` (timeouts de 5 s,
sem cache). Grava `lastVerifiedAt` ou `lastError` na conexão. Resposta:
`{ ok: true }` ou `{ ok: false, error: "<erro cru do driver>" }` — ping falho
**não** é status de erro HTTP. `404` se o tenant não tem integração.

### `DELETE /admin/tenants/:slug/integration`

Desabilita (soft): `status=disabled`, linha preservada, cache invalidado.
No-op silencioso se não há conexão.

### `GET /admin/integrations/health`

Saúde **da frota**: pinga toda conexão ATIVA de todos os tenants (concorrência
limitada, cache single-flight de TTL curto) e retorna

```json
{ "checkedAt": "…", "total": 12, "healthy": 11, "unhealthy": 1,
  "connections": [{ "tenantSlug": "…", "origin": "a7pharma", "status": "active", "ok": true, "lastVerifiedAt": "…", "error": null }] }
```

Separado de `GET /health` de propósito: ERP de tenant caído não tira a API de
rotação.

---

## 6. Admin — Origens de concorrentes

`src/admin/controllers/competitor-origins.controller.ts` — quais concorrentes
o scraper acompanha para cada tenant (`core.tenant_competitor_origin`).
**System admin.**

Origens existentes: `DROGAL`, `DROGASIL`, `PAGUE_MENOS`, `IKESAKI`,
`MICHELASSI`, `PACHECO`, `SAO_PAULO`, `VENANCIO`, `INDIANA`.

### `GET /admin/tenants/:slug/competitor-origins`

Lista a configuração do tenant: `[{ origin, label, enabled, priority }]`
ordenado por prioridade. `label` é o nome humano do registry.

### `PUT /admin/tenants/:slug/competitor-origins`

Atualização em massa, numa transação:

```json
{ "origins": [
  { "origin": "DROGASIL", "enabled": true, "priority": 10 },
  { "origin": "PAGUE_MENOS", "enabled": false }
] }
```

- `enabled` é obrigatório por item; `priority` (int ≥ 0) e `config` (objeto
  livre, ex.: CEP da loja de referência) só atualizam **quando enviados** —
  omitido/null preserva o valor atual.
- **UPDATE-only**: as linhas nascem no onboarding; origem desconhecida para o
  tenant é ignorada em silêncio, não criada.

Responde `200` vazio. Truque operacional: para escrapear um concorrente só,
habilite apenas ele aqui e dispare o step `import-competitor-products`
(receita na seção 18).

---

## 7. Admin — Pipeline

`src/admin/controllers/pipeline.controller.ts` — o pipeline diário de dados
(sync do ERP, scrape de concorrentes, métricas) disparado à mão. **System
admin.** Acompanhe execuções em `core.pipeline_run`.

### `POST /admin/tenants/:slug/pipeline/start`

Roda o **grafo inteiro** de steps, encadeando sucessores. Publica
`pipeline.start` na fila com `reason='manual'` e o id do chamador. Resposta:
`{ pipelineRunId }`. `404` se o tenant não existe ou não está ativo.

### `GET /admin/tenants/:slug/pipeline/steps`

Steps disparáveis individualmente (resposta estática, o slug não é usado):
`sync-base-product`, `sync-base-product-stock`, `sync-offer-books-info`,
`import-competitor-products`, `calc-base-product-metrics`,
`update-base-product-properties`, `sync-stores`, `sync-product-items`,
`apply-price`.

### `POST /admin/tenants/:slug/pipeline/steps/:step`

Roda **um step isolado** (flag `standalone` suprime os sucessores — nada
encadeia). Novo run por chamada. Resposta: `{ pipelineRunId, step }`. `400` se
`:step` não é um valor da lista acima (a mensagem lista os válidos); `404`
tenant inexistente/inativo.

---

## 8. Admin — DLQ (fila morta)

`src/admin/controllers/dlq.controller.ts` — inspecionar e reprocessar
mensagens que estouraram as tentativas e caíram em `<fila>.dlq`. **System
admin.** `:queue` é o **nome real da fila** (não um step do pipeline).

### `GET /admin/dlq`

Lista as filas com DLQ inspecionável: `{ queues: [...] }` — steps v1 de fila
única (`sync-stores`), pares dispatch/batch v2 (`sync-base-product.dispatch`,
`sync-base-product.batch`), filas por origem de scrape em **maiúsculas**
(`import-competitor-products.DROGAL`), mais `pipeline.start` e
`migrate-tenant`. Use um destes nomes nas duas rotas abaixo.

### `GET /admin/dlq/:queue?limit=50`

**Espiar sem consumir**: busca até `limit` mensagens (default 50, cap 200) sem
ack e as devolve todas com um único nack/requeue no fim. Retorna
`[{ routingKey, body, redelivered, headers }]` (body é o JSON parseado; string
crua se não for JSON). `404` fila fora da lista.

### `POST /admin/dlq/:queue/replay?max=100`

Reprocessa: tira até `max` mensagens (default 100, cap 200) da DLQ e as
republica no exchange principal com a routing key original e `attempt=1`.
Para (devolvendo a mensagem) se encontrar mensagem não-JSON na frente da fila.
Resposta: `{ replayed: <n> }`. `404` fila desconhecida.

---

## 9. Admin — Catálogo global (shared_catalog)

Dados **globais**, não do tenant: o catálogo de concorrentes escrapeado e o
cadastro base curado por EAN. **System admin.**

### 9.1 Produtos de concorrentes — `src/products/products.controller.ts`

#### `POST /admin/catalog/products/:ean/import`

Scrape **ao vivo** das 9 origens para um EAN, persiste em
`shared_catalog` (product, product_image → R2, base_product) numa transação e
retorna a visão cruzada:

```json
{ "ean": "<ean>",
  "baseProduct": { "ean": "…", "description": "…", "activeIngredient": "…", "generic": true, "weight": "0.035", "height": "2.5", "length": "10.2", "width": "6.8" },
  "origins": [{ "origin": "DROGASIL", "found": true, "name": "…", "price": "12.9" }] }
```

(Medidas e preços vêm como **string** — colunas `numeric` do Postgres passam
sem conversão.)

`400` se o EAN não é numérico de até 14 dígitos. Chamada demorada (scrape
síncrono de 9 sites) — é ferramenta de diagnóstico/curadoria, não de rotina.

#### `GET /admin/catalog/products/export?origin=DROGASIL&limit=100&offset=0`

Export paginado do catálogo global (produto + imagem primária):
`{ total, limit, offset, items }`. `origin` opcional (enum da seção 6, `400` se
desconhecido); `limit` 1–1000; `offset` ≥ 0. Obs.: `unitSalePrice` e `url` dos
items são contrato com o FE e vêm sempre `null` (nenhum scraper preenche).

### 9.2 Cadastro base (curadoria) — `src/products/base-products-admin.controller.ts`

O cadastro interno EAN ↔ princípio ativo/descrição/medidas
(`shared_catalog.base_product`). É a **fonte única** de princípio ativo — o
ERP não fornece mais. Admin visual em `/admin/principios-ativos`.

#### `GET /admin/catalog/base-products`

Listagem paginada do cadastro: `{ rows, count, page, perPage }` (`perPage`
1–200, default 50).

| Query | O que faz |
| --- | --- |
| `search` | substring literal em EAN, descrição ou princípio ativo (1–100 chars) |
| `missingActiveIngredient=true` | só linhas **sem** princípio ativo |
| `generic=true|false` | filtra pela flag de genérico |

`missingActiveIngredient=true&generic=true` é a fila de curadoria.

#### `PATCH /admin/catalog/base-products/:ean`

Edita os campos curados de um EAN — todos opcionais, mas ao menos um
presente; `null` **limpa** o valor (string vazia é rejeitada com `400`):

```json
{ "activeIngredient": "Paracetamol", "generic": true, "description": "Paracetamol 750mg 20 comprimidos",
  "weight": 0.035, "height": 2.5, "length": 10.2, "width": 6.8 }
```

`weight` em kg; medidas em cm. Resposta: `{ ean, updated }`. `400` EAN
inválido ou body vazio; `404` EAN sem cadastro.

#### `GET /admin/catalog/base-products/active-ingredients`

Nomes distintos de princípio ativo com contagem de EANs: `[{ name, eans }]`.
Para autocomplete e revisão de nomenclatura.

#### `POST /admin/catalog/base-products/active-ingredients/rename`

Renomeia um princípio ativo em **todos** os EANs que o usam:

```json
{ "from": "Dipirona Sodica", "to": "Dipirona Sódica" }
```

Resposta: `{ from, to, updated }` (nomes já trimados + linhas alteradas).
`404` se nenhum EAN usa o nome de origem.

---

## 10. Tenant — Catálogo (`/products`)

`src/tenant-api/catalog/catalog.controller.ts` — os produtos da farmácia
autenticada, escopados pelo JWT. É a maior área da API: grids de leitura,
edição de produto e as escritas de preço/oferta que empurram para o ERP.

**Filtros comuns dos grids** (valem para `/products`, `/crossed`,
`/strategic-price`, `/stock`, `/stock-metrics`, `/export`; todos opcionais;
exceções anotadas):

| Query | Exemplo | O que faz |
| --- | --- | --- |
| `page`, `perPage` | `1`, `50` | paginação (o `/export` ignora — CSV sempre completo, cap 50 000 linhas) |
| `name` | `dipirona` | busca por nome |
| `supplier` | `EMS` | fornecedor |
| `classification` | `GENERICO` | classificação |
| `status` | `ATENÇÃO,SUSPEITA` | csv de status de variação (OK/ATENÇÃO/SUSPEITA) |
| `eans` | `789...,789...` | csv de EANs |
| `monitored`, `active` | `true` | flags do produto |
| `receiptFrom`, `receiptTo` | `2026-06-01` | janela da última entrada |
| `sortBy`, `sortDirection` | `price`, `DESC` | ordenação (o `/export` ignora — ordem fixa por EAN) |
| `store` | `3` | **id externo numérico** da loja: projeta preço/custo daquela loja. Só em `/products`, `/crossed`, `/strategic-price` e `/export` — `/stock` e `/stock-metrics` ignoram |

O DTO também aceita `activeIngredient`, mas esses grids o **ignoram** — o
filtro só tem efeito nos endpoints de princípio ativo (abaixo).

### Leituras

#### `GET /products`

Grid simples do catálogo (sem cruzamento com concorrentes):
`{ rows, count, page, perPage }`. **Quem pode:** qualquer papel do tenant.

#### `GET /products/crossed`

O grid principal: produtos do tenant **cruzados com os concorrentes** — por
linha, custo/preço/margem/status + `priceOffer` (preço de oferta vigente) +
preço e observação de cada concorrente habilitado. Além do shape paginado,
retorna `origins: string[]` (as origens habilitadas — uma coluna de preço por
origem). **Quem pode:** qualquer papel + módulo `crossed-products`.

#### `GET /products/strategic-price`

Produtos cruzados **com oferta em jogo** — observação de concorrente ou oferta
própria (deals). **Quem pode:** qualquer papel + módulo `strategic-pricing`.

#### `GET /products/stores`

O seletor de loja: lojas distintas com estoque, rotuladas de
`core.tenant_store`. Retorna `[{ storeId, storeExternalId, label, active }]` —
`storeId` (uuid) é o que `POST /products/:ean/price` espera. Pode vir `null`
quando a loja do ERP ainda não foi sincronizada — uma linha com `storeId: null`
**não aceita** escrita de preço (o DTO exige uuid) até o próximo `sync-stores`.
**Quem pode:** qualquer papel.

#### `GET /products/stock` e `GET /products/stock-metrics`

`/stock`: estoque próprio por produto (total do ERP + por loja + `stockStatus`
OK/OUT_OF_STOCK), paginado (`perPage` ≤ 200). `/stock-metrics`: agregado de
cobertura sobre o conjunto filtrado: `{ total, ownWithStock }`. **Quem pode:**
qualquer papel.

#### `GET /products/export`

O grid cruzado como **CSV** (`Content-Type: text/csv`). Mesmos filtros de
conteúdo do `/crossed` (inclusive `store`), mas **sem** paginação nem
ordenação da query: sempre ordenado por EAN, cap de 50 000 linhas. **Quem
pode:** qualquer papel + módulo `crossed-products`.

### Análise por princípio ativo

Agrupa o catálogo por princípio ativo (do cadastro base curado — seção 9.2)
para responder "estou bem posicionado nos genéricos?". Módulo
`active-ingredient-analysis` nos três.

#### `GET /products/active-ingredients`

Princípios ativos distintos do catálogo: `{ activeIngredients: [...] }`.

#### `GET /products/active-ingredients/crossed?store=3`

Grupos por princípio ativo **para uma loja** — `store` (id externo) é
**obrigatório**, `400` sem ele. Cada grupo traz: o *combate* (variante mais
barata com estoque), a variante de menor custo, o concorrente mais barato, a
`decision` derivada (`subir` / `abaixar` / `ok` / `mix` / `sem-estoque`),
`priceOffer` e as variantes. `tolerance` (%) alarga a faixa de `ok`;
`decision` filtra grupos.

#### `GET /products/active-ingredients/decision-counts?store=3`

A contagem por decisão que alimenta os chips de filtro:
`{ subir, abaixar, ok, mix, "sem-estoque", total }`. `store` obrigatório;
honra `activeIngredient`/`tolerance`.

### Escritas

#### `PATCH /products/:ean`

Edita campos do produto **no banco do tenant** (nada vai ao ERP): `name`,
`supplier`, `monitored`, `active`, `cost`, `averageUnitCost`, `unitSalePrice`,
`classificationId`. Preço de venda NÃO é editável aqui (use `/price`);
identidade (princípio ativo, genérico) vive no cadastro base (seção 9.2).
Resposta: `{ ean, updated }`. **Quem pode:** operator/admin.

`400` body vazio ou EAN inválido; `404` produto não existe.

#### `POST /products/:ean/price`

Troca o preço de venda **de uma loja**, com o ERP como fonte da verdade:
primeiro empurra ao A7Pharma (`POST /webapi/api/preco/`), e **só se der certo**
espelha em `product_item` local.

```json
{ "newPrice": 29.9, "storeId": "<uuid de GET /products/stores>" }
```

Resposta: `{ ean, price, storeId }`. **Quem pode:** operator/admin + um dos
módulos de precificação.

| Erro | Quando |
| --- | --- |
| `404` | produto ou loja não existe |
| `409` | produto `monitored` (preço travado), sem `external_id` do ERP, loja inativa, ou tenant sem API A7Pharma configurada |
| `502` | o ERP recusou a escrita — nada foi espelhado |

#### `POST /products/:ean/offer` e `DELETE /products/:ean/offer`

Mesmo padrão ERP-primeiro para **oferta** (preço de caderno):

- `POST` grava `precoOferta` no caderno (`cadernoId` de `GET /offer-campaigns`)
  e espelha em `tenant.offer_book` + nos `product_item` cujo caderno vencedor é
  esse. Body: `{ "targetPrice": 24.9, "cadernoId": 118, "description": "Oferta encarte julho" }`
  (description opcional — omitida preserva a atual). Resposta: `{ ean, targetPrice, cadernoId }`.
- `DELETE` manda `precoOferta=null` ao caderno, apaga o `offer_book` local e
  zera os espelhos por loja. Resposta: `{ ean, deleted: true }`. `404` se não
  há oferta.

**Quem pode:** operator/admin + um dos módulos de precificação. Erros: `409`
apenas para produto sem `external_id` do ERP, oferta sem caderno (no DELETE) ou
API A7Pharma não configurada — produto `monitored` **não** bloqueia oferta (só
o `/price`) e não há caso de loja inativa (oferta não recebe loja); `502` se o
ERP recusar.

#### `DELETE /products/:ean`

Soft-delete (`active=false`) no banco do tenant, sem tocar o ERP. Resposta:
`{ ean, deleted: true }`. **Quem pode:** admin do tenant.

---

## 11. Tenant — Cadernos de oferta

`src/tenant-api/offer-campaigns/offer-campaigns.controller.ts`

### `GET /offer-campaigns`

Cadernos de oferta **ativos, já iniciados e não vencidos** do tenant, para o
seletor do fluxo de oferta: `[{ id, name }]` ordenado por nome. O `id` é o
`external_id` do ERP (idCadernoOferta) — exatamente o `cadernoId` que
`POST /products/:ean/offer` e os itens `precoOferta` do apply esperam.
Cadernos valem para o tenant inteiro (não por loja). **Quem pode:** qualquer papel.

---

## 12. Tenant — Lojas e clusters de loja

`src/tenant-api/stores/stores.controller.ts` — as filiais da farmácia e seus
agrupamentos. Lojas são **sincronizadas do ERP** (step `sync-stores`) e nascem
`active=false`; o admin opta por ativá-las. **Tudo nesta seção exige admin do
tenant.**

Não confundir: `store-clusters` agrupam **lojas** (ex.: "Lojas Centro");
`/pricing/clusters` (seção 17) agrupam **produtos**.

### `GET /stores`

Lojas não deletadas, ordenadas por nome:
`[{ id, externalId, name, cnpj, active, clusterId, clusterName }]`.
`clusterId/clusterName` vêm `null` sem cluster.

### `PUT /stores/:id`

Atualiza `active` e/ou o cluster; campo omitido fica como está; `clusterId:
null` desanexa.

```json
{ "active": true, "clusterId": "<uuid do cluster>" }
```

Detalhe importante: **reativar** uma loja apaga os `product_item` congelados
dela — as leituras voltam ao preço global até o próximo sync do ERP repovoar.
`400` body sem nenhum campo; `404` loja ou cluster inexistente.

### `GET /store-clusters` · `POST /store-clusters` · `PUT /store-clusters/:id` · `DELETE /store-clusters/:id`

CRUD simples dos agrupamentos:

- `GET` → `[{ id, name, storeCount, createdAt, updatedAt }]`.
- `POST` `{ "name": "Lojas Centro" }` (1–120 chars) → cluster com `storeCount: 0`.
- `PUT` renomeia.
- `DELETE` soft-delete e **limpa o `cluster_id` das lojas membros** (nenhuma
  loja fica apontando para cluster morto). Retorna `{ id, name }`.

---

## 13. Tenant — Configurações

`src/tenant-api/config/*.controller.ts`

### 13.1 Limiares de variação — `/settings/variation-status`

Os limiares que classificam a variação preço×concorrência de cada produto em
`OK` / `ATENÇÃO` / `SUSPEITA` (a coluna `status` dos grids).

- `GET /settings/variation-status` — qualquer papel. Retorna sempre o objeto
  completo: valores do tenant mesclados sobre os defaults
  `{ suspectBelow: -15, attentionBelow: 0, attentionAbove: 20, suspectAbove: 50 }`.
- `PATCH /settings/variation-status` — admin. Parcial: só os campos enviados
  mudam; retorna o conjunto completo mesclado. Body ex.: `{ "attentionAbove": 15 }`.

### 13.2 Classificações — `/classifications`

Categorias de produto do tenant (sincronizadas do ERP). Qualquer papel.

- `GET /classifications` — lista plana ordenada por nome:
  `[{ id, name, parentId, visible }]`.
- `GET /classifications/grouped` — a mesma coisa como árvore (até 3 níveis):
  nós `{ id, name, parentId, visible, children }`. O FE renderiza direto.

### 13.3 Arredondamento de preço — `/configurations/price-rounding`

Faixas de preço com "buckets" de centavos: um preço dentro de
`[priceMin, priceMax]` cujos centavos caem em `[decimalMin, decimalMax]` é
arredondado para `roundTo` (ex.: R$ 23,37 → R$ 23,29). Usado pelas sugestões
(`applyRounding`) e pelo preview de caderno (`applyPriceRounding`).
**Módulo:** `pricing-rules` OU `offer-book-rules`. Leituras: qualquer papel;
escritas: admin.

- `GET /configurations/price-rounding` — faixas ordenadas por `priceMin`:
  `[{ id, priceMin, priceMax, rules: [{ decimalMin, decimalMax, roundTo }] }]`.
- `GET /configurations/price-rounding/:id` — uma faixa. `404` se não é do tenant.
- `POST /configurations/price-rounding` — cria uma faixa:

  ```json
  { "priceMin": 10, "priceMax": 49.99,
    "rules": [ { "decimalMin": 0, "decimalMax": 0.49, "roundTo": 0.29 },
               { "decimalMin": 0.5, "decimalMax": 0.99, "roundTo": 0.89 } ] }
  ```

  `400` se `priceMin > priceMax` ou algum bucket com `decimalMin > decimalMax`.
- `PATCH /configurations/price-rounding/:id` — parcial para os limites; se
  `rules` vier, os buckets são **substituídos por inteiro** (delete +
  reinsert).
- `DELETE /configurations/price-rounding/:id` — apaga faixa e buckets.
  Retorna `{ id, deleted: true }`.

---

## 14. Tenant — Integração (visão do tenant)

`src/tenant-api/integration/integration.controller.ts`

### `GET /integration/health`

O painel do tenant perguntando "meu ERP está conectado?". **Admin do tenant.**
Resposta **sanitizada de propósito**: `{ ok, lastVerifiedAt }` — sem erro cru
de driver, porque host/credenciais são infra gerida pela Farmacore, não do
cliente. Integração desabilitada responde `ok: false` sem tocar o ERP; o ping
tem cache single-flight de TTL curto, então **pode ser usado em polling**.
`404` se o tenant não tem integração configurada. ERP fora do ar **não** vira
`5xx` — vem `ok: false`.

---

## 15. Tenant — Regras de caderno de oferta

`src/tenant-api/offer-book-rules/offer-book-rules.controller.ts` — preview
(dry-run), CRUD, execução assíncrona e relatórios do conjunto de regras aplicado
a um caderno de ofertas existente. **Uma regra por caderno.** Tudo aqui:
operator/admin + módulo `offer-book-rules`.

O desenho do ledger, a recuperação sem dupla escrita e as decisões de status
estão em [`plano-offer-book-rules-fase3-execucao-2026-07-10.md`](./plano-offer-book-rules-fase3-execucao-2026-07-10.md).

### `POST /offer-book-rules/preview`

Dry-run do motor de precificação de caderno: calcula o preço que cada produto
selecionado **teria** sob as regras + travas enviadas, sem persistir nada.
**Quem pode:** operator/admin + módulo `offer-book-rules`.

```json
{
  "calculationBaseType": "COMPETITIVE_PRICE",
  "priceBaseSources": ["OWN_PRICE", "DROGASIL", "PAGUE_MENOS"],
  "eans": ["<ean-1>", "<ean-2>"],
  "pricingRules": [
    { "classifications": [], "priceRangeMin": 10, "priceRangeMax": 49.9,
      "marginRangeMin": 20, "marginRangeMax": 60,
      "actionType": "DISCOUNT", "percentageValue": 12.5, "active": true }
  ],
  "priceLocks": [ { "classifications": [], "minMargin": 25, "active": true } ],
  "applyPriceRounding": true,
  "page": 1, "pageSize": 100
}
```

Como montar o body:

- **Seleção de produtos**: exatamente **um** de `eans` OU `classifications`
  (ambos ou nenhum = `400`). Caps: 10 000 EANs / 500 classificações.
- **Base de cálculo** (`calculationBaseType`): `COMPETITIVE_PRICE` (menor
  preço entre as `priceBaseSources` — obrigatórias nesse modo; `OWN_PRICE` +
  concorrentes), `SALE_PRICE` (preço de venda atual) ou `OFFER_PRICE` (preço
  de oferta atual).
- **Regras** (`pricingRules`, até 200): cada uma mira classificações e/ou
  faixas de preço/margem (sem nada = pega tudo) e aplica `DISCOUNT` ou
  `INCREASE` de `percentageValue` % (0–100). Regras ativas **não podem se
  sobrepor** (mesmos produtos + faixas cruzadas = `400`).
- **Travas** (`priceLocks`, até 200): margem mínima por classificação; locks
  sobrepostos ou um lock "todas as classificações" convivendo com outros = `400`.
- `applyPriceRounding: true` aplica as faixas da seção 13.3 no resultado.

Resposta paginada (`pageSize` cap 1000): `{ rows, total, page, pageSize,
totalPages }`, cada row com ean, nome, externalId, classificação, preços
base/atual/final, margens, `appliedPercentageValue` e flags de skip/lock/
rounding.

### `POST /offer-book-rules`

Salva o conjunto de regras aplicado a um caderno de ofertas **existente** —
`offerBookInfoId` é o id que `GET /offer-campaigns` lista (não se cria caderno
aqui, só se aplica regra a ele). O body reaproveita o shape do preview
(`calculationBaseType`, `priceBaseSources`, `eans` XOR `classifications`,
`pricingRules`, `priceLocks`, `applyPriceRounding`) e adiciona o agendamento:

```json
{
  "offerBookInfoId": 118,
  "calculationBaseType": "COMPETITIVE_PRICE",
  "priceBaseSources": ["OWN_PRICE", "DROGASIL"],
  "eans": ["<ean>"],
  "pricingRules": [ … ],
  "priceLocks": [ … ],
  "scheduleEnabled": true,
  "scheduledDays": [1, 3, 5],
  "applyPriceRounding": true
}
```

- `scheduledDays` usa o índice de dia do Postgres (`extract(dow)`):
  **0 = domingo … 6 = sábado**. Obrigatório quando `scheduleEnabled: true`
  (`400` sem ele).
- Resposta: `{ id }` (uuid da regra).
- Erros: `400` mesmas validações do preview; `404` caderno inexistente ou
  inativo; `409` já existe regra para o caderno — **uma regra por caderno**
  (a unique no banco fecha a corrida entre dois creates simultâneos).

### `GET /offer-book-rules?page=1&pageSize=50`

Lista paginada das regras salvas: `{ rows, total, page, pageSize, totalPages }`,
cada row `{ id, offerBookInfoId, cadernoName, calculationBaseType,
scheduleEnabled, status, productsCount, createdAt }`. `status` é `IDLE`,
`RUNNING`, `SUCCEEDED`, `PARTIALLY_SUCCEEDED` ou `ERRORED`. `pageSize` default
50, máx 200 (valores maiores são reduzidos em silêncio).

### `GET /offer-book-rules/:id`

Detalhe completo: o item da lista (incluindo `status`) + `priceBaseSources`,
`classifications`, `scheduledDays`, `applyPriceRounding`, `eans`,
`pricingRules` e `priceLocks`. `400` se `:id` não é uuid; `404` se não existe.

### `DELETE /offer-book-rules/:id`

Remove a regra — **hard delete** (apaga em cascata regras, locks e produtos
associados; diferente dos soft-deletes do resto da API). Retorna `{ id }`.
`404` se não existe; `409` se a regra está `RUNNING`, para não apagar o ledger
enquanto o worker escreve no ERP.

### `POST /offer-book-rules/:id/execute` — `202`

Executa uma regra salva de forma assíncrona. O request calcula os preços,
congela preço e destino A7 em um ledger por produto e publica o trabalho para o
worker; a resposta imediata é `{ "reportId": "<uuid>" }`.

```bash
curl -X POST {{baseUrl}}/offer-book-rules/<ruleId>/execute \
  -H 'Authorization: Bearer <accessToken>'
```

- `404` se a regra não existe.
- `409` se o caderno está inativo, ainda não começou ou expirou.
- `409` se já existe uma execução recente. Uma execução antiga interrompida é
  retomada com o mesmo `reportId`, sem recalcular ou reenviar preço já aceito.
- O `status` da regra fica `RUNNING` até o worker concluir. Resultado parcial
  vira `PARTIALLY_SUCCEEDED`; falha total vira `ERRORED`.

### `GET /offer-book-rules/:id/execution-reports?page=1&perPage=20`

Histórico de uma regra, mais recente primeiro. Retorna
`{ rows, total, page, pageSize, totalPages }`; `perPage` aceita 1–100 e usa 20
por padrão. Cada header contém `{ id, ruleId, offerBookInfoId, executedAt,
executionType, calculationBaseType, totalProducts, productsUpdated,
productsSkipped, outcome, errorMessage }`. `outcome` fica `null` durante a
execução e depois vira `SUCCESS`, `FAILURE` ou `NO_CHANGES`.

### `GET /offer-book-rules/execution-reports`

Histórico global do tenant, com a mesma paginação e shape do endpoint anterior.
Filtros opcionais:

- `ruleId` (uuid) e `offerBookInfoId` (inteiro positivo).
- `executionType=MANUAL|SCHEDULED` e
  `outcome=SUCCESS|FAILURE|NO_CHANGES`.
- `startDate` e `endDate` em ISO 8601. Uma data sem hora representa o dia civil
  inteiro em `America/Sao_Paulo`; `endDate=2026-07-11`, por exemplo, inclui até
  o fim desse dia local.

Exemplo: `GET /offer-book-rules/execution-reports?ruleId=<uuid>&startDate=2026-07-01&endDate=2026-07-11&page=1&perPage=20`.

### `GET /offer-book-rules/execution-reports/:reportId?page=1&perPage=50`

Cabeçalho do relatório + items paginados. Aqui `page` e `perPage` são
**obrigatórios**, `perPage` aceita 1–100 e `name` filtra nome do produto sem
diferenciar maiúsculas/minúsculas. Retorna
`{ report, items, totalItems, page, pageSize, totalPages }`.

Cada item registra o snapshot auditável do cálculo (`ean`, `name`,
`classification`, preços, custo, margens, ação, percentual e flags) e o estado
da escrita: `applyStatus=pending|erp_applied|applied|failed|skipped`,
`applyError` e `wasUpdated`. `404` se o relatório não existe.

---

## 16. Tenant — Aplicação e agendamento de preços

`src/tenant-api/pricing/pricing-apply.controller.ts` e
`pricing-schedule.controller.ts` — o caminho de **escrita em massa**: valida
itens contra guarda-corpos, persiste o run e empurra ao ERP via outbox.
**Módulo `pricing-rules`** em tudo; operator/admin, exceto aprovar/rejeitar
(admin).

Conceitos antes dos endpoints:

- **Item**: `{ ean, target, price, storeId?, cadernoId? }`. `target` é
  `precoVenda` (preço de venda) ou `precoOferta` (preço no caderno).
  `cadernoId` é opcional mesmo para oferta: ausente, o service deriva do
  `offer_book` (itens por loja usam o caderno vencedor da loja). `storeId`
  (uuid) escopa à loja; sem ele, preço global. 1–5000 itens por lote.
- **Run**: cada chamada vira um registro com contadores
  (`total/applied/skipped/failed`) e itens por EAN — acompanhe em
  `GET /pricing/apply/:id`.
- **Aprovação**: com `PRICING_APPLY_REQUIRES_APPROVAL=1` no ambiente, o run
  nasce `approvalStatus='pending'` e só vai ao ERP depois de
  `POST /pricing/apply/:id/approve` (admin).
- **Circuit breaker**: lote com ≥ 10 itens onde mais de 50% é rejeitado por
  motivo não-estrutural **aborta inteiro** com `422` — proteção contra mandar
  um lote quebrado ao ERP.
- **Idempotência**: `idempotencyKey` obrigatória no apply; reenviar a mesma
  chave devolve o run existente (`idempotent: true`) sem duplicar nada.

### `POST /pricing/apply` — `202`

```json
{
  "idempotencyKey": "apply-2026-07-10-loja-centro-001",
  "mode": "agora",
  "items": [
    { "ean": "<ean-1>", "target": "precoVenda", "storeId": "<uuid>", "price": 29.9 },
    { "ean": "<ean-2>", "target": "precoOferta", "price": 19.9, "cadernoId": 118 }
  ]
}
```

Resposta: `{ applyRunId, accepted, rejected: [...], idempotent?, approvalStatus? }`.
`422` se o circuit breaker abortar (body traz `aborted: true` e os motivos).

### `POST /pricing/apply/preview` — `200`

Mesmos guarda-corpos, **zero efeito**: nada é persistido nem enfileirado.
Body só com `items`. Resposta:
`{ total, accepted: [{ ean, target, storeId, price, basis }], rejected: [{ ean, reason, storeId }], wouldAbort }` —
`wouldAbort: true` avisa que o lote real dispararia o breaker. Use antes de
todo apply grande.

### `GET /pricing/apply?page=1&perPage=100`

Histórico de runs, mais recente primeiro:
`[{ id, status, mode, approvalStatus, total, applied, skipped, failed, createdAt }]`.
`perPage` cap 1000.

### `GET /pricing/apply/:id?page=1&perPage=100`

Relatório de um run: cabeçalho + itens paginados por EAN
(`ean, target, storeId, price, priceOld, status, reason, basis, cadernoId,
ruleId, erpResult, appliedAt`). `404` run inexistente.

### `POST /pricing/apply/:id/approve` — `202` · `POST /pricing/apply/:id/reject` — `200`

Decisão do admin sobre run pendente:

- `approve` transiciona `pending → approved` e dispara o push ao ERP.
  Retorna `{ id, approved: true }`.
- `reject` marca o run como falho (`approvalStatus='rejected'`) e todos os
  itens pendentes como `failed` com motivo `rejeitado`; nada vai ao ERP.
  Retorna `{ id, rejected: true }`.

`409` se o run não está aguardando aprovação; `404` se não existe.

### `POST /pricing/apply/:id/rollback` — `202`

Reverte um run aplicado: re-aplica o `priceOld` de cada item que foi de fato
aplicado, **pelo pipeline normal de apply** — os guarda-corpos rodam de novo.
Usa `idempotencyKey` interna `rollback:<runId>`, então repetir o POST é
seguro. Resposta: mesmo shape do apply. `422` se não há item reversível.

### Agendamentos — `/pricing/schedules`

O mesmo apply, adiado: em `runAt` o `PricingScheduleCron` dispara o lote.

#### `POST /pricing/schedules`

```json
{
  "runAt": "2026-07-15T03:00:00.000Z",
  "items": [ { "ean": "<ean>", "target": "precoVenda", "storeId": "<uuid>", "price": 29.9 } ],
  "cronExpr": "0 3 * * 1",
  "recalc": false
}
```

- Default: **one-shot com preços congelados** — o que você mandou é o que
  aplica. `runAt` no **passado** é reivindicado pelo cron imediatamente
  (`run_at <= now()`) — o push ao ERP dispara na hora; use sempre data futura.
- `cronExpr` (opcional) torna **recorrente**: re-arma após cada disparo
  (`400 cron inválido: …` se a expressão não parseia).
- `recalc: true` ignora os preços congelados e **recalcula pelo motor de
  sugestões** na hora do disparo.

Resposta (`201`): `{ id, runAt, status: 'pending', applyRunId, itemCount, cronExpr, recalc, createdAt }`.
Grava auditoria (`schedule_create`).

#### `GET /pricing/schedules` · `GET /pricing/schedules/:id`

Lista (ordenada por `runAt` desc) e detalhe. `status`:
`pending | fired | cancelled | failed`; depois do disparo, `applyRunId` aponta
o run gerado.

#### `DELETE /pricing/schedules/:id`

Cancela um agendamento **pendente** — guard atômico
(`UPDATE … WHERE status='pending'`), então um schedule que o cron já pegou não
é sobrescrito: `409` se já disparou/cancelou/falhou. Retorna
`{ id, cancelled: true }`. Grava auditoria (`schedule_cancel`).

---

## 17. Tenant — Sugestões de preço, regras e clusters

`src/tenant-api/pricing/*.controller.ts` — o motor de sugestão (B5): regras
declarativas calculam um **preço sugerido** por produto; o usuário revisa e
manda para o apply da seção 16. **Módulo `pricing-rules`**; operator/admin,
exceto onde indicado.

Como as peças se encaixam:

```
clusters de produto ──┐
classificações ───────┼─► regra de sugestão ─► GET /pricing/suggestions ─► POST /pricing/apply
lojas (storeIds) ─────┘         (motor)            (revisão no grid)          (escrita no ERP)
```

### Regras — anatomia

Uma regra (`suggestion-rule`) diz **para quais produtos** e **como** sugerir:

- **Alvo** (no máximo um): `classifications: [uuid…]` OU `clusterId` (cluster
  de produto) — os dois juntos é `400`; **nenhum** dos dois é aceito e vira
  regra *catch-all* (pega qualquer produto, com a menor especificidade).
  `excludeClusterIds` fura o alvo. `storeIds` (uuids) restringe a lojas —
  vazio/ausente = todas as lojas ativas.
- **Estratégia**:
  - `margem` — sugere o preço que fecha `minMargin` % de margem **sobre o
    preço de venda**: `custo / (1 − minMargin/100)` (custo 10, margem 50% →
    sugestão 20, não 15).
  - `concorrencia` — segue os concorrentes, exigindo ao menos um em
    `competitors`. `competitorMode`: `weighted` (média ponderada pelos
    `weight`, > 0 e ≤ 100), `cascade` (primeiro concorrente com preço, na
    ordem) ou `lowest` (menor preço). `variationPct` desloca o resultado
    (ex.: `-5` = 5% abaixo); `noCompetitorMargin` é o fallback de margem
    quando nenhum concorrente tem preço — só tem efeito nessa estratégia
    (fora dela é **silenciosamente zerado para null**, não dá erro).
- **Flags**: `priceControlled` (respeita preço controlado), `ignorePbm`,
  `blockPbmInMargin`, `cascadeByPriority`, `applyRounding` (aplica a seção
  13.3 ao preço final), `active`.

Validações que derrubam com `400`: alvo ambíguo (classifications E cluster),
regra excluindo o próprio cluster, concorrente duplicado ou fora do enum de
origens conhecidas (a lista de **habilitadas** do tenant não é checada), peso
fora de (0,100] no modo weighted, `concorrencia` sem competitors, `storeIds`
de loja que não é do tenant.

### `GET /pricing/suggestions`

O grid de revisão: produtos com o preço sugerido calculado sobre **todas as
regras ativas**. Resposta:

```json
{ "rows": [{ "product": { … }, "result": { … },
             "origem": { "clusterId": "…", "clusterName": "…", "overrodeRuleName": null } }],
  "count": 1234, "suggestionCount": 210, "lockCount": 3,
  "activeRuleCount": 4, "availableBooks": ["Caderno A"] }
```

(`origem` da row é objeto ou `null` — a sugestão veio de um cluster? A string
`cluster`/`classificacao` é só o valor do query param `?origem=`.)

(contadores calculados sobre o conjunto **pré**-paginação). Cache-Control:
`private, max-age=30`.

| Query | Valores | O que faz |
| --- | --- | --- |
| `page`, `perPage` | 1 / 50 (cap 1000) | paginação |
| `name`, `classification` | string | filtros |
| `store` | id **externo** numérico | escopa preços/custos/ofertas à loja e só aplica regras que a incluem; loja inexistente/inativa = `400` |
| `books` | csv de nomes | filtra por caderno |
| `onlyWithSuggestion` | `true` | só linhas com sugestão |
| `direction` | `todas` \| `subir` \| `abaixar` | direção da mudança |
| `origem` | `todas` \| `cluster` \| `classificacao` | de onde veio a regra |

### `POST /pricing/suggestions/preview` — `200`

Dry-run de uma regra **não salva**: body = a regra (anatomia acima), query =
os mesmos filtros do GET. Calcula as sugestões da base inteira usando **só**
essa regra, pelo mesmo pipeline (inclusive `?store=`). Roda a mesma validação
cross-field do create (`400` para combinação inválida), **exceto** a checagem
de `storeIds` contra as lojas do tenant — loja alheia passa no preview mas
falha no create. Use para calibrar a regra antes de salvar.

### CRUD de regras — `/pricing/suggestion-rules`

- `GET /pricing/suggestion-rules` — regras não deletadas, `updatedAt` desc.
  Numéricos como number; `clusterName` já vem resolvido.
- `POST /pricing/suggestion-rules` — cria (grava auditoria). Defaults:
  `strategy=margem`, `competitorMode=weighted`, `variationPct=0`,
  `applyRounding=true`, `active=true`, demais flags `false`.
- `PATCH /pricing/suggestion-rules/:id` — **update completo** (mesmo DTO do
  create — envie a regra inteira, não um patch parcial). Grava auditoria.
- `DELETE /pricing/suggestion-rules/:id` — soft-delete (auditoria). Retorna
  `{ id, deleted: true }`.

Body de exemplo (create/update/preview):

```json
{
  "name": "Genéricos — concorrência",
  "classifications": ["<uuid-da-classificação>"],
  "clusterId": null,
  "excludeClusterIds": [],
  "storeIds": [],
  "strategy": "concorrencia",
  "minMargin": 30,
  "competitorMode": "weighted",
  "competitors": [
    { "competitor": "DROGASIL", "weight": 60 },
    { "competitor": "PAGUE_MENOS", "weight": 40 }
  ],
  "variationPct": -5,
  "noCompetitorMargin": 35,
  "priceControlled": false,
  "ignorePbm": false,
  "blockPbmInMargin": false,
  "cascadeByPriority": false,
  "applyRounding": true,
  "active": true
}
```

### Clusters de produto — `/pricing/clusters`

Conjuntos nomeados de EANs para usar como alvo de regra (não confundir com
`/store-clusters`, que agrupa **lojas** — seção 12).

- `GET /pricing/clusters` — `[{ id, name, memberCount, createdAt, updatedAt }]`,
  mais recente primeiro.
- `GET /pricing/clusters/:id` — inclui `eans` (ordenados). `400` se `:id` não
  é uuid; `404` não existe.
- `POST /pricing/clusters` — `{ "name": "Genéricos dor e febre", "eans": ["789…"] }`.
  EANs são trimados, deduplicados e filtrados para dígitos de 6–14 chars; máx
  5000 (`400` acima). Grava auditoria.
- `PATCH /pricing/clusters/:id` — renomeia; se `eans` vier no body (**mesmo
  vazio**) a membership inteira é substituída; sem `eans`, fica intacta.
- `DELETE /pricing/clusters/:id` — soft-delete. **`409` se alguma regra não
  deletada referencia o cluster** (como alvo ou exclusão) — mesmo regra
  `active: false` bloqueia; a mensagem lista as regras, apague-as primeiro.

### `GET /pricing/competitor-origins`

As 9 origens conhecidas mescladas com a config do tenant:
`[{ origin, label, priority, enabled }]` por prioridade. Origem sem linha de
config vem `enabled: false, priority: 100`. **Qualquer papel** (viewer+);
módulo `crossed-products` OU `pricing-rules`. Cache-Control:
`private, max-age=300`. O FE usa para montar as colunas de concorrentes e o
seletor de `competitors` das regras.

### `GET /pricing/audit`

Trilha de auditoria **append-only** do tenant — quem criou/alterou/apagou
regras, clusters e agendamentos. **Admin.**
`[{ actor, action, entity, entityId, changes, createdAt }]`, mais recente
primeiro. Filtros opcionais `entity`/`entityId`; `page`/`perPage` (cap 200).

---

## 18. Receitas (fluxos completos)

### A. Colocar uma farmácia no ar (system admin)

```
1. POST /auth/login                                  { tenantSlug: "system" }
2. POST /admin/tenants                               → anote a oneTimePassword
3. PUT  /admin/tenants/:slug/integration             credenciais do ERP
4. POST /admin/tenants/:slug/integration/test        → { ok: true }?
5. PUT  /admin/tenants/:slug/modules                 (opcional — nasce com todos)
6. PUT  /admin/tenants/:slug/competitor-origins      habilite os concorrentes
7. POST /admin/tenants/:slug/pipeline/start          primeira carga completa
8. (cliente) POST /auth/login com a oneTimePassword
```

### B. Escrapear um concorrente só

```
0. GET  /admin/tenants/:slug/competitor-origins      anote a config atual
1. PUT  /admin/tenants/:slug/competitor-origins      envie as 9 origens: ele
        enabled:true, as demais enabled:false (o PUT é UPDATE-only — origem
        não enviada mantém o estado atual e continuaria sendo escrapeada)
2. POST /admin/tenants/:slug/pipeline/steps/import-competitor-products
3. GET  /admin/dlq/import-competitor-products.DROGAL     se algo falhar (origem em MAIÚSCULAS)
4. PUT  /admin/tenants/:slug/competitor-origins      RESTAURE a config do passo 0 —
        senão o pipeline noturno segue escrapeando só essa origem e os preços
        de concorrência dos outros 8 ficam velhos
```

### C. Trocar o preço de um produto numa loja (operator)

```
1. GET  /products/stores            → pegue o storeId (uuid) da loja
2. POST /products/:ean/price        { newPrice, storeId }
   409? → produto monitorado, sem id do ERP, loja inativa ou API não configurada
   502? → ERP recusou; nada foi espelhado localmente
```

### D. Da regra à prateleira (sugestão → aplicação)

```
1. POST /pricing/clusters                (opcional) agrupe os EANs alvo
2. POST /pricing/suggestions/preview     calibre a regra sem salvar
3. POST /pricing/suggestion-rules        salve
4. GET  /pricing/suggestions?store=3     revise o resultado por loja
5. POST /pricing/apply/preview           confira accepted/rejected/wouldAbort
6. POST /pricing/apply                   { idempotencyKey, items }  → 202
7. POST /pricing/apply/:id/approve       se aprovação estiver ligada (admin)
8. GET  /pricing/apply/:id               acompanhe applied/failed por EAN
   arrependeu? POST /pricing/apply/:id/rollback
   quer de madrugada? POST /pricing/schedules no lugar de 6
```

### E. Investigar mensagens que falharam (system admin)

```
1. GET  /admin/dlq                       nomes reais das filas
2. GET  /admin/dlq/:queue?limit=50       espie sem consumir
3. corrija a causa (integração? bug? dado?)
4. POST /admin/dlq/:queue/replay?max=100 reprocesse
```
