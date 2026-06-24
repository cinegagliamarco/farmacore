# Plano de Implementação — Integrar a API de ação de precificação nas telas existentes

> **Data:** 2026-06-23 · **Backend:** `src/tenant-api/catalog/*` + `src/tenant-api/pricing/*` (PRs #34/#35; endpoints na collection Postman, PR #36) · **FE:** repositório separado.
>
> **O que este plano é:** como **plugar a API de ação** (alterar preço, alterar preço de oferta, **aplicar em massa**, **agendar**) nas **3 telas que já existem** — Produtos cruzados, Sugestão de preços e Princípio ativo. As telas, suas grades, o `apiClient`, o auth e os hooks de leitura **já estão prontos**; aqui só adicionamos as ações.
>
> **O que NÃO é:** não re-especifica os endpoints de leitura (`/products/crossed`, `/pricing/suggestions`, `/products/active-ingredients/*`) nem manda construir tela. Se precisar do contrato de leitura, ele está no código e no doc anterior das telas.
>
> **Premissa de integração:** cada linha das grades já tem o `ean` (e, onde houver, o `targetPrice`/preço sugerido). É só disso que as ações precisam.

---

## 1. A API de ação (o que entra nas telas)

Quatro capacidades. Todas tenant-scoped pelo JWT (o FE **não** passa `:slug`), mutações exigem `operator`/`admin`.

| Capacidade | Endpoint(s) | Onde aparece |
|---|---|---|
| **Alterar preço** (1 produto) | `POST /products/:ean/price` | linha das 3 telas |
| **Alterar preço de oferta** (1 produto) | `POST /products/:ean/offer`, `DELETE /products/:ean/offer` | linha das 3 telas |
| **Aplicar em massa** | `POST /pricing/apply` (+ `/preview`, `/:id`, `/:id/approve`, `/:id/reject`, `/:id/rollback`, `GET /pricing/apply`) | seleção em massa das 3 telas |
| **Agendar** (one-shot/recorrente/recalc) | `POST /pricing/schedules` (+ `GET`, `GET /:id`, `DELETE /:id`) | seleção em massa das 3 telas |

As ações single (`/price`, `/offer`) **empurram direto ao ERP A7Pharma e espelham local** — efeito imediato e síncrono. O apply em massa cria um **run assíncrono** (202 → polling). O schedule grava e o cron dispara no `runAt`.

> **Diferença que governa toda a UI:** `precoVenda` (alterar preço) vs `precoOferta` (alterar preço de oferta) é a mesma dualidade em todos os fluxos — single (`/price` vs `/offer`) e massa (campo `target` do item). Trate como a escolha central do usuário em cada ação.

---

## 2. Camada de ação compartilhada (implementar uma vez)

É o grosso do trabalho e as 3 telas reusam. Sugestão de arquivo: `src/features/pricing-actions/` no FE. Quatro componentes + os hooks + os tipos + o tratamento de erro.

### 2.1 Tipos

```ts
type ApplyTarget = 'precoVenda' | 'precoOferta';

interface ApplyItem {
  ean: string;                 // EAN numérico (string)
  target: ApplyTarget;
  price: number;               // >= 0; preço congelado/override do operador
  cadernoId?: number;          // int >= 1; só precoOferta; derivado do offer_book se omitido
}

interface ApplyRejection { ean: string; reason: string }
// reason (resposta síncrona): nao_encontrado | sem_custo | preco_invalido |
//   abaixo_do_piso | variacao_excessiva | acima_do_venda | sem_caderno

interface ApplyResponse {
  applyRunId: string;
  accepted: number;
  rejected: ApplyRejection[];
  idempotent?: boolean;        // true só em reenvio com a mesma idempotencyKey
  approvalStatus?: 'pending';  // só quando PRICING_APPLY_REQUIRES_APPROVAL='1' e há aceitos
}

interface ApplyPreview {
  total: number;
  accepted: { ean: string; target: string; price: number; basis: string | null }[];
  rejected: ApplyRejection[];
  wouldAbort: boolean;         // true se o circuit breaker barraria o lote real
}

type RunStatus = 'pending' | 'running' | 'done' | 'failed';
type ScheduleStatus = 'pending' | 'fired' | 'cancelled';

interface ScheduleView {
  id: string; runAt: string; status: ScheduleStatus;
  applyRunId: string | null; itemCount: number;   // NUNCA os items, só a contagem
  cronExpr: string | null; recalc: boolean; createdAt: string;
}
```

### 2.2 `SinglePriceModal` — alterar preço (1 produto)

- **Endpoint:** `POST /products/:ean/price`, body `{ newPrice: number }` (`>= 0`). Sucesso **201** `{ ean, price }`.
- **Pré-preenche** com o preço atual da linha.
- **Erros (exibir a `message` do corpo):** **409** `'product is monitored; price is locked'` (produto travado), `'product has no ERP external_id'`, `'A7Pharma API not configured for this tenant'`; **404** `'product {ean} not found'`; **400** `newPrice` negativo ou `:ean` não-numérico.

```ts
function useSetPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ean, newPrice }: { ean: string; newPrice: number }) =>
      apiClient.post(`/products/${ean}/price`, { newPrice }),
    onSuccess: () => { toast.success('Preço atualizado'); invalidateGrids(qc); },
    onError: toastApiError, // 409 ⇒ exibir message (oferecer destravar)
  });
}
```

### 2.3 `OfferModal` — alterar preço de oferta (1 produto)

- **Upsert:** `POST /products/:ean/offer`, body `{ targetPrice: number>=0, cadernoId: number, description?: string(1..500) }`. **201** `{ ean, targetPrice, cadernoId }`. **Não** checa `monitored`.
- **Remover:** `DELETE /products/:ean/offer`. **200** `{ ean, deleted: true }`. **404** se não há oferta local.
- **Erros:** **409** `'product has no ERP external_id'` / `'offer has no caderno id'` / `'A7Pharma API not configured for this tenant'`; **400** validação.

```ts
function useUpsertOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ean, ...body }: { ean: string; targetPrice: number; cadernoId: number; description?: string }) =>
      apiClient.post(`/products/${ean}/offer`, body),
    onSuccess: () => { toast.success('Oferta salva'); invalidateGrids(qc); },
    onError: toastApiError,
  });
}
function useDeleteOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ean: string) => apiClient.delete(`/products/${ean}/offer`),
    onSuccess: () => { toast.success('Oferta removida'); invalidateGrids(qc); },
    onError: toastApiError,
  });
}
```

### 2.4 `ApplyPricesModal` — aplicar em massa (preview → run → polling → aprovação/rollback)

Recebe `ApplyItem[]` (montado pela tela a partir da seleção). Fluxo:

1. **Preview** `POST /pricing/apply/preview` `{ items }` → **200** `ApplyPreview`. Mostre `accepted`/`rejected`; **bloqueie "Aplicar" se `wouldAbort`** (o apply real retornaria 422).
2. **Aplicar** `POST /pricing/apply` `{ idempotencyKey, mode: 'agora', items }` → **202** `ApplyResponse`.
3. **Polling** `GET /pricing/apply/:id` (a cada 2s) até `status` virar `done`/`failed`.
4. Se `approvalStatus === 'pending'` (env `PRICING_APPLY_REQUIRES_APPROVAL='1'`): o run **não despacha** até `POST /pricing/apply/:id/approve` (**ADMIN**); sinalize "aguardando aprovação". `reject` (ADMIN) descarta.

| Endpoint | Roles | Sucesso | Erros |
|---|---|---|---|
| `POST /pricing/apply/preview` | operator, admin | 200 `ApplyPreview` | 400 |
| `POST /pricing/apply` | operator, admin | **202** `ApplyResponse` | 400; **422** circuit breaker |
| `GET /pricing/apply/:id` | operator, admin | 200 `ApplyReport` (items paginado) | 400, 404 |
| `POST /pricing/apply/:id/approve` | **admin** | **202** | 404; **409** se não está `pending` |
| `POST /pricing/apply/:id/reject` | **admin** | **200** | 404; **409** |
| `POST /pricing/apply/:id/rollback` | operator, admin | **202** (NOVO run) | 404; **422** nada reversível |

- **`idempotencyKey`:** estável por intenção, mas inclua um componente único por abertura do modal (uuid) — a chave é UNIQUE global no tenant; reenvio com a mesma key devolve o run existente (`idempotent: true`, `rejected: []`), nunca 500.
- **422 (circuit breaker, ≥10 itens e >50% rejeitados):** corpo `{ message, aborted: true, rejected: ApplyRejection[] }` (lista **populada**); nenhum run criado. Liste os rejeitados — exige o `ApiError` preservar o corpo (ver §5).
- **Relatório paginado sem count:** `GET /pricing/apply/:id?page&perPage` (default perPage **100**, máx 200, `ORDER BY ean`). Sem `count` próprio: total de itens = `applied+skipped+failed`; "tem próxima" por `items.length === perPage`.

```ts
const TERMINAL: RunStatus[] = ['done', 'failed'];
function useApplyRun(id?: string, page = 1, perPage = 100) {
  return useQuery({
    queryKey: ['pricing', 'apply', id, page, perPage],
    queryFn: () => apiClient.get<ApplyReport>(`/pricing/apply/${id}?page=${page}&perPage=${perPage}`),
    enabled: !!id,
    refetchInterval: (q) => (TERMINAL.includes(q.state.data?.status as RunStatus) ? false : 2000),
  });
}
function useApplyPreview() {
  return useMutation({ mutationFn: (items: ApplyItem[]) =>
    apiClient.post<ApplyPreview>('/pricing/apply/preview', { items }), onError: toastApiError });
}
function useApplyPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { idempotencyKey: string; mode?: 'agora'; items: ApplyItem[] }) =>
      apiClient.post<ApplyResponse>('/pricing/apply', b),
    onSuccess: (r) => {
      if (r.approvalStatus === 'pending') toast.info('Run aguardando aprovação');
      qc.invalidateQueries({ queryKey: ['pricing', 'apply'] }); invalidateGrids(qc);
    },
    onError: toastApiError, // 422 ⇒ err.body.rejected
  });
}
// approve/reject/rollback: mutations análogas; approve/reject gateados por admin.
```

### 2.5 `ScheduleModal` — agendar (one-shot / recorrente / recalc)

- **Criar:** `POST /pricing/schedules` `{ runAt /* ISO UTC */, items: ApplyItem[], cronExpr?, recalc? }` → **201** `ScheduleView`.
- **`runAt`/`cronExpr` são UTC** — converta do fuso local explicitamente ao montar e exibir.
- **`cronExpr` presente** ⇒ recorrente (re-arma; nunca vira `fired`). Ausente ⇒ one-shot.
- **`recalc: true`** ⇒ no disparo o motor recalcula preço **e** target, ignorando os congelados; itens sem sugestão são descartados (pode aplicar menos que `itemCount`, ou zero → `applyRunId` null).
- **Cancelar:** `DELETE /pricing/schedules/:id` → **200** `{ id, cancelled }`; **409** se já `fired`/`cancelled`.
- **400** se `cronExpr` inválido (`'cron inválido: {expr}'`) ou `items` vazio/>5000.
- **Não envie `requestedBy`** (vem do JWT; campo extra → 400 por `forbidNonWhitelisted`).

```ts
function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { runAt: string; items: ApplyItem[]; cronExpr?: string; recalc?: boolean }) =>
      apiClient.post<ScheduleView>('/pricing/schedules', b),
    onSuccess: () => { toast.success('Agendamento criado'); qc.invalidateQueries({ queryKey: ['pricing', 'schedules'] }); },
    onError: toastApiError,
  });
}
```

### 2.6 Tratamento de erro e códigos (princípio único)

Adicione ao handler de erro da app:

- **201/202** = sucesso (202 ⇒ assíncrono, inicie polling). Não trate POST como 200-ou-erro.
- **409** = conflito de estado: `monitored` (preço travado), sem `external_id`, sem credencial A7Pharma, approval não-`pending`, schedule já `fired`. Exiba a `message`; ofereça o caminho de saída (destravar via `PATCH /products/:ean { monitored:false }`; configurar integração).
- **422** = regra de negócio (circuit breaker / nada reversível). Ler o corpo (`rejected`), **não** retry cego.
- **404** = produto/oferta/run inexistente.
- **400** = validação (whitelist estrita: nunca vazar campo de UI no body).

`invalidateGrids(qc)` deve invalidar as queries das 3 telas (`['products']`, `['active-ingredients']` e `['suggestions']`) — as ações de preço/oferta afetam todas.

### 2.7 Auditoria (opcional)

Quem quiser um drawer de histórico: `GET /pricing/audit` (**ADMIN-only** → gatear por admin, não só esconder), filtro exato por `entity`/`entityId`, array cru ordenado por `created_at` DESC. Ações gravadas por estes fluxos: `apply`, `apply_pending`, `approve`, `reject`, `rollback` (entidade `apply_run`); `schedule_create`, `schedule_cancel` (entidade `schedule`).

---

## 3. Integração por tela (o que adicionar em cada tela existente)

A grade e a leitura já existem. Para cada tela: ações por linha + seleção/barra de ação em massa + o mapeamento da linha → `ApplyItem`.

### 3.1 Produtos cruzados

- **Ações por linha** (menu/kebab por produto, chave = `ean`): Alterar preço (`SinglePriceModal`), Criar/editar oferta e Remover oferta (`OfferModal` — Remover só quando há `targetPrice`), Editar campos (`PATCH /products/:ean`, inclui destravar `monitored:false`), Excluir (soft, **admin**).
- **Pré-desabilite "Alterar preço" quando `row.monitored`** (a linha já traz a flag) com tooltip "preço travado" — evita o 409 previsível.
- **Seleção em massa:** checkbox por linha + "selecionar página" → barra com **Aplicar preços** e **Agendar**. Mapeie cada linha selecionada:

```ts
function rowToApplyItem(row: CrossedRow, target: ApplyTarget): ApplyItem {
  return {
    ean: row.ean,
    target,
    price: target === 'precoVenda' ? Number(row.price) : Number(row.targetPrice),
    // cadernoId omitido p/ precoOferta: o service deriva do offer_book
  };
}
```
Para `precoVenda`, avise/filtre as linhas `monitored` antes de enfileirar (o worker as pula).

### 3.2 Sugestão de preços

- A linha já traz a sugestão do motor (`result`). **Selecionável só quando `result.kind === 'suggestion'`.**
- **Ação por linha:** "Ajustar preço (override)" guarda um `price` local; "Aplicar só esta" abre o `ApplyPricesModal` com 1 item.
- **Mapeamento:** `target` vem do **motor** (`suggestion.target`), não do usuário; `price` = override ?? `suggestion.price`.

```ts
function suggestionToApplyItem(row: SuggestionRow, override?: number): ApplyItem {
  const s = row.result.suggestion; // garantido kind==='suggestion'
  return { ean: row.product.ean, target: s.target, price: override ?? s.price };
}
```
- **Agendar com `recalc: true`** é o caso natural aqui ("aplicar o preço do motor no momento do disparo", não o que está na tela).

### 3.3 Princípio ativo

- As ações partem de uma **variante** do grupo (cada `variant.ean`). As variantes **não trazem `monitored`** → não dá para pré-desabilitar "Alterar preço"; **reaja ao 409** exibindo a mensagem e oferecendo destravar (`PATCH /products/:ean { monitored:false }`).
- **Seleção em massa:** marque variantes em um ou vários grupos → `ApplyPricesModal`/`ScheduleModal`. Mapeie `variant → ApplyItem` (mesmo shape; `target` escolhido no modal).
- O painel "genéricos sem princípio ativo" já existe; sua ação (`PATCH /products/:ean { activeIngredient }`) é catálogo, não desta API de ação — fora deste plano.

> Em todas as telas, o estado de seleção deve ser um `Map<\`${ean}:${target}\`, ApplyItem>` e o item enviado deve conter **só** `{ean,target,price,cadernoId?}` (campo extra → 400). O backend **não** deduplica.

---

## 4. Checklist de integração

**Camada compartilhada (uma vez):**
- [ ] Tipos (`ApplyItem`/`ApplyResponse`/`ApplyPreview`/`ScheduleView`).
- [ ] `SinglePriceModal` + `useSetPrice`.
- [ ] `OfferModal` + `useUpsertOffer`/`useDeleteOffer`.
- [ ] `ApplyPricesModal` (preview → 202 → `useApplyRun` polling → approve/reject/rollback).
- [ ] `ScheduleModal` + `useCreateSchedule` (UTC, cron, recalc).
- [ ] Handler de erro (201/202/409/422/400) + `ApiError` preservando o corpo.
- [ ] `invalidateGrids` cobrindo `products`/`active-ingredients`/`suggestions`.

**Por tela:**
- [ ] Produtos cruzados — ações por linha + seleção em massa + `rowToApplyItem`.
- [ ] Sugestão de preços — seleção só de linhas com sugestão + override + `suggestionToApplyItem` (+ schedule recalc).
- [ ] Princípio ativo — ações por variante + seleção em massa (reagir ao 409 de monitored).
- [ ] Gating por role: mutações operator/admin; approve/reject/excluir admin.

---

## 5. Decisões/lacunas relevantes a esta API

- **[P1] `ApiError` precisa expor o corpo JSON bruto** (`err.body`), não só `message` — o 422 do circuit breaker traz `rejected[]` que o `ApplyPricesModal` precisa listar.
- **[P1] Aprovação obrigatória** (`PRICING_APPLY_REQUIRES_APPROVAL`): a UI precisa lidar com `approvalStatus: 'pending'` (run não despacha até admin aprovar). É a única sinalização em runtime — não dá para saber a priori se o ambiente exige aprovação.
- **[P2] `idempotencyKey` é UNIQUE global no tenant** — inclua uuid por abertura do modal, senão dois lotes idênticos no mesmo instante colidem (segundo vira `idempotent:true` silencioso).
- **[P2] Pós-disparo do agendamento:** `ScheduleView` só dá `status`/`applyRunId`/`itemCount` (nunca os items). `fired` + `applyRunId != null` → linkar `GET /pricing/apply/:applyRunId`; `null` → "nada aplicado (recalc descartou)". Recorrente nunca vira `fired` e `applyRunId` reflete só a última execução.
- **[P2] Banner global "A7Pharma não configurada":** o 409 `'A7Pharma API not configured for this tenant'` mata preço/oferta/apply nas 3 telas — trate uma vez (banner/estado global) em vez de por modal.
- **[P3] `monitored` no apply em massa:** o apply síncrono **não** rejeita por `monitored` (vira `reason` no relatório do worker). Para `precoVenda`, avise antes; o single `/price` retorna 409 imediato.
