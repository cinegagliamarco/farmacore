# Plano frontend — Preços multiloja (preço por loja, gestão de lojas e clusters)

**Repo:** frontend React (pricy-shelf / app do tenant). **Para:** agente Claude no frontend.
**Objetivo:** integrar o modelo **multiloja** do backend: seletor global de loja, decisão por
princípio ativo escopada por loja, **alteração de preço por loja** (`POST /products/:ean/price`
agora exige `storeId`), e as telas ADMIN de **Lojas** e **Clusters de loja**.

> Par deste doc: [`plano-lojas-clusters-2026-06-28.md`](./plano-lojas-clusters-2026-06-28.md)
> (lado backend, já mergeado). Aqui é só o consumo: **nenhum preço/decisão é calculado no FE**.
> Este doc **substitui o contrato** de [`plano-frontend-filtros-active-ingredients.md`](./plano-frontend-filtros-active-ingredients.md)
> (naming `subsidiary` ficou stale — ver §4) e corrige o `useSetPrice` de
> [`plano-frontend-integracao-acoes-precificacao-2026-06-23.md`](./plano-frontend-integracao-acoes-precificacao-2026-06-23.md).
> Stack, `apiClient`, auth, roles e convenções: já cobertos por
> [`plano-frontend-pricing-2026-06-23.md`](./plano-frontend-pricing-2026-06-23.md) §0 — não repetidos aqui.

---

## 1. O que muda conceitualmente

Preço deixa de ser um valor único por produto: o armazenamento passa a ser por
**(produto × loja)** na tabela `product_item` (chave `product_id` + `store_id`, colunas
`price`, `price_offer`, `cost`), populada pelo sync noturno (só lojas **ativas**) e pelo
write-back de preço. Consequências para o FE:

- **Toda alteração de preço é escopada a uma loja** — o `POST /products/:ean/price` exige
  `storeId` (UUID de `core.tenant_store`). Não existe mais "mudar o preço do produto" via
  esse endpoint; o caminho global só existe internamente no bulk apply do worker.
- **Toda decisão por princípio ativo já era por loja** (`?store=` = id externo numérico) —
  isso não muda, só o naming (§4).
- **Leituras seguem a loja**: com `?store=` (id externo), os GETs projetam `price`/`cost` de
  `product_item` da loja por cima dos globais (fallback `product` quando a loja não tem linha),
  e a `margin` é recalculada com a mesma fórmula do sync (base = oferta crua quando houver,
  senão o preço efetivo). Nos endpoints de decisão (`?store=` obrigatório) a decisão inteira
  (combate/mix/subir/abaixar) é calculada com o preço da loja. Sem `?store=`, valem os
  globais — rotular como "preço base".
- **Oferta (`priceOffer`) continua global por EAN** — `offer_book` não tem dimensão de loja;
  o mesmo valor vale para todas as lojas. Não oferecer "oferta por loja" na UI.
- Lojas são **opt-in**: o sync do ERP cria `tenant_store` com `active=false`; o admin ativa
  na tela de Lojas (§3d) para a loja entrar no sync de `product_item`.

## 2. Contrato (exato — não inventar campos)

Tudo com `Authorization: Bearer <token>`. Leituras de `/products/*` abertas a qualquer papel;
`POST /products/:ean/price` exige `operator`/`admin`; **`/stores` e `/store-clusters` são
`admin`-only** (403 `"Insufficient role"` para operator/viewer). Além do papel, os endpoints
de análise/decisão e as mutações de preço/oferta exigem **módulo habilitado no tenant**
(`CROSSED_PRODUCTS`, `ACTIVE_INGREDIENT_ANALYSIS`, `STRATEGIC_PRICING` — PR #66; 403 se o
tenant não tem o módulo). `GET /products`, `GET /products/stores` e as telas admin de lojas
não exigem módulo.

| Método | Rota | Papel | Uso |
|---|---|---|---|
| GET | `/products/stores` | qualquer | seletor de loja (traz o **UUID** e `active`) |
| GET | `/products/active-ingredients/crossed?store=` | qualquer | grupos de decisão por loja |
| GET | `/products/active-ingredients/decision-counts?store=` | qualquer | chips de decisão |
| GET | `/products` · `/crossed` · `/strategic-price` · `/export` + `?store=` opcional | qualquer | grades com preço/custo **da loja** |
| POST | `/products/:ean/price` | operator/admin | alterar preço **de uma loja** |
| GET | `/stores` | admin | tela Lojas (traz o **UUID** e a flag `active`) |
| PUT | `/stores/:id` | admin | ativar/desativar loja, atrelar cluster |
| GET | `/store-clusters` | admin | lista de clusters |
| POST | `/store-clusters` | admin | criar cluster |
| PUT | `/store-clusters/:id` | admin | renomear cluster |
| DELETE | `/store-clusters/:id` | admin | remover cluster (desatrela lojas) |

### 2.1 `GET /products/stores` — seletor de loja

```bash
curl -H "Authorization: Bearer $TOKEN" "$API/products/stores"
```

```jsonc
[
  { "storeId": "1c9e4a52-...", "storeExternalId": "12023529", "label": "Loja Centro", "active": true },
  { "storeId": null, "storeExternalId": "12023530", "label": "12023530", "active": null }  // sem match em tenant_store (ou deletada)
]
```

Array puro (sem envelope), ordenado por `label` no servidor. Os dois identificadores da loja
saem daqui — não é preciso `GET /stores` (admin) para nada nas telas de operação:

- `storeExternalId` — id externo do ERP (bigint como string): o valor do `?store=` das leituras.
- `storeId` — UUID de `core.tenant_store`: o `storeId` do `POST /products/:ean/price`.
  `null` (junto com `active: null`) quando o tenant não conhece a loja ou ela foi deletada.

Lista toda loja com linha em `product_stock`, **inclusive inativas** (`active: false`) — o
picker de escrita de preço deve oferecer só `active === true` (o POST rejeita inativa com 409,
§2.3). Nas **leituras**, loja inativa se comporta como desconhecida: o `?store=` dela devolve
os **globais vivos** (o `product_item` congelado é ignorado — o sync só mantém lojas ativas);
só o estoque continua sendo o da loja.

### 2.2 Endpoints de decisão — `?store=` (id externo)

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "$API/products/active-ingredients/crossed?store=12023529&tolerance=5&page=1&perPage=50"
```

`store` **obrigatório**, numérico 1–18 dígitos; faltando/inválido (um UUID inclusive) →
400 `"store is required (numeric store id)"`. Params opcionais: `tolerance` (0–100, default 0),
`decision` (`subir|abaixar|ok|mix|sem-estoque`), `activeIngredient` (ILIKE), `page`/`perPage`
(≤200). Demais filtros do DTO compartilhado são aceitos e **ignorados** aqui. Resposta
`Paginated<IngredientGroup>` (`{ rows, count, page, perPage }`), grupo:

```jsonc
{
  "activeIngredient": "DIPIRONA SODICA",
  "decision": "subir",                          // calculado no servidor (loja + tolerância)
  "targetPrice": 8.49,                          // menor preço > 0 do grupo (na loja)
  "priceOffer": 7.99,                           // NOVO: oferta vigente do combate (global), ou null
  "combate": { "ean": "789...", "name": "...", "price": 8.49, "cost": 4.10 },  // ou null
  "lowestCost": { "ean": "789...", "cost": 3.20 },                             // ou null
  "competitorCombate": { "origin": "DROGAL", "price": 7.99 },                  // ou null
  "variants": [{
    "ean": "789...", "name": "...", "price": 8.49, "cost": 4.10, "margin": 51.7,
    "priceOffer": null,             // NOVO: oferta vigente da variante (global)
    "stockInStore": 12,             // estoque NA loja (era stockInSubsidiary)
    "isCombate": true,
    "competitors": [{ "origin": "DROGAL", "price": 7.99 }]  // SEMPRE uma entrada por origem habilitada; price pode ser null
  }]
}
```

`price`/`cost`/`margin` das variantes (e do `combate`/`lowestCost`) são **da loja** quando ela
tem linha em `product_item`, com fallback para o global de `product`.

Aqui os valores monetários são **números JSON** (diferente de `/products` e `/products/crossed`,
onde `price`/`cost`/`margin`/`priceOffer` chegam como **strings** de numeric do Postgres —
manter o `Number()` só onde já existe). `decision-counts` (mesmos params, sem
`decision`/`page`) → `{ "subir": 42, "abaixar": 17, "ok": 389, "mix": 9, "sem-estoque": 64, "total": 521 }`.

Semântica das decisões, chips, render dos grupos: **inalterados** — seguir
`plano-frontend-filtros-active-ingredients.md` §2/§4/§5 com os renames da §4 daqui.

### 2.3 `POST /products/:ean/price` — alteração de preço por loja

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "newPrice": 19.9, "storeId": "1c9e4a52-..." }' \
  "$API/products/7891234567890/price"
```

Body: `newPrice` (número JSON ≥ 0 — string `"19.9"` dá 400) e **`storeId` obrigatório**
(UUID de `core.tenant_store`, o `storeId` de `GET /products/stores` — **não** o
`storeExternalId`). O backend resolve o `external_id` da loja e envia ao ERP como
`idUnidadeNegocioPreco`, depois espelha em `product_item` daquela loja — as leituras com
`?store=` dessa loja refletem no próximo refetch (`product.price` global não muda).
Sucesso: **201** `{ "ean": "789...", "price": 19.9, "storeId": "1c9e..." }`.

| Status | Caso | Tratamento no FE |
|---|---|---|
| 400 | body inválido / `storeId` faltando ou não-UUID / ean não numérico | bug do FE — não deve acontecer |
| 403 | viewer | esconder o botão por papel, não depender do erro |
| 404 | `"product <ean> not found"` ou `"store <storeId> not found"` (loja de outro tenant / deletada) | mensagem específica |
| 409 | `"product is monitored; price is locked"` · `"product has no ERP external_id"` · `"store <storeId> is inactive"` · `"A7Pharma API not configured for this tenant"` | mensagem específica, sem retry (igual ao plano de filtros §6) |
| 502 | `"ERP write failed"` (timeout/4xx/5xx da A7Pharma; detalhe só nos logs do servidor) — **nada mudou localmente** | "Falha ao gravar no ERP, tente de novo" |

O mesmo 502 vale para `POST`/`DELETE /products/:ean/offer` (antes a falha do ERP nesses
endpoints era um 500 genérico).

O picker de escrita só oferece lojas `active === true` (§2.1); o 409 de loja inativa é o
guarda-corpo do backend, não o fluxo normal.

### 2.4 `/stores` e `/store-clusters` (ADMIN)

```bash
curl -H "Authorization: Bearer $TOKEN" "$API/stores"
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "active": true, "clusterId": null }' "$API/stores/1c9e4a52-..."
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "Região Sul" }' "$API/store-clusters"
```

**`GET /stores`** → array (sem paginação), ordenado por `name`:

```jsonc
[{
  "id": "1c9e4a52-...",        // UUID — o storeId do POST de preço
  "externalId": "12023529",    // id do ERP — o ?store= das leituras
  "name": "Loja Centro",
  "cnpj": "12345678000199",    // só dígitos; null em linha legada
  "active": false,             // sync cria false; opt-in do admin
  "clusterId": "9f0c...",      // ou null
  "clusterName": "Região Sul"  // ou null
}]
```

**`PUT /stores/:id`** — body `{ active?: boolean, clusterId?: string | null }`;
`clusterId: null` desatrela; `{}` → 400 `"no fields to update"`; cluster inexistente/de outro
tenant → 404 `"cluster <id> not found"`; loja → 404 `"store <id> not found"`. Retorna o
`StoreApi` atualizado.

**`GET /store-clusters`** → `[{ "id", "name", "storeCount": 3, "createdAt": "...", "updatedAt": "..." }]`
(`storeCount` conta lojas atreladas, ativas ou não). **POST/PUT** body `{ name: string }`
(1–120 chars) → retorna o `StoreClusterApi`. **DELETE** faz soft-delete e **desatrela as lojas
membras** (elas não são desativadas); ⚠️ resposta é só `{ "id", "name" }` — shape diferente,
tratar no client. O backend **faz `trim()`** no create/rename, mas o `@Length(1,120)` valida
**antes** do trim: nome só-espaços passa e é gravado como `""` — bloquear no client (trim
client-side é só cosmético). **Nomes duplicados são permitidos** (sem constraint de unicidade) —
avisar, e nunca usar `name` como key.

## 3. Telas e fluxos

### 3a. Seletor global de loja

Um único seletor no shell do app (header), fonte `GET /products/stores` (cachear a lista —
ela também é o mapa `storeExternalId → storeId/label/active`). Estado na **URL** (`?store=`)
+ última loja em localStorage (mesma regra do plano de filtros §3). Incluir `store` na
factory de query keys (`qk.products({ store, ... })`, `qk.ingredientsCrossed({ store, ... })`,
`qk.decisionCounts({ store, ... })`) — trocar a loja refaz tudo automaticamente. As grades
(`/products`, `/crossed`, `/strategic-price`) **seguem o seletor** passando o mesmo `?store=`;
sem loja selecionada, omitir o param e rotular a coluna como **preço base**.

### 3b. Análise por princípio ativo — delta vs o plano anterior

A tela de `plano-frontend-filtros-active-ingredients.md` continua valendo com estes ajustes:

1. Todos os renames da §4 (rota do seletor, `?store=`, `stockInStore`, mensagem do 400).
2. `variants[].competitors` traz **sempre** uma entrada por origem habilitada do tenant, com
   `price: number | null` (origem sem dado para o EAN → `null`; renderizar célula vazia) —
   substitui as colunas fixas `drogalPrice`/`drogasilPrice` do plano antigo. Derivar as colunas
   das origens de qualquer variante (este endpoint **não tem** o campo top-level `origins` de
   `/products/crossed`).
3. Campos novos `priceOffer` (grupo = oferta vigente do combate; variante = oferta da
   variante): exibir como badge "oferta" ao lado do preço, com tooltip "oferta global —
   vale para todas as lojas".
4. O write-back do "Aplicar" usa o `storeId` (UUID) da loja selecionada, resolvido pela
   própria lista do seletor (§3c).

### 3c. Fluxo de alteração de preço (dialog)

`SinglePriceModal`/`useSetPrice` (de `plano-frontend-integracao-acoes-precificacao` §2)
passam a receber a loja:

```ts
// lib/api/products.ts
export function useSetPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ean, newPrice, storeId }: { ean: string; newPrice: number; storeId: string }) =>
      apiClient.post(`/products/${ean}/price`, { newPrice, storeId }),
    onSuccess: () => invalidateGrids(qc), // crossed + decision-counts + products
  });
}
```

- **De onde vem o `storeId`**: da própria lista do seletor global (`GET /products/stores`
  expõe o UUID + `active`; §2.1) — vale para operator e admin. Oferecer só lojas
  `active === true` para escrita.
- Dialog mostra **a loja alvo** (nome + externalId) de forma proeminente — o usuário precisa
  saber que está mudando o preço **de uma loja só**.
- Sem optimistic update: no sucesso, toast "Preço de <produto> atualizado na <loja> (ERP)" +
  invalidação de products/crossed/ingredientsCrossed/decision-counts — as queries escopadas
  na loja (`?store=`) voltam com o preço novo (o espelho em `product_item` é síncrono).
- Gating: botão visível só para operator/admin; toasts de 409/404/500 conforme tabela §2.3
  (sonner + `toastApiError`, nunca toast genérico em 409).
- ⚠️ **Aplicar em massa (`POST /pricing/apply`) continua store-blind** — muda o preço de
  **todas** as lojas. Se o usuário chegar ao apply em massa a partir de uma tela escopada
  por loja, mostrar aviso explícito "esta ação aplica o preço em todas as lojas" (B5).

### 3d. Telas ADMIN novas: Lojas e Clusters

Rota sugerida `/admin/lojas` (com aba ou rota irmã `/admin/lojas/clusters`), gate
`RequireRole('admin')` — operator/viewer nem veem o item de navegação (o backend devolve 403).

**Lojas** — tabela de `GET /stores` (lista completa, sem paginação; filtro client-side por
nome/CNPJ): colunas nome, CNPJ (formatar `00.000.000/0000-00`), externalId, cluster,
**switch `active`**. Toggle → `PUT /stores/:id { active }`, refetch da lista. Copy do
toggle importa (semântica real do backend):

- Ativar: "a loja entra no próximo sync noturno de preços/custos por loja". Reativar uma
  loja **limpa** os preços/custos por loja congelados da desativação — até o sync, as
  leituras dela mostram os globais.
- Desativar: "a loja sai dos próximos syncs; **os dados já sincronizados não são apagados**
  (ficam desatualizados)". Não é exclusão.

Atrelar cluster: select com os clusters de `GET /store-clusters` + opção "Sem cluster"
(`clusterId: null`) → `PUT /stores/:id { clusterId }`.

**Clusters** — CRUD simples sobre §2.4: lista (`name`, `storeCount`, `updatedAt`), criar,
renomear inline, excluir com confirm "as N lojas deste cluster ficarão sem cluster (não
serão desativadas)". Bloqueio de nome só-espaços e aviso de duplicado no client (§2.4).

### 3e. Preço/custo/oferta por loja nas tabelas de produtos

`/products`, `/products/crossed`, `/products/strategic-price` e `/products/export` aceitam
`?store=` (id externo, **opcional**):

- Com `store`: `price`/`cost` são os da loja (`product_item`), com fallback para o global
  **vivo** quando a loja não tem preço próprio no ERP (o sync não grava cópia); `margin` é
  recalculada sobre eles. A **ordenação** por `price`/`cost`/`margin` segue o valor efetivo
  exibido. Loja desconhecida, deletada ou **inativa** não é erro — só devolve os globais.
  `store` não numérico → 400 `"store must be a numeric store id"` (mensagem diferente da dos
  endpoints de decisão, §2.2).
- Sem `store`: tudo global — rotular a coluna como **"Preço base"**.
- `priceOffer` (crossed/strategic-price/grupos): global por construção — exibir sem
  ressalva de loja.
- Outros dados por loja: `stockInStore` (decisão) e `ownByStore` em `/products/stock`
  (`{ "<storeExternalId>": qty }` — mapear ids para labels via o cache do seletor).

## 4. Migração de contrato (renames `subsidiary` → `store` + quebra do POST price)

O backend renomeou tudo no PR #56 / commit `e69dfee`; os planos FE antigos usam o naming
morto. Tabela completa do que afeta código FE existente:

| Antigo (planos/código FE) | Novo (backend atual) | Tipo |
|---|---|---|
| `GET /products/subsidiaries` | `GET /products/stores` | rota |
| resposta `[{ subsidiaryExternalId, label }]` | `[{ storeId, storeExternalId, label, active }]` | campo |
| query param `?subsidiary=` (crossed/decision-counts) | `?store=` | param |
| 400 `"subsidiary is required..."` | 400 `"store is required (numeric store id)"` | mensagem (se o FE faz match) |
| `variants[].stockInSubsidiary` | `variants[].stockInStore` | campo |
| `variants[].drogalPrice` / `drogasilPrice` | `variants[].competitors: [{ origin, price }]` | shape |
| — | `priceOffer` no grupo e na variante | campo novo (aditivo) |
| `/products/stock` campo `ownBySubsidiary` | `ownByStore` | campo |
| `POST /products/:ean/price` body `{ newPrice }` | **`{ newPrice, storeId }` — `storeId` UUID obrigatório**; sem ele → 400 | **QUEBRA** |
| resposta do POST `{ ean, price }` | `{ ean, price, storeId }` | campo |
| erros do POST: 409×3 | + **404 `"store <storeId> not found"`**, **409 `"store <storeId> is inactive"`** e **502 `"ERP write failed"`** (também nos endpoints de oferta) | erro novo |
| `GET /products/stock?sortBy=book\|priceOffer` → 500 | sort inválido para a tela é **ignorado** (ordem default por ean) | correção de bug |
| — | `?store=` opcional em `/products`, `/crossed`, `/strategic-price`, `/export` (preço/custo da loja) | param novo (aditivo) |

⚠️ O `ValidationPipe` global roda com `forbidNonWhitelisted`: param/campo desconhecido —
inclusive o antigo `?subsidiary=` — dá **400** `"property subsidiary should not exist"`, não é
ignorado. Como o estado de loja é persistido em URL/localStorage (§3a), **purgar** qualquer
`subsidiary` persistido na migração; nunca enviar os dois params.

`tolerance`, `decision`, `activeIngredient`, paginação e a semântica das decisões **não
mudaram**. A collection Postman do repo backend já traz o `storeId` no `POST
/products/:ean/price`, mas ainda não tem os endpoints de stores; a versão completa está no
branch `chore/postman-store-endpoints`.

## 5. Pendências backend (não contornar no FE — são bugs/lacunas de contrato)

> Da lista original, **B1–B4 e B6 já foram corrigidas** no backend (branch
> `cinegagliamarco/multistore-prices`) e o contrato acima já as reflete: UUID + `active` em
> `GET /products/stores` (B1/B3, com ordenação por label e lojas deletadas sem match),
> leituras projetando `product_item` via `?store=` (B2, com loja inativa caindo nos globais
> vivos), 409 para loja inativa no POST de preço (B4) e falha do ERP como 502 distinguível
> (B6). Uma migração tenant one-off anula os snapshots legados de `product_item.price`
> (cópias do preço global feitas pelo sync antigo); o sync noturno seguinte repõe os preços
> por loja genuínos do ERP. Resta:

- **B5 — RESOLVIDO** (branch `cinegagliamarco/regra-preco-por-loja`): `storeId` opcional no
  `ApplyItemDto`, sugestão/guarda-corpos/rollback/agendamento store-aware, regras de sugestão
  com `storeIds`, e oferta por loja via caderno vencedor. Contrato completo em
  [`plano-regras-preco-por-loja-2026-07-09.md`](./plano-regras-preco-por-loja-2026-07-09.md).
  O aviso do §3c ("aplica em todas as lojas") só vale para itens SEM `storeId`.

## 6. Dados e frescor (para a UI comunicar staleness)

| Dado | Fonte | Frescor |
|---|---|---|
| `price`/`cost` das grades **sem** `?store=` | `product` (global) | sync noturno (pipeline inicia 00:00 UTC; termina conforme o tamanho do catálogo) |
| `price`/`cost` **com** `?store=` (grades e decisão) | `product_item` da loja, fallback `product` | sync noturno (última etapa do run), só lojas **ativas**; espelhado na hora pelo POST de preço |
| `margin` (com ou sem `?store=`) | **recalculada ao vivo** a cada leitura sobre preço/custo efetivos + oferta crua do `offer_book` (mesma fórmula do cálculo noturno, 4 casas) | imediata — reflete edições de custo, ofertas e applies no mesmo instante; pode divergir do `p.margin` armazenado que os endpoints de `/pricing` ainda usam |
| `status` / `averageVariation` | `product` (global, cálculo noturno sobre o preço **global**) | sync noturno — ⚠️ ao lado de um preço por loja divergente, o status pode não corresponder ao preço exibido |
| `priceOffer` | `offer_book` vigente (join com campanha) — **global por EAN** | reflete `POST /products/:ean/offer` imediatamente **só se** o caderno já for campanha ativa e vigente em `tenant_offer_campaign`; senão a oferta fica gravada mas as leituras projetam `null` até a campanha ativar/sincronizar; idêntico em todas as lojas |
| `stockInStore` / `ownByStore` | `product_stock` por id externo | sync noturno; loja sem linha → 0 |
| lista de lojas do seletor | `DISTINCT product_stock` + `tenant_store` | só lojas com estoque sincronizado; inclui inativas (`active: false` — filtrar no picker de escrita); deletadas vêm sem `storeId` |
| lojas/clusters (admin) | `core.tenant_store` / `store_cluster` | tempo real; `active` nunca é sobrescrito pelo sync (toggle é definitivo até o admin mudar) |

Regras de copy derivadas: (1) loja **desativada** não expõe dados congelados — as leituras
dela caem nos globais vivos (e a escrita dá 409), então basta o picker de escrita filtrar
`active`; (2) preço alterado via dialog aparece nas leituras da loja no próximo refetch — o
preço **base** (global) não muda; (3) oferta é sempre global — nunca prometer oferta por loja.

## 7. Critérios de sucesso

O usuário escolhe uma loja no seletor global e vê preços, custos, margens, decisões e
estoques **daquela loja** nas grades e na análise por princípio ativo; um operator/admin
altera o preço de um produto naquela loja pelo dialog (com o `storeId` vindo do próprio
seletor) e vê o valor novo no refetch, com feedback específico por erro (404 loja,
409 monitored/inativa/API, 502 ERP); o admin ativa/desativa lojas e gerencia clusters nas
telas novas entendendo que ativar = entrar no sync e desativar ≠ apagar; e sem loja
selecionada as grades rotulam o valor como "preço base".
