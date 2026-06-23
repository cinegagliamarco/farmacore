# Plano de Implementação — Frontend de Precificação (Farmacore)

> **Data:** 2026-06-23  ·  **Backend de referência:** PR #35 (`cinegagliamarco/pricing-policies-history-approval`) + Fase 1–3 já mergeadas (#33/#34).  ·  **Repositório do FE:** separado deste repo (o farmacore é só backend).
>
> Este plano cobre TODAS as telas/fluxos que consomem o módulo de precificação do farmacore: **Regras de Sugestão**, **Clusters**, **Sugestão de Precificação** (portadas do app legado *pricy*) e os fluxos **NET-NEW** sem precedente no legado — **Aplicar em massa**, **Agendamentos** (recorrência/recálculo), **Auditoria** e o **fluxo de Aprovação**.
>
> **Como foi gerado:** workflow multi-agente (13 agentes) que leu a superfície de API e os contratos do backend NestJS, o frontend React legado (`pricy-shelf/florence/artifacts/pricy`) e as decisões do plano de backend (`plano-pricing-suggestion-port-2026-06-22.md`, §14/§17/§17-bis/§18). O Apêndice traz o material de referência cru (catálogo de endpoints, contratos de dados, arqueologia da UI legada, decisões em aberto).

---

# Parte I — Enquadramento

I have confirmed the load-bearing details: no global prefix, no CORS config, no custom exception filter (so default NestJS error envelopes `{statusCode, message, error}`), and the `whitelist + forbidNonWhitelisted + transform` ValidationPipe. Now I'll write the framing sections.

---

# Plano de Frontend — Pricing (Farmacore) · Seções de enquadramento

> Estas seções costuram as telas/fluxos já especificados por outros agentes (Fundação, Regras, Clusters, Sugestões, Aplicar em massa, Agendamentos, Auditoria, Migração de contrato). Aqui está o "porquê", a arquitetura comum e as convenções transversais. Onde uma seção específica já decidiu detalhe de tela, **não repetimos** — apontamos.

---

## 1. Resumo executivo

O backend de pricing está **entregue e testado, mas o valor ao usuário é zero**: nenhuma tela consome o contrato. Há ~25 endpoints REST (`/pricing/*`, NestJS multi-tenant por JWT) cobrindo regras de sugestão, clusters, motor de sugestão, aplicação em massa assíncrona, agendamento recorrente, auditoria e aprovação — e a única UI existente (no repo legado `pricy-shelf`) **quebra inteira no corte**: o Zod do hook de produtos rejeita o novo shape (`competitors[]` genérico, sem `id`/`curve`, `null` em numéricos) em vez de degradar.

**O que o FE entrega:** uma aplicação React nova que substitui a tela legada e desbloqueia tudo que hoje é só API:

1. **Porta as 3 telas existentes** ao novo contrato — Regras de Sugestão, Clusters, Sugestão de Precificação — absorvendo a generalização para N origens de concorrente e a `result` como union discriminada.
2. **Cria 6 fluxos net-new** sem precedente no legado — Aplicar em massa (com preview, report assíncrono e rollback), Agendamentos (one-shot + recorrente + recálculo), Auditoria, Aprovação, Histórico/Rollback e Dry-run de regra. Esses fluxos só existem porque o backend deixou de empurrar preço direto ao ERP e passou a ter *runs* rastreáveis.
3. **Expõe as flags de política** que o backend tornou configuráveis (`blockPbmInMargin`, `cascadeByPriority` por regra; `recalc`/`cronExpr`/`max_items`/`max_variation_pct` por schedule) e **reage aos estados de ambiente** (aprovação obrigatória, retenção de runs).

**Critério de sucesso:** um operador consegue, do navegador, gerar sugestões → revisar/ajustar → aplicar (ou agendar) → acompanhar o run item-a-item → desfazer se preciso; um admin consegue aprovar/rejeitar e auditar. Tudo que hoje exige um `curl` autenticado.

**Princípio guia (CLAUDE.md):** simplicidade acima de tudo. Sem abstração prematura — espelhamos o legado pricy onde o design já está validado e só reescrevemos o que o contrato força. O leitor-alvo é um humano cansado às 23h.

---

## 2. Arquitetura do app

**Stack:** React + TypeScript · **react-router-dom v7** · **TanStack Query** (server-state) · **react-hook-form + zod** (forms/validação) · **@tanstack/react-virtual** (tabela de sugestões) · **shadcn/ui sobre Radix + Tailwind** · **sonner** (toasts) · **fetch** nativo (sem axios). É a stack do legado pricy, com o contrato migrado.

### Estrutura de pastas

```
src/
  app/
    router.tsx              # createBrowserRouter, rotas + guards por role
    AppShell.tsx            # layout: sidebar + topbar + <Outlet/>
    providers.tsx           # QueryClientProvider, AuthProvider, Toaster
  lib/
    apiClient.ts            # fetch wrapper: Bearer, baseURL, parse de erro, retry 5xx
    auth.ts                 # token store (localStorage), decode JWT, refresh
    queryKeys.ts            # fábrica central de chaves (ver §5)
    format.ts               # moeda BRL, percentual, datas pt-BR
    money.ts                # numeric-string do PG → number seguro
  types/
    pricing.ts              # tipos do contrato (espelham data-contracts; ver §4)
    competitor-origin.ts    # enum CompetitorOrigin + labels
  hooks/                    # um hook por recurso, sobre TanStack Query
    useSuggestions.ts  useSuggestionRules.ts  useClusters.ts
    useApply.ts  useSchedules.ts  useAudit.ts
  features/
    suggestions/            # tela + dialogs + células (EditableCell, MarginCell)
    rules/                  # tabela + RegraSugestaoDialog
    clusters/               # tabela + ClusterDialog
    apply/                  # preview, run report (polling), rollback
    schedules/              # lista + form (one-shot/recorrente/recalc)
    audit/                  # tabela read-only (admin)
  components/ui/            # shadcn primitives
  components/               # PageHeader, TablePagination, SeverityPill, RoleGate...
```

Regra de arquivo (CLAUDE.md): um recurso = um hook + uma pasta de feature. Não criar camada de "service" sobre o `apiClient`; o hook chama o client direto.

### Roteamento (react-router v7)

`createBrowserRouter` com layout aninhado. Todas as rotas de pricing ficam sob um shell autenticado; o gate de role é declarativo na própria árvore.

```
/login                              → público
/  (AppShell, requer JWT)
  /pricing/suggestions              → Sugestão de Precificação   [operator, admin]
  /pricing/rules                    → Regras de Sugestão          [operator, admin]
  /pricing/clusters                 → Clusters                    [operator, admin]
  /pricing/apply                    → Histórico de runs           [operator, admin]
  /pricing/apply/:id                → Relatório do run            [operator, admin]
  /pricing/schedules                → Agendamentos                [operator, admin]
  /pricing/audit                    → Auditoria                   [admin]
```

- O fluxo "Aplicar em massa" **não é uma rota própria**: nasce como dialog/sheet dentro de `/pricing/suggestions` (seleção → preview → apply → 202) e converge para `/pricing/apply/:id` para acompanhar o run. Aprovação/rollback são ações dentro de `/pricing/apply/:id`.
- O dialog de preview de regra (dry-run) vive dentro de `/pricing/rules` e `/pricing/suggestions` — não tem rota.

### Shell e navegação por role

`AppShell` = sidebar com os links acima + topbar (tenant/usuário, logout). A sidebar **filtra os links pelo role do JWT**: `viewer` não vê nada de pricing (todas as rotas exigem ≥ operator); só `admin` vê o link de Auditoria. O guard é redundante por segurança — esconder o link é UX, o `RoleGate` na rota é a barreira real (§6).

---

## 3. Mapa de telas → endpoints

| Tela / Fluxo | Rota FE | Endpoints consumidos | Role |
|---|---|---|---|
| **Sugestão de Precificação** | `/pricing/suggestions` | `GET /pricing/suggestions`; `POST /pricing/suggestions/preview` (dry-run de regra); `POST /pricing/apply/preview` (pré-check do lote) | operator, admin |
| **Regras de Sugestão** (CRUD) | `/pricing/rules` | `GET/POST /pricing/suggestion-rules`; `PATCH/DELETE /pricing/suggestion-rules/:id`; `POST /pricing/suggestions/preview` | operator, admin |
| **Clusters** (CRUD + EANs) | `/pricing/clusters` | `GET /pricing/clusters`; `GET /pricing/clusters/:id`; `POST/PATCH/DELETE /pricing/clusters/:id` | operator, admin |
| **Aplicar em massa** (dialog) | dentro de `/pricing/suggestions` | `POST /pricing/apply/preview`; `POST /pricing/apply` (→202) | operator, admin |
| **Histórico de runs** | `/pricing/apply` | `GET /pricing/apply?page&perPage` | operator, admin |
| **Relatório do run** | `/pricing/apply/:id` | `GET /pricing/apply/:id?page&perPage` (polling); `POST /pricing/apply/:id/rollback`; `POST /pricing/apply/:id/approve`; `POST /pricing/apply/:id/reject` | operator, admin (approve/reject: **admin**) |
| **Agendamentos** | `/pricing/schedules` | `GET /pricing/schedules`; `GET /pricing/schedules/:id`; `POST/DELETE /pricing/schedules/:id` | operator, admin |
| **Auditoria** | `/pricing/audit` | `GET /pricing/audit?entity&entityId&page&perPage` | **admin** |
| **Auth** (login/sessão) | `/login` + shell | `POST /auth/login`; `POST /auth/refresh`; `POST /auth/logout`; `GET /auth/me` | público / autenticado |

Notas que o FE deve respeitar (do api-surface): **sem global prefix** (paths são exatos), **sem `:tenant` na URL** (tenant vem do JWT), `POST /pricing/apply` retorna **202**, e as ações `approve`/`reject`/`rollback` também são `202`/`200`/`202`.

---

## 4. Modelo de dados e tipos compartilhados

A fonte de verdade é o documento **data-contracts** (extraído verbatim do backend). `src/types/pricing.ts` espelha aqueles tipos; não reinventar shapes. Pontos que o FE precisa absorver explicitamente:

- **`CompetitorOrigin` tem 9 valores MAIÚSCULOS** (`DROGAL, DROGASIL, PAGUE_MENOS, IKESAKI, MICHELASSI, PACHECO, SAO_PAULO, VENANCIO, INDIANA`), não 3 minúsculos. O tenant habilita um subconjunto; **a fonte do que renderizar é `product.competitors[]`** (uma entrada por origem habilitada, já em ordem `priority ASC, origin ASC`). Não hard-codear origens. (Decisão de layout ainda aberta — §12.)
- **`SuggestionResult` é uma union discriminada** por `kind` (`'suggestion' | 'none'`). Sempre cheque `result.kind` antes de ler `.suggestion`/`.reason`. Os 7 motivos de `none` e os 3 valores de `basis` viram labels pt-BR (§8).
- **Numéricos vêm como `string` do Postgres** em `ApplyReportItem` (`price`, `priceOld`, `cadernoId`) — converter na borda via `money.ts`, nunca fazer aritmética com a string crua. Nas demais responses os services já normalizam para `number`.
- **Chave de domínio ponta-a-ponta = EAN.** Seleção, overrides e apply são por EAN (não há mais `productId` numérico no contrato). A limpeza de seleção entre páginas/filtros é por `Set<ean>`.
- **`SuggestionRuleApi`** ganhou `blockPbmInMargin` e `cascadeByPriority` e **perdeu `priceRoundingTypeId`** — o form de regra é portado mas com esses 3 deltas.

Os zods de validação de **forms** (regra, cluster, schedule, item de apply) espelham as constraints dos DTOs (§6.2 dos contratos). Os zods de **parse de resposta** ficam frouxos onde o backend é a borda confiável (ex.: `result`/`origem` como `z.unknown()` discriminado por `kind`), seguindo CLAUDE.md: validar só na fronteira de entrada do usuário, confiar no contrato interno.

---

## 5. Estado e data-fetching (TanStack Query)

**Server-state mora todo no TanStack Query.** Nada de duplicar resposta de API em `useState`. O único estado local relevante é UI efêmera: filtros da tela de sugestões, `Set<ean>` de seleção, `Map<ean, override>` de preços editados, e o estado dos dialogs.

### Fábrica de chaves (`queryKeys.ts`)

Chaves estruturadas por recurso, com os filtros embutidos para cache correto:

```ts
qk.suggestions(filters)        → ['suggestions', filters]
qk.rules()                     → ['rules']
qk.clusters()                  → ['clusters']
qk.cluster(id)                 → ['clusters', id]
qk.applyRuns(page, perPage)    → ['apply', 'list', page, perPage]
qk.applyRun(id)                → ['apply', id]
qk.schedules()                 → ['schedules']
qk.audit(filters)              → ['audit', filters]
```

### Invalidação

Toda mutação invalida a(s) chave(s) afetada(s) no `onSuccess`:
- create/update/delete de **regra** → invalida `['rules']` **e** `['suggestions']` (a regra muda os cálculos) **e** `['audit']`.
- create/update/delete de **cluster** → invalida `['clusters']`, `['suggestions']`, `['audit']`.
- `POST /pricing/apply` → invalida `['apply','list']` e `['audit']` (não invalida `['suggestions']` — o preço só muda no ERP após o worker).
- `approve`/`reject`/`rollback` → invalida `['apply', id]` e `['apply','list']` e `['audit']`.
- create/delete de **schedule** → invalida `['schedules']`, `['audit']`.

### Polling (runs assíncronos)

O relatório de run (`GET /pricing/apply/:id`) faz polling **enquanto não-terminal**:

```ts
useQuery({
  queryKey: qk.applyRun(id),
  queryFn: () => api.getApplyRun(id, page, perPage),
  refetchInterval: (q) => {
    const s = q.state.data?.status;
    return s === 'done' || s === 'failed' ? false : 3000;
  },
});
```

Mesma regra para schedules que acabaram de disparar (status `fired` é terminal; `pending` não faz polling — não há mudança até o cron). A tela de sugestões usa o **header `Cache-Control: private, max-age=30`** do backend: `staleTime: 30_000` na chave `suggestions` evita refetch redundante dentro da janela.

### Otimismo

Overrides de preço na tela de sugestões são **estado local** (`Map<ean, override>`), não optimistic update de cache — eles não persistem até o apply. O toggle `active` inline numa regra usa optimistic update simples com rollback no `onError` (espelha o legado).

---

## 6. RBAC e segurança no cliente

- **Token:** JWT no `localStorage`; `apiClient` injeta `Authorization: Bearer <accessToken>`. Em **401**, tenta `POST /auth/refresh` uma vez; se falhar, limpa sessão e redireciona para `/login`.
- **Role do JWT** (`admin | operator | viewer`, minúsculo) é lido do payload decodificado (`GET /auth/me` é a fonte canônica; decode local é só para o gate inicial).
- **`RoleGate`** é o guard de rota: envolve o elemento e, se o role não bate, renderiza um "Acesso negado" (não redireciona para login — o usuário *está* autenticado, só não tem permissão). `/pricing/audit` exige `admin`; as demais exigem `operator | admin`.
- **Ações admin dentro de telas operator** (approve/reject de um run) são botões com `RoleGate` inline — operator vê o run mas não os botões de aprovação.
- **Segurança real é no backend.** Esconder link/botão é UX; o `RolesGuard` do NestJS retorna **403** independentemente. O cliente nunca confia no próprio gate como barreira — apenas evita chamadas que sabidamente falham.
- **`viewer`** hoje não acessa pricing. Se o produto confirmar um perfil só-leitura (`VIEWER_PRICING` — decisão aberta, §12), o FE adiciona um modo read-only às telas portadas; até lá, viewer cai em "Acesso negado".

---

## 7. Tratamento de erros e envelopes

O backend **não tem filtro de exceção custom** (confirmado em `main.http.ts`/`app.module.ts`) → os erros vêm no **envelope padrão NestJS**: `{ statusCode, message, error }`, onde `message` é `string` ou `string[]` (validação). O `apiClient` normaliza isso num `ApiError { status, message, body }` e os hooks traduzem por status:

| Status | Origem típica | Tratamento no FE |
|---|---|---|
| **400** | ValidationPipe (`whitelist + forbidNonWhitelisted`) ou validação cruzada do service | `message` pode ser `string[]` — concatenar e exibir como toast/erro de form. Os forms já barram a maioria via zod espelhando os DTOs; o 400 é a rede de segurança. Campo extra não-whitelisted também cai aqui (cuidar para não enviar lixo). |
| **401** | JWT ausente/expirado | refresh-once → senão logout + redirect `/login`. Nunca mostrar toast cru. |
| **403** | `RolesGuard` (`{message:'Insufficient role'}`) | "Você não tem permissão para esta ação." Não deveria acontecer se o `RoleGate` estiver correto — logar como sinal de bug de gating. |
| **404** | `:id` inexistente (rule/cluster/run/schedule) | "Registro não encontrado." Em rota de detalhe (`/apply/:id`), mostrar estado vazio com link de volta. |
| **409** | **estado/in-use**: cluster em uso por regra; schedule não-`pending`; approve/reject de run não-`pending` | Mensagem específica do backend já vem em pt-BR e acionável ("Remova a regra antes", "não está aguardando aprovação") — exibir o `message` direto. |
| **422** | **circuit breaker** do apply/rollback (`{message, aborted:true, rejected:[]}`) ou rollback sem item reversível | Tratamento dedicado: banner "Lote abortado por sanidade" + lista de `rejected[]` com motivos (§3.4 dos contratos). Não é erro de rede — é o sistema protegendo de fat-finger. O **preview** (`wouldAbort`) antecipa isso antes do POST real. |

**Rejeições parciais não são erro:** `POST /pricing/apply` retorna **202** mesmo com `rejected[]` preenchido (e até com `accepted:0`). O FE mostra um resumo "X aceitos, Y rejeitados" com os motivos por EAN — não um toast de falha.

---

## 8. i18n / locale pt-BR e formatação

A UI é **pt-BR única** (sem framework de i18n — o backend já manda mensagens em pt-BR). Centralizamos:

- **Moeda:** `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` → `R$ 12,90`. Sempre converter numeric-string do PG para number antes (§4).
- **Percentual:** margem/variação como `12,5%` via `Intl.NumberFormat('pt-BR', { style:'percent' })` ou sufixo manual conforme o valor já venha em ponto-percentual.
- **Datas:** ISO do backend → `Intl.DateTimeFormat('pt-BR')` (`23/06/2026 14:30`). Cron expressions exibidas cruas + descrição humana opcional.
- **Dicionários de vocabulário** (mapas `enum → label pt-BR`, um lugar só):
  - `basis`: `concorrencia`→"Concorrência", `margem_minima`→"Margem mínima", `margem_sem_concorrente`→"Sem concorrente".
  - `NoSuggestionReason` (7): `sem_regra`→"Sem regra", `sem_custo`→"Sem custo", `margem_ok`→"Margem OK", `sem_concorrente`→"Sem concorrente", `pbm`→"PBM bloqueado", `acima_do_venda`→"Acima do preço de venda", `ja_no_alvo`→"Já no alvo".
  - `ApplyRejectReason` + `ApplyItemReason` (síncronos e do worker): tabela única traduzindo todos os motivos de §3.4/§3.5 dos contratos.
  - `status` de run/item, `approvalStatus`, `target` (`precoVenda`→"Preço de venda", `precoOferta`→"Preço de oferta").
  - `CompetitorOrigin` → label de exibição (`PAGUE_MENOS`→"Pague Menos" etc.).

Esses dicionários são a única tradução do enum; nenhuma tela hard-coda string de status.

---

## 9. Acessibilidade e performance

- **Tabela de sugestões virtualizada** (`@tanstack/react-virtual`): pode listar até `perPage` 1000 linhas com colunas dinâmicas por origem. Paginação é server-side (`page`/`perPage`); a virtualização cobre a janela atual. As demais tabelas (regras, clusters, runs, schedules, audit) são pequenas e **não** virtualizam — sem otimização prematura (CLAUDE.md).
- **Cache 30s** na tela de sugestões alinhado ao `Cache-Control` do backend (`staleTime: 30_000`) — evita full-scan repetido do catálogo enquanto o operador filtra.
- **Edição inline por teclado:** navegação ↑/↓ entre linhas, espaço para selecionar, Enter para confirmar override — espelha o legado. Todas as células editáveis têm `aria-label` e foco visível.
- **Estados de carregamento:** skeletons de tabela (não spinners de página) para preservar layout; estados vazios explícitos ("Nenhuma sugestão com os filtros atuais").
- **Acessibilidade base:** shadcn/Radix já entrega foco/roles/ARIA nos dialogs, selects e switches. Toasts (sonner) com `aria-live`. Badges de status com texto, não só cor (PBM, direção subir/abaixar).
- **Polling enxuto:** 3s só em runs não-terminais; para ao virar `done`/`failed`. Sem polling em listas estáticas.

---

## 10. Plano de rollout em fases

A regra é: **net-new primeiro (não tem o que quebrar), telas portadas no corte coordenado** (dependem de decisões de contrato ainda abertas — §12). Cada fase entrega valor de pé.

### Fase 0 — Fundação
API client (Bearer + refresh + parse de erro), auth/login, AppShell + roteamento + `RoleGate`, tipos do contrato, dicionários pt-BR, setup de testes.
**Entrega ao usuário:** login funcional e navegação; ainda sem tela de pricing. (Pré-requisito de tudo.)

### Fase 1 — Sugestões (leitura) + Regras + Clusters
Porta as 3 telas ao novo contrato. Sugestões em modo **somente-leitura primeiro** (lista, filtros, `result` discriminada, competitors dinâmicos), depois habilita override inline. Regras e Clusters com CRUD completo e dry-run de regra (`/preview`).
**Entrega:** o operador vê as sugestões do motor e gerencia regras/clusters — substitui a tela legada quebrada. Depende das decisões de contrato (§12); é o "corte coordenado".

### Fase 2 — Aplicar + Histórico + Rollback
Dialog de seleção → `apply/preview` (mostra `wouldAbort`) → `POST /apply` (202) → `/apply/:id` com polling e report item-a-item; histórico de runs; botão de rollback.
**Entrega:** fecha o loop — o operador *aplica* preços e acompanha/desfaz. Primeiro valor "fim a fim".

### Fase 3 — Agendamentos
Lista + form (one-shot `runAt` vs recorrente `cronExpr`, `recalc`, guarda-corpos `max_items`/`max_variation_pct`).
**Entrega:** aplicação programada/recorrente sem operador presente.

### Fase 4 — Aprovação + Auditoria (admin)
Estado "aguardando aprovação" + ações approve/reject quando `PRICING_APPLY_REQUIRES_APPROVAL` on; tela de Auditoria com filtros.
**Entrega:** governança — admin controla e audita. Última porque o env-flag pode estar off no início.

Fases 2–4 podem começar em paralelo à Fase 1 (não dependem das decisões de contrato — são UI nova sobre endpoints estáveis), mas a ordem de *liberação ao usuário* segue acima.

---

## 11. Estratégia de testes

Espelha a stack do legado e foca onde o risco é real (CLAUDE.md: testar borda, confiar no framework).

- **Unit de componentes** (Vitest + Testing Library): células editáveis (validação de override `>0`/finito), dicionários de tradução de enum (todo motivo tem label), `RoleGate` (esconde/mostra por role), formatação de moeda/percentual, parse de numeric-string do PG. Forms (regra/cluster/schedule) com zod: cada constraint cruzada do DTO tem um caso (XOR cluster/classifications, pesos somam, `noCompetitorMargin` só em concorrência).
- **Hooks** (mock do `apiClient`): invalidação de chave correta por mutação; refresh-once no 401; polling para no status terminal; tradução de status → tratamento (409 vs 422).
- **E2E dos fluxos críticos** (Playwright, backend real ou MSW fiel ao contrato):
  1. **Aplicar:** selecionar EANs → preview → apply 202 → poll até `done` → ver report com `applied/skipped/failed`.
  2. **Circuit breaker:** lote com >50% rejeitado → 422 → banner de abortado + `rejected[]`.
  3. **Aprovar** (env on): apply → `approvalStatus:'pending'` → admin approve 202 → run despacha; e o caminho **reject** → itens viram `failed/'rejeitado'`.
  4. **Rollback:** run `done` com itens `applied` → rollback 202 (novo run `rollback:<id>`) → reaplica `priceOld`; e rollback sem item reversível → 422.
  5. **Recalc no schedule:** criar schedule `recalc:true` → (cron fora da superfície HTTP; testar via disparo simulado/estado) → run usa preço recalculado, não congelado.
- **Guard rails:** teste que nenhuma tela renderiza string de status crua (todas passam pelos dicionários); teste de contrato (tipos do FE compilam contra os shapes do data-contracts).

---

## 12. Riscos e questões em aberto (precisam de dono)

As três primeiras estão marcadas 🔴 "impossível neste repo" no plano de backend — **o backend não vai fechá-las**; precisam de dono de produto. Nenhuma tem dono/prazo hoje; esse é o gap a escalar.

| # | Questão | Impacto no FE | Quem decide |
|---|---|---|---|
| **R1** | **Shape do contrato no corte** — a API nova não devolve `product.id`/`curve` e troca os 3 campos fixos por `competitors[]`. Opções: (a) compat com campos antigos, (b) versionar endpoint, (c) back+front no mesmo PR. | Bloqueia a **Fase 1**. Sem fechar, não dá para "ligar" a tela portada sem quebrar. A chave de apply já é **EAN** (decidido) — seleção do front migra de `productId` para EAN. | Produto — **a definir**. |
| **R2** | **N origens na tela** — 9 origens habilitáveis por tenant vs 3 fixas no legado; como exibir PBM/van para N origens. Colunas dinâmicas (data-driven por `competitors[]`) vs subconjunto fixo. | Define como a **linha de produto** renderiza (colunas, badges PBM/van, composição "Seguindo X"). Recomendação alinhada ao CLAUDE.md: **data-driven pelo `competitors[]` que o backend já ordena**, sem hard-code — mas o *layout* (quantas colunas cabem, scroll horizontal) é decisão de design ainda aberta. | Design/Produto — **a definir**. |
| **R3** | **Existe `VIEWER_PRICING`?** — perfil só-leitura não confirmado. | Define se as telas portadas precisam de um **modo read-only** ou se `viewer` simplesmente cai em "Acesso negado". Sem confirmação, FE entrega só o gate de bloqueio. | Produto — **a definir**. |
| R4 | **Numeric-string do PG** em `ApplyReportItem` — risco de aritmética com string. | Mitigado por `money.ts` na borda + teste unit. Risco residual baixo se a convenção for seguida. | FE (mitigável). |
| R5 | **Cron fora da superfície HTTP** — disparo de schedule roda no backend; difícil de E2E pelo FE. | Testar recorrência/recalc via estado observável (`applyRunId` preenchido, `status:'fired'`), não pelo gatilho. | FE (estratégia de teste). |
| R6 | **CORS não configurado** no `main.http.ts` (sem `enableCors`). Se FE e API forem origens distintas em prod, browser bloqueia. | Pode travar **todas** as chamadas em produção. Confirmar deploy same-origin (proxy) ou pedir `enableCors` no backend. | Infra/Backend — **confirmar**. |

R1–R3 são bloqueadores de *valor* (a Fase 1 espera por elas); R6 é bloqueador *operacional* a confirmar antes do primeiro deploy. As Fases 2–4 (net-new) não dependem de nenhuma decisão aberta e podem avançar.

---

Arquivos de referência verificados (caminhos absolutos): `src/main.http.ts` (sem `setGlobalPrefix`/`enableCors`/filtro de exceção custom → envelope NestJS padrão), `src/app.module.ts` (ValidationPipe global `whitelist+forbidNonWhitelisted+transform`), `src/database/enums/user-role.enum.ts` (`admin|operator|viewer`).

---

# Parte II — Telas e Fluxos

I have enough verified detail on the contract. Now I'll produce the foundation section.

---

# Plano de Implementação Frontend — §0: Fundação

Esta seção especifica a **base compartilhada** sobre a qual todas as telas de pricing (Sugestões, Regras, Clusters, Aplicar, Agendamentos, Auditoria, Aprovação, Histórico/Rollback) serão construídas. Nada aqui é tela de feature — é o que essas telas importam. Mantemos o princípio do `CLAUDE.md`: sem abstração prematura, sem camada de defesa para caso impossível, validação só na fronteira (resposta de API).

**Stack alvo:** React + react-router-dom v7 + TanStack Query + react-hook-form + zod. Multi-tenant via JWT no `Authorization: Bearer`. Sem `:tenant` na URL.

---

## 0.1 Estrutura de arquivos

```
src/
  lib/
    apiClient.ts          # fetch wrapper, baseURL, Bearer, refresh, parse de erro
    apiError.ts           # ApiError class + type guards (isAbortedError, isValidationError)
    queryClient.ts        # QueryClient singleton + defaults
    queryKeys.ts          # factory de chaves de cache (única fonte)
  auth/
    authStore.ts          # tokens em memória + localStorage, expiração
    AuthProvider.tsx      # contexto: user (JwtPayload decodificado), login/logout
    useAuth.ts            # hook de acesso ao contexto
    RequireAuth.tsx       # guard de rota (redirect /login se sem token)
    RequireRole.tsx       # guard de rota por role
    Can.tsx               # gate de UI por role (botões/ações)
    roles.ts             # mapa de permissões (single source para RBAC client-side)
  types/
    pricing.ts            # TODOS os tipos request/response de /pricing/*
    auth.ts              # LoginRequest, LoginResponse, JwtPayload, UserRole
    enums.ts             # CompetitorOrigin, reasons, basis, target, status
  schemas/
    pricing.schema.ts     # zod schemas que espelham types/pricing.ts (parse na fronteira)
    auth.schema.ts
  components/
    feedback/
      QueryBoundary.tsx   # loading/empty/error padrão para queries
      ErrorState.tsx
      EmptyState.tsx
      LoadingState.tsx
    toast/
      toast.ts           # wrapper sonner + tradutor de ApiError → mensagem
  hooks/
    usePollingApplyReport.ts  # polling do GET /pricing/apply/:id até estado final
  test/
    setup.ts
    msw/
      handlers.ts         # mocks MSW por recurso
      server.ts
```

---

## 0.2 API Client (`lib/apiClient.ts`)

**Decisão: `fetch` nativo, não axios.** O legado pricy já usa `fetch` e o backend Nest é REST puro. Axios não carrega seu peso aqui.

### Configuração

- **Base URL:** `import.meta.env.VITE_API_BASE_URL` (ex.: `https://api.farmacore.app`). **Sem global prefix** no backend — paths são exatamente os do `@Controller` (`/auth/...`, `/pricing/...`).
- **Bearer:** injeta `Authorization: Bearer ${accessToken}` lido do `authStore` em toda request, exceto rotas `@Public()` (`POST /auth/login`, `POST /auth/refresh`).
- **Content-Type:** `application/json` em métodos com body.

### Assinatura

```ts
type ApiRequest = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;                          // ex.: '/pricing/suggestions'
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  schema?: ZodType<T>;                   // valida a resposta na fronteira
  public?: boolean;                      // pula o Bearer
  signal?: AbortSignal;
};

export async function apiRequest<T>(req: ApiRequest): Promise<T>;
```

- `query`: serializa para querystring ignorando `undefined`. Booleans e numbers viram string (o backend faz parse). Isso cobre a inconsistência de paginação: `apply`/`audit` recebem `page`/`perPage` como string crua; `suggestions` recebe via DTO com `@Type(Number)` — ambos aceitam string, então mandamos **sempre string**.
- `schema`: se presente, faz `schema.parse(json)` antes de retornar (fronteira de confiança). Se ausente (resposta trivial tipo `{ id, deleted: true }`), retorna `json as T`.
- `204 No Content` (logout): retorna `undefined`.

### Refresh token (interceptor de 401)

Fluxo: se uma request autenticada retorna **401** e existe `refreshToken` válido, dispara `POST /auth/refresh` **uma única vez**, atualiza o store, e re-executa a request original. Refresh concorrente é deduplicado por uma `refreshPromise` em módulo (todas as 401 simultâneas aguardam a mesma chamada).

```ts
// pseudo
let refreshPromise: Promise<void> | null = null;

async function ensureFreshToken(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}
```

- Se o `POST /auth/refresh` também retornar 401 (refresh expirado/inválido) → `authStore.clear()` + redireciona para `/login` (evento global, ver 0.4). Não re-tenta.
- Rotas `public` nunca acionam refresh.

### Parse do envelope de erro do Nest

NestJS retorna erros no shape padrão da `HttpException`:

```ts
// 400 ValidationPipe → message é array de strings
{ statusCode: 400, message: string[], error: 'Bad Request' }
// erros de negócio (BadRequest/NotFound/Conflict/Unprocessable jogados pelo service) → message é string
{ statusCode: 404, message: 'apply run <id> not found', error: 'Not Found' }
// 422 circuit breaker / rollback → PAYLOAD CUSTOMIZADO (não tem só message)
{ message: 'Lote abortado: ...', aborted: true, rejected: [{ ean, reason }] }
{ message: 'Run <id> não tem item aplicado reversível.' }
```

Toda resposta `!res.ok` vira `throw new ApiError(...)` (ver 0.3) carregando `status`, `message` (normalizada para string única — junta array de validação com `; `), e `raw` (o body parseado inteiro, para extrair `aborted`/`rejected`).

---

## 0.3 ApiError (`lib/apiError.ts`)

```ts
export class ApiError extends Error {
  readonly status: number;
  readonly raw: unknown;                 // body parseado completo
  constructor(status: number, message: string, raw: unknown);
}

// Type guards usados pelas telas:

// 422 circuit breaker: { aborted: true, rejected: ApplyRejection[] }
export function isAbortedBatchError(
  e: unknown,
): e is ApiError & { raw: { aborted: true; rejected: ApplyRejection[] } };

// 400 ValidationPipe (message[] do Nest) vs 400 de negócio (message string pt-BR)
export function isValidationError(e: unknown): e is ApiError; // status === 400

// helpers de status para o switch das telas
export function statusOf(e: unknown): number | null;
```

`isAbortedBatchError` checa `e instanceof ApiError && e.status === 422 && raw?.aborted === true`. As telas de Aplicar usam isso para distinguir o **circuit breaker** (mostra `rejected[]` no modal "lote abortado por sanidade") do **rollback sem item reversível** (422 sem `aborted` → toast simples com `raw.message`).

---

## 0.4 Auth: tipos, store, provider (`types/auth.ts`, `auth/*`)

### Tipos (`types/auth.ts`)

```ts
export type UserRole = 'admin' | 'operator' | 'viewer';

export interface LoginRequest {
  email: string;
  password: string;
  tenantSlug: string;                    // /^[a-z][a-z0-9-]{2,31}$/
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;                     // segundos até expirar (do backend)
}

export interface JwtPayload {            // GET /auth/me e decode do accessToken
  sub: string;
  tenantId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}
```

### Login (`POST /auth/login`)

- **Método/path:** `POST /auth/login` (público, `@HttpCode(200)`).
- **Body:** `LoginRequest`. Validar no client com zod antes de enviar (espelhar DTO):
  - `email`: `z.string().email()`
  - `password`: `z.string().min(1).max(256)`
  - `tenantSlug`: `z.string().regex(/^[a-z][a-z0-9-]{2,31}$/, 'Slug inválido')`
- **Resposta:** `LoginResponse`.
- **Erros:** `400` body inválido (improvável após validação client); `401` credenciais inválidas → toast "E-mail, senha ou farmácia inválidos" (mensagem genérica, não vazar qual campo).

### authStore (`auth/authStore.ts`)

- **Armazenamento:** `accessToken` + `refreshToken` em `localStorage` (chaves `fc.at` / `fc.rt`), espelhando o legado (`apiClient.ts` lê Bearer do localStorage). `accessToken` também mantido em memória para o request síncrono.
- **Expiração:** decodifica `exp` do `accessToken` (decode local de JWT, sem verificação de assinatura — só leitura do payload). Helper `isExpired()` compara `exp * 1000` com `Date.now()`. Se expirado na carga inicial, tenta refresh antes de montar a app.
- **API:** `getAccessToken()`, `getRefreshToken()`, `setTokens(LoginResponse)`, `clear()`, `getUser(): JwtPayload | null` (decode do access token).
- **Evento de logout forçado:** `clear()` emite `window.dispatchEvent(new Event('auth:logout'))`. O `AuthProvider` escuta e navega para `/login` — desacopla o apiClient do roteador.

### AuthProvider / useAuth

- `AuthProvider` deriva `user: JwtPayload | null` do `authStore` (decode local) e o re-hidrata via `GET /auth/me` no mount (fonte canônica do role — não confiar só no decode local para gating de UI sensível, mas decode é suficiente para boot rápido).
- `useAuth()` → `{ user, role, login, logout, isAuthenticated }`.
- `logout()`: `POST /auth/logout` (204) → `authStore.clear()`.

---

## 0.5 RBAC client-side (`auth/roles.ts`, `RequireRole.tsx`, `Can.tsx`)

Espelha os `@Roles(...)` do backend. O client **gateia navegação e ações** (UX), mas o backend é a autoridade — o client nunca é a única defesa.

### Matriz de permissões (`auth/roles.ts`) — fonte única

```ts
// Verdade de base extraída do api-surface. viewer NÃO acessa nada de pricing.
export const PERMISSIONS = {
  'pricing:read':      ['operator', 'admin'],   // suggestions, rules, clusters, schedules, apply (list/report), preview
  'pricing:write':     ['operator', 'admin'],   // create/update/delete rules, clusters, schedules; apply; rollback
  'pricing:approve':   ['admin'],               // POST /apply/:id/approve | /reject
  'pricing:audit':     ['admin'],               // GET /pricing/audit
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole | undefined, perm: Permission): boolean {
  return !!role && PERMISSIONS[perm].includes(role);
}
```

### Decisão em aberto — `VIEWER_PRICING` (do gaps-decisions §1.3)

**Hoje `viewer` não vê nenhuma tela de pricing.** Não construir tela read-only para viewer até que o dono de produto confirme se `VIEWER_PRICING` existirá. A matriz acima já está preparada: se o perfil surgir, adiciona-se `'viewer'` apenas a `pricing:read` em rotas específicas — sem refatorar telas. **Marcar como bloqueador externo no board; não inventar comportamento.**

### Guards

- **`<RequireAuth>`** (wrapper de rota): sem token válido → `<Navigate to="/login" replace />`.
- **`<RequireRole perm="pricing:read">`**: role insuficiente → tela `403` ("Você não tem acesso à precificação"). Aplica-se ao layout inteiro de `/precos/*` com `pricing:read`; sub-rotas de auditoria com `pricing:audit`.
- **`<Can perm="pricing:approve">{...}</Can>`**: renderiza children só se `can(role, perm)`. Usado para esconder botões Approve/Reject (admin), o link de Auditoria (admin), e ações de escrita quando (futuramente) houver viewer.

```tsx
// uso
<Can perm="pricing:approve">
  <Button onClick={approve}>Aprovar run</Button>
</Can>
```

**Mapa rota → guard** (espelha `@Roles`):

| Rota client | Guard | Backend `@Roles` |
|---|---|---|
| `/precos/*` (layout) | `pricing:read` | operator/admin |
| `/precos/aplicar/*`, edição de regra/cluster/schedule | ação gated por `pricing:write` | operator/admin |
| botões Aprovar/Rejeitar run | `pricing:approve` | admin |
| `/precos/auditoria` | `pricing:audit` | admin |

---

## 0.6 Tipos compartilhados (`types/pricing.ts`, `types/enums.ts`)

Tipos `verbatim` do data-contracts. Resumo do que o pacote exporta (cada tela importa daqui — zero redefinição local):

### Enums (`types/enums.ts`)

```ts
export type CompetitorOrigin =
  | 'DROGAL' | 'DROGASIL' | 'PAGUE_MENOS' | 'IKESAKI' | 'MICHELASSI'
  | 'PACHECO' | 'SAO_PAULO' | 'VENANCIO' | 'INDIANA';

export type SuggestionStrategy = 'margem' | 'concorrencia';
export type CompetitorMode = 'weighted' | 'cascade' | 'lowest';
export type SuggestionTarget = 'precoVenda' | 'precoOferta';
export type SuggestionBasis = 'concorrencia' | 'margem_minima' | 'margem_sem_concorrente';

export type NoSuggestionReason =
  | 'sem_regra' | 'sem_custo' | 'margem_ok' | 'sem_concorrente'
  | 'pbm' | 'acima_do_venda' | 'ja_no_alvo';

export type ApplyRejectReason =
  | 'nao_encontrado' | 'sem_custo' | 'preco_invalido' | 'abaixo_do_piso'
  | 'variacao_excessiva' | 'acima_do_venda' | 'sem_caderno';

export type ApplyItemReason =                      // worker (assíncrono)
  | 'em_campanha' | 'monitored' | 'sem_external_id'
  | 'a7_nao_configurado' | 'nao_encontrado' | 'erp_conflito'
  | 'erro_transitorio' | 'rejeitado';

export type ApplyRunStatus = 'pending' | 'running' | 'done' | 'failed';
export type ApplyItemStatus = 'pending' | 'applied' | 'skipped' | 'failed';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';   // | null
export type ScheduleStatus = 'pending' | 'fired' | 'cancelled';
```

**Mapas de label (pt-BR) co-localizados** (`types/labels.ts`) — a UI nunca renderiza o enum cru:

```ts
export const COMPETITOR_ORIGIN_LABEL: Record<CompetitorOrigin, string>;
export const NO_SUGGESTION_REASON_LABEL: Record<NoSuggestionReason, string>;
export const APPLY_REJECT_REASON_LABEL: Record<ApplyRejectReason, string>;
export const APPLY_ITEM_REASON_LABEL: Record<ApplyItemReason, string>;
export const BASIS_LABEL: Record<SuggestionBasis, string>;
```

**Nota crítica (do legacy-ui):** o legado tinha 3 concorrentes hard-coded minúsculos (`drogal|drogasil|michelassi`). O novo contrato é **enum MAIÚSCULO de 9 valores, habilitados por tenant**. Os tipos acima já estão corretos; a decisão de *colunas dinâmicas vs subconjunto fixo* (gaps §1.2) é da tela de Sugestões, não da fundação — a fundação só fornece o enum completo + labels.

### Interfaces (`types/pricing.ts`)

Exporta, `verbatim` do data-contracts: `SuggestionsResponse`, `ResponseRow`, `ResponseProduct`, `CompetitorView`, `ClusterOrigin`, `SuggestionResult` (union por `kind`), `PriceSuggestion`, `SuggestionRuleApi`, `UpsertSuggestionRule`, `RuleCompetitor`, `ClusterApi`, `ClusterDetail`, `UpsertCluster`, `ApplyItem`, `ApplyPricesRequest`, `ApplyResponse`, `ApplyRejection`, `ApplyPreview`, `ApplyRunSummary`, `ApplyReport`, `ApplyReportItem`, `CreateSchedule`, `ScheduleView`, `AuditView`, `ListSuggestionsQuery`.

**Armadilha de fidelidade a documentar no tipo** (do data-contracts §"Notas de fidelidade"): em `ApplyReportItem`, os campos `price`, `priceOld`, `cadernoId` chegam como **`string`** (numeric/bigint do PG não convertidos). Tipar como `string`/`string | null` e converter com `Number(...)` só na renderização — **não** assumir `number`.

---

## 0.7 Schemas zod (`schemas/pricing.schema.ts`)

Validação **só na fronteira** (resposta da API e input de formulário). Espelha os tipos acima.

- **Respostas:** cada query passa `schema` ao `apiClient` para `parse` defensivo. O ponto que o legado quebrava (`usePricingSuggestionProducts.ts`) é exatamente este — o schema novo deve:
  - **não exigir `product.id`** (removido do contrato);
  - aceitar `competitors: z.array(competitorViewSchema)` (genérico, 9 origens), não os 3 campos fixos;
  - aceitar `null` em `cost/priceForSell/priceForOffer/margin/averageVariation` (`z.number().nullable()`);
  - `result` como **discriminated union** por `kind`:
    ```ts
    const suggestionResultSchema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('suggestion'), suggestion: priceSuggestionSchema }),
      z.object({ kind: z.literal('none'), reason: noSuggestionReasonSchema, rule: suggestionRuleApiSchema.optional() }),
    ]);
    ```
- **Inputs de formulário (react-hook-form + zodResolver):** `upsertSuggestionRuleSchema`, `upsertClusterSchema`, `applyPricesSchema`, `createScheduleSchema`, `loginSchema`. Espelham as constraints dos DTOs para feedback imediato (ex.: `minMargin` `0..95`, `name` `1..120`, `variationPct` `-90..90`, `cronExpr` `9..100`, `items` `1..5000`). As **validações cruzadas** (clusterId XOR classifications; concorrência exige ≥1 competidor; pesos `0<w≤100` em weighted) também no zod via `.superRefine`, espelhando o `validate()` do backend — mas o backend continua a autoridade (400 de negócio sempre tratado).

---

## 0.8 TanStack Query (`lib/queryClient.ts`, `lib/queryKeys.ts`)

### Defaults (`queryClient.ts`)

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,            // alinha ao Cache-Control: private, max-age=30 de /suggestions
      retry: (count, err) =>
        statusOf(err) >= 500 && count < 2,   // só 5xx; nunca re-tentar 4xx
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});
```

### Chaves de cache (`queryKeys.ts`) — fonte única

```ts
export const qk = {
  suggestions: (q: ListSuggestionsQuery) => ['suggestions', q] as const,
  rules:       () => ['rules'] as const,
  clusters:    () => ['clusters'] as const,
  cluster:     (id: string) => ['clusters', id] as const,
  applyRuns:   (page: number, perPage: number) => ['apply', 'list', page, perPage] as const,
  applyReport: (id: string) => ['apply', id] as const,
  schedules:   () => ['schedules'] as const,
  schedule:    (id: string) => ['schedules', id] as const,
  audit:       (q: AuditQuery) => ['audit', q] as const,
  me:          () => ['me'] as const,
};
```

### Invalidação após mutação (regras)

| Mutação | Método+Path | Invalida |
|---|---|---|
| Criar/editar/excluir regra | `POST/PATCH/DELETE /pricing/suggestion-rules[/:id]` | `qk.rules()`, **`['suggestions']`** (regra ativa muda o cálculo) |
| Criar/editar/excluir cluster | `POST/PATCH/DELETE /pricing/clusters[/:id]` | `qk.clusters()`, `qk.cluster(id)`, `['suggestions']` |
| Aplicar em massa | `POST /pricing/apply` | `qk.applyRuns(...)` (novo run aparece na lista) |
| Approve / Reject | `POST /pricing/apply/:id/approve\|reject` | `qk.applyReport(id)`, `qk.applyRuns(...)` |
| Rollback | `POST /pricing/apply/:id/rollback` | `qk.applyRuns(...)` (cria novo run) |
| Criar/cancelar schedule | `POST/DELETE /pricing/schedules[/:id]` | `qk.schedules()`, `qk.schedule(id)` |

### Polling do apply report (`hooks/usePollingApplyReport.ts`)

`GET /pricing/apply/:id` é polado enquanto o run não atingiu estado final.

```ts
useQuery({
  queryKey: qk.applyReport(id),
  queryFn: () => apiRequest({ method: 'GET', path: `/pricing/apply/${id}`, query: { page, perPage }, schema: applyReportSchema }),
  refetchInterval: (q) => {
    const status = q.state.data?.status;
    return status === 'done' || status === 'failed' ? false : 2000;
  },
});
```

- Para quando `status ∈ {done, failed}`. Se `approvalStatus === 'pending'`, continua exibindo o run mas o polling para (não há trabalho até um admin aprovar) — o report só muda após `approve`. Após `approve` (que invalida `applyReport(id)`), o polling re-arma porque o status volta a não-final.

---

## 0.9 Estados padrão e toasts (`components/feedback/*`, `components/toast/toast.ts`)

### QueryBoundary (loading / empty / error)

```tsx
<QueryBoundary
  query={suggestionsQuery}
  empty={(data) => data.rows.length === 0}
  emptyState={<EmptyState title="Nenhum produto" .../>}
>
  {(data) => <SuggestionsTable data={data} />}
</QueryBoundary>
```

- **Loading:** skeleton (`TableSkeleton` do legado para tabelas; spinner para formulários).
- **Empty:** `<EmptyState>` com CTA contextual (ex.: "Criar primeira regra").
- **Error:** `<ErrorState>` com mensagem de `ApiError.message` + botão "Tentar novamente" (`query.refetch`). Para **403** (role insuficiente, defesa em profundidade — não deveria chegar aqui se o guard funciona): mensagem "Sem permissão".

### Tradutor de erro → toast (`toast.ts`)

`toastApiError(e: unknown)` mapeia por status (`statusOf`):

| Status | Tratamento |
|---|---|
| 400 validação (Nest `message[]`) | toast com a(s) mensagem(ns); em formulário, mapear para o campo se possível |
| 400 negócio (string pt-BR) | toast com `e.message` (já é pt-BR do backend, ex.: "Cluster da regra não existe") |
| 401 | (já tratado pelo refresh; se chegar, força logout) |
| 403 | "Você não tem permissão para esta ação." |
| 404 | "Registro não encontrado." (+ invalidar cache da lista) |
| 409 | toast com `e.message` (ex.: "Cluster em uso pela(s) regra(s)...", "schedule já fired...") |
| **422 aborted** | **não é toast** — abre modal "Lote abortado por sanidade" com `raw.rejected[]` (ver tela Aplicar) |
| 422 outros | toast com `raw.message` (ex.: "Run não tem item aplicado reversível.") |
| 5xx | "Erro no servidor. Tente novamente." |

Toasts via **sonner** (já no legado). Sucesso de mutação → toast curto ("Regra salva", "Run enfileirado").

---

## 0.10 Estratégia de testes (`src/test/*`)

**Ferramentas:** Vitest + React Testing Library + **MSW** (mock do backend no nível de rede, reusando os schemas zod para garantir fixtures válidas) + Playwright para e2e dos fluxos críticos.

### Component / unit (Vitest + RTL + MSW)

- **apiClient:** refresh em 401 (dedup de chamadas concorrentes), refresh falho → logout, parse correto do 400 array vs string, **`isAbortedBatchError` em 422**, 204 → undefined.
- **RBAC:** `can()` para cada combinação role×permission; `<RequireRole>` redireciona/403; `<Can>` esconde Approve/Reject para operator; viewer não monta `/precos/*`.
- **Schemas (regressão do bug legado):** teste que **a resposta nova de `/pricing/suggestions` parseia** (sem `id`, com `competitors[]`, com `null` em cost/preços, `result.kind` discriminado) — é o teste que prova que o corte de contrato não quebra a tela. Teste que o shape antigo (com `id`, 3 campos fixos) **não é mais exigido**.
- **QueryBoundary:** estados loading/empty/error renderizam o componente certo.

### E2E (Playwright) — fluxos críticos

1. **Login → tenant scoping:** login com `tenantSlug` válido → token armazenado → `/auth/me` traz role → navegação respeita role.
2. **RBAC ponta-a-ponta:** operator não vê link de Auditoria nem botões Approve; admin vê.
3. **Apply assíncrono:** `POST /pricing/apply` (202) → polling do report até `done`; mostra `rejected[]` síncronos e item-status do worker.
4. **Circuit breaker:** lote ≥10 com >50% rejeitado → **422** → modal de lote abortado com `rejected[]` (não toast).
5. **Aprovação (flag on):** `POST /apply` → `approvalStatus:'pending'` → admin Approve (202) → polling re-arma → `done`; Reject (200) → run `failed`.
6. **Refresh token:** access token expirado → request 401 → refresh transparente → request re-executada com sucesso; refresh expirado → redirect `/login`.

---

## 0.11 Critérios de aceite observáveis

1. Toda request autenticada envia `Authorization: Bearer <accessToken>`; `POST /auth/login` e `/auth/refresh` **não** enviam.
2. Um 401 em request autenticada dispara **exatamente um** `POST /auth/refresh` mesmo com N requests 401 simultâneas; após sucesso, todas re-executam; após falha do refresh, app redireciona a `/login` e limpa tokens.
3. `viewer` autenticado que acessa `/precos/*` vê tela 403, não a tela de pricing. (Sujeito à decisão `VIEWER_PRICING` — até lá, comportamento é bloquear.)
4. Botões Aprovar/Rejeitar e o link de Auditoria **não existem no DOM** para operator (gated por `<Can>`), não apenas desabilitados.
5. `GET /pricing/suggestions` com resposta sem `product.id`, com `competitors[]` de N origens e `null` em preços **renderiza sem erro** (o bug do Zod legado não reaparece) — coberto por teste de schema.
6. `POST /pricing/apply` que retorna **422 com `aborted:true`** abre o modal de lote abortado listando `rejected[]`; **422 sem `aborted`** (rollback) mostra toast com a mensagem do backend.
7. `GET /pricing/apply/:id` é polado a cada 2s e **para** ao atingir `done`/`failed`; após `approve`, o polling re-arma.
8. Mutação de regra/cluster invalida **tanto** sua lista quanto `['suggestions']` (o cálculo depende das regras ativas).
9. `ApplyReportItem.price/priceOld/cadernoId` são tratados como `string` na fonte e convertidos só na renderização — nenhuma operação aritmética assume `number` cru.
10. Erros 400/404/409/422/5xx produzem mensagens pt-BR distintas e corretas conforme a tabela 0.9; nenhum erro 4xx é re-tentado automaticamente pelo TanStack Query.

---

## Dependências externas / decisões que esta fundação NÃO fecha

Estas vêm do gaps-decisions e **bloqueiam telas específicas, não a fundação** — a fundação já está preparada para qualquer resolução:

- **§1.1 Shape do contrato** (manter `id`/`curve` vs versionar vs back+front no mesmo PR): a fundação assume **o contrato novo** (sem `id`, `competitors[]`). Se o produto escolher "versionar endpoint", muda só a `baseURL`/path no apiClient. **Chave de apply é EAN, não `productId`** — `authStore`/seleção em massa (na tela) usam EAN.
- **§1.2 N origens na tela** (colunas dinâmicas vs fixas): a fundação fornece o enum completo + `COMPETITOR_ORIGIN_LABEL`. A decisão de layout é da tela de Sugestões.
- **§1.3 `VIEWER_PRICING`:** a matriz `PERMISSIONS` permite adicionar `viewer` a `pricing:read` sem refatorar. Até o produto confirmar, `viewer` é bloqueado de pricing.

Arquivos de referência do backend (verdade de base, não reinventar): login `src/auth/auth.controller.ts` + `dto/login.dto.ts` (`tenantSlug` regex `/^[a-z][a-z0-9-]{2,31}$/`); JWT payload `src/auth/jwt-payload.type.ts`; sem global prefix em `src/main.http.ts`.

---

I now have everything I need: the legacy dialog (imperative form, 3 hard-coded competitors, `priceRoundingTypeId`), the legacy list page, the new DTO (with `blockPbmInMargin`/`cascadeByPriority`, no `priceRoundingTypeId`), the new service validation with exact pt-BR error messages, and the controller paths/roles. Let me produce the FE plan section.

---

## Tela: Regras de Sugestão (CRUD)

Porta `RegrasSugestao.tsx` + `RegraSugestaoDialog.tsx` do pricy-shelf para o contrato novo (`/pricing/suggestion-rules`). Migra o form imperativo (`useState<FormState>` + validação no `handleSave`) para **react-hook-form + zod**, generaliza concorrentes de 3 fixos → **9 dinâmicos** (`CompetitorOrigin`), **remove** `priceRoundingTypeId` (e todo o `usePriceRoundingTypes`), e **adiciona** os toggles `blockPbmInMargin` e `cascadeByPriority`.

### Contrato (verbatim do backend)

- Base: `src/tenant-api/pricing/suggestion-rules.controller.ts` (`@Controller('pricing/suggestion-rules')`, sem global prefix).
- Roles: **todas operator/admin**. Auth JWT (`Authorization: Bearer`); tenant vem do token — **não** mandar slug em path/header.

| Método | Path | Status | Body | Resposta |
|---|---|---|---|---|
| GET | `/pricing/suggestion-rules` | 200 | — | `SuggestionRuleApi[]` (já `ORDER BY updated_at DESC` no service) |
| POST | `/pricing/suggestion-rules` | 201 | `UpsertSuggestionRule` | `SuggestionRuleApi` |
| PATCH | `/pricing/suggestion-rules/:id` | 200 | `UpsertSuggestionRule` | `SuggestionRuleApi` |
| DELETE | `/pricing/suggestion-rules/:id` | 200 | — | `{ id, deleted: true }` (soft-delete) |

`SuggestionRuleApi` (resposta) e `UpsertSuggestionRule` (body) conforme `data-contracts §6.2/§6.3`. **A lista já vem ordenada por `updatedAt DESC` no servidor — o FE renderiza na ordem recebida, não reordena.**

### Componentes

```
src/pages/precos/RegrasSugestao.tsx          (lista — porta direta, ajustes de coluna)
src/components/precos/RegraSugestaoDialog.tsx (form — reescrito com RHF+zod)
src/components/precos/CompetitorWeightField.tsx  (NOVO — extrai a linha concorrente+peso, data-driven)
src/hooks/useSuggestionRules.ts              (reescrito p/ REST: list/save/delete)
src/hooks/useCompetitorOrigins.ts            (NOVO — deriva as 9 origens; ver §"Origens dinâmicas")
src/types/pricingSuggestion.ts               (reescrito: enum MAIÚSCULO 9 origens, sem priceRoundingTypeId, +2 flags)
src/schemas/suggestionRule.schema.ts         (NOVO — zod do form + transform p/ payload)
```

Reusa do kit existente (shadcn/Radix): `Dialog*`, `Input`, `Label`, `Checkbox`, `Switch`, `RadioGroup`, `ScrollArea`, `Button`, `Badge`, `SeverityPill`, `Table*`, `PageHeader`. **Remove** `Select`/`usePriceRoundingTypes` do dialog (campo morto no contrato novo). Tabela continua `<Table>` plano sem virtualização (poucas regras).

### Tipos novos (`types/pricingSuggestion.ts`)

```ts
// Espelha competitor-origin.enum.ts (9 valores, MAIÚSCULO)
export type CompetitorOrigin =
  | 'DROGAL' | 'DROGASIL' | 'PAGUE_MENOS' | 'IKESAKI' | 'MICHELASSI'
  | 'PACHECO' | 'SAO_PAULO' | 'VENANCIO' | 'INDIANA';

export const COMPETITOR_ORIGIN_LABELS: Record<CompetitorOrigin, string> = {
  DROGAL: 'Drogal', DROGASIL: 'Drogasil', PAGUE_MENOS: 'Pague Menos',
  IKESAKI: 'Ikesaki', MICHELASSI: 'Michelassi', PACHECO: 'Pacheco',
  SAO_PAULO: 'São Paulo', VENANCIO: 'Venâncio', INDIANA: 'Indiana',
};

export type SuggestionStrategy = 'margem' | 'concorrencia';
export type CompetitorMode = 'weighted' | 'cascade' | 'lowest';

// SuggestionRuleApi (resposta) e UpsertSuggestionRule (payload) — ver data-contracts §6.2/§6.3.
// REMOVER: priceRoundingTypeId. ADICIONAR: blockPbmInMargin, cascadeByPriority (boolean).
```

### Origens dinâmicas (substitui os 3 hard-coded)

O legado fixava `ALL_SUGGESTION_COMPETITORS = ['drogal','drogasil','michelassi']`. Não há endpoint dedicado de origens neste módulo. **Decisão para o seletor (`useCompetitorOrigins`):**
- **Fonte primária:** derivar das origens presentes em `GET /pricing/suggestions` → `rows[].product.competitors[].origin` (uma entrada por origem habilitada do tenant, na ordem `priority ASC, origin ASC`). É a fonte de verdade do que o tenant tem habilitado (data-contracts §2).
- **Fallback** (lista de regras vazia / suggestions ainda não carregadas): as 9 origens de `CompetitorOrigin`, na ordem do enum. **Edge case:** ao editar uma regra cuja `competitors[]` contém uma origem que não está mais habilitada, mesclar essa origem na lista exibida (marcada) para não perdê-la silenciosamente no round-trip — mas avisar inline ("origem não habilitada"). Enviar origem não habilitada → 400 (`Concorrente inválido: X`).

> Nota de simplicidade (CLAUDE.md): `useCompetitorOrigins` é um `useMemo`/`useQuery` fino sobre dados já buscados, não um sistema de config. Não criar abstração de "registry de origens".

### Estado do form — react-hook-form + zod

`useForm<RuleFormValues>` com `zodResolver(ruleFormSchema)`, `defaultValues` de `toFormValues(rule)`. Reset em `useEffect([open, rule])` (como o legado). Em vez de `Record<competitor, boolean/string>`, modelar concorrentes como **array** (RHF `useFieldArray`), o que cobre weighted (peso) e cascade (ordem) com a mesma estrutura:

```ts
interface RuleFormValues {
  name: string;
  target: 'classification' | 'cluster';   // só UI (XOR); não vai no payload cru
  classifications: string[];
  clusterId: string | null;
  excludeClusterIds: string[];
  strategy: SuggestionStrategy;
  competitorMode: CompetitorMode;
  minMargin: number;
  // weighted: weight=peso%; cascade: a ORDEM do array é a prioridade; lowest: ignora ordem/peso
  competitors: { competitor: CompetitorOrigin; weight: number }[];
  variationPct: number;
  noCompetitorMargin: number | null;       // só concorrencia
  priceControlled: boolean;
  ignorePbm: boolean;
  blockPbmInMargin: boolean;               // NOVO
  cascadeByPriority: boolean;              // NOVO
  applyRounding: boolean;
  active: boolean;
}
```

`watch('strategy')` → `isConcorrencia`; `watch('competitorMode')` → qual UI de concorrente renderizar; `watch('target')` → classification vs cluster. `switchMode` (re-semear pesos iguais ao trocar para weighted, preservando seleção) e `moveCascade`/`add`/`remove` portados do legado, agora operando sobre o `useFieldArray`.

### Schema zod — espelha o `validate()` do service

Valida no submit e bloqueia antes do POST/PATCH (mensagens pt-BR idênticas às do service para o usuário não ver duas redações diferentes do mesmo erro). Referência: `suggestion-rules.service.ts:validate()`.

Campo a campo (constraints do DTO + service):
- `name`: `min(1).max(120)` após trim → "Dê um nome pra regra." quando vazio.
- `minMargin`: `number` `min(0).max(95)` (obrigatório) → "Margem mínima precisa estar entre 0 e 95%."
- `variationPct`: `min(-90).max(90)`, default 0 → "Variação precisa estar entre -90 e 90%."
- `noCompetitorMargin`: `min(0).max(95).nullable()`; **só persiste em concorrencia** (em margem, coagir a `null` no transform, espelhando o service).
- **XOR alvo** (refine no objeto): `clusterId != null` **e** `classifications.length > 0` juntos → "Uma regra mira classificação OU cluster, nunca os dois." (espelha o CHECK do banco). UI já previne com o `RadioGroup` `target`, mas o refine é a rede de segurança.
- `excludeClusterIds`: refine → não pode conter `clusterId` → "A regra não pode excluir o próprio cluster que ela mira." (UI também remove o cluster mirado da lista de exclusão ao selecioná-lo, como no legado).
- `target === 'cluster'` exige `clusterId` → "Escolha o cluster que a regra vai mirar."
- **competitors (refine condicional a `strategy === 'concorrencia'`):**
  - `competitors.length >= 1` → "Estratégia de concorrência precisa de pelo menos um concorrente."
  - sem duplicados (`new Set(competitor).size === length`) → "Concorrente duplicado: X." (a UI já impede: checkbox/cascade não duplica).
  - `competitorMode === 'weighted'`: cada `weight` `> 0 && <= 100` → "Peso de {label} precisa ser maior que 0 e até 100."; e soma ≈ 100 (`|total-100| <= 0.5`) → "Os pesos precisam somar 100% (atual: N%)." (guard de UI + dica inline `Total: N% ✓`, mesmo limiar 0.5 do legado).
  - `cascade`/`lowest`: peso ignorado (transform grava 1); só exige ≥1.

`toPayload(values)` (transform antes de enviar):
- alvo único: `target === 'cluster'` → `{ clusterId, classifications: [] }`; senão `{ clusterId: null, classifications }`.
- `excludeClusterIds` filtra o `clusterId` mirado.
- `cascade`/`lowest`: `competitors` sem peso útil → enviar `weight` qualquer (o service grava 1); em `weighted` envia o peso digitado.
- `noCompetitorMargin`: `null` se `strategy !== 'concorrencia'`.
- **Não enviar** `target` nem `priceRoundingTypeId`.

### Campos do form (UI)

Todos portados do dialog legado, exceto onde marcado:
- **Nome** (`Input`).
- **Mirar** (`RadioGroup` classification|cluster) → renderiza painel de **Classificações** (`ScrollArea` de `Checkbox`, busca, cap 100 visíveis via `useGroupedClassifications`) ou **Cluster** (`RadioGroup` de `useProductClusters`, link "gerenciar clusters" → `/precos/clusters`).
- **Excluir clusters** (`Checkbox` em `ScrollArea`; oculta o cluster mirado).
- **Estratégia** (`RadioGroup` margem|concorrencia).
- **Margem** (`Input number`, label muda: "Margem mínima (%)" em margem / "Trava de margem (%)" em concorrência).
- **Bloco concorrência** (só `isConcorrencia`):
  - **Base de preço** (`RadioGroup` weighted|cascade|lowest).
  - weighted → `CompetitorWeightField` por origem (Checkbox + Input peso% + dica `Total: N%`); lowest → só Checkboxes; cascade → lista ordenável (↑/↓/remover) + botões "+ origem". **Tudo data-driven por `useCompetitorOrigins()` (9 origens), não pela constante de 3.**
  - `provenancePhrase` (frase explicativa) portada, usando `COMPETITOR_ORIGIN_LABELS`.
  - **Variação (%)** e **Margem-alvo sem concorrência (%)** (`Input number`).
- **Preço controlado (CMED)** (`Switch` → `priceControlled`).
- **Desconsiderar produtos com PBM** (`Switch` → `ignorePbm`).
- **NOVO — Bloquear PBM na margem** (`Switch` → `blockPbmInMargin`). Tooltip: *"Bloqueia a sugestão de gôndola para item PBM também na estratégia margem (por padrão, PBM só é bloqueado na estratégia concorrência)."* Mostrar sempre (afeta margem); independente de `ignorePbm`.
- **NOVO — Cascata segue prioridade do tenant** (`Switch` → `cascadeByPriority`). Tooltip: *"No modo cascata, segue a prioridade configurada das origens do tenant em vez da ordem que você definiu acima."* Renderizar **só** quando `strategy === 'concorrencia' && competitorMode === 'cascade'` (fora disso o backend ignora; não poluir o form). Quando ligado, opcionalmente esmaecer/avisar que a ordem manual da cascata será ignorada.
- **Aplicar arredondamento** (`Switch` → `applyRounding`, default **true**). **REMOVER** o `Select` de tipo de arredondamento, o `usePriceRoundingTypes`, o `useEffect` de auto-seleção e a validação "Escolha o tipo de arredondamento" — `priceRoundingTypeId` não existe no contrato novo.
- **Ativa** (`Switch` → `active`, default true).

### Chamadas de API (hooks)

`useSuggestionRules.ts` reescrito sobre o client REST (`fetch` + Bearer; TanStack Query). Migra de `fn/<edge-function>` para as rotas REST.

```ts
// list — useQuery(['suggestion-rules'])
GET /pricing/suggestion-rules            → SuggestionRuleApi[]

// save — useMutation; PATCH se values tem id, senão POST
POST  /pricing/suggestion-rules          body: UpsertSuggestionRule  → 201 SuggestionRuleApi
PATCH /pricing/suggestion-rules/:id      body: UpsertSuggestionRule  → 200 SuggestionRuleApi

// delete — useMutation
DELETE /pricing/suggestion-rules/:id     → 200 { id, deleted: true }
```

Payload exato (`UpsertSuggestionRule`), exemplo concorrência/weighted:
```json
{
  "name": "Genéricos — seguir Drogal",
  "classifications": ["GENERICOS"],
  "clusterId": null,
  "excludeClusterIds": [],
  "strategy": "concorrencia",
  "minMargin": 20,
  "competitorMode": "weighted",
  "competitors": [{ "competitor": "DROGAL", "weight": 60 }, { "competitor": "DROGASIL", "weight": 40 }],
  "variationPct": -5,
  "noCompetitorMargin": 25,
  "priceControlled": false,
  "ignorePbm": false,
  "blockPbmInMargin": false,
  "cascadeByPriority": false,
  "applyRounding": true,
  "active": true
}
```

Todas as mutações invalidam `['suggestion-rules']` em `onSuccess`. **Toggle `active` inline na tabela** (`alternarAtiva`): mandar `PATCH` com o `SuggestionRuleApi` inteiro + `active` trocado — o PATCH é upsert completo (o service revalida tudo), então reenviar o objeto inteiro é seguro. (Mapear `SuggestionRuleApi` → `UpsertSuggestionRule` removendo `id/clusterName/createdAt/updatedAt`.)

### Estados de erro por código HTTP

O service lança `BadRequestException`/`NotFoundException` com `message` em pt-BR; o handler de erro do client deve propagar `error.message` para o toast (o legado já faz `err instanceof Error ? err.message`).

- **400** (validação cruzada do service ou ValidationPipe): toast com a `message` do backend. O zod do form deve barrar a maioria **antes** do envio; o 400 é a rede de segurança para divergências (ex.: origem não habilitada → "Concorrente inválido: X", ou XOR alvo). Casos: classificação >200 chars; clusterId+classifications; exclui o próprio cluster; concorrente inválido/duplicado; peso inválido em weighted; concorrência sem concorrente; **FK cluster inexistente** → "Cluster da regra não existe (pode ter sido removido)." (cluster apagado entre o load e o save — invalidar `['clusters']` e `['suggestion-rules']` e sugerir recarregar).
- **404** PATCH/DELETE com `id` inexistente → "rule {id} not found" (regra deletada em outra aba). Toast + invalidar `['suggestion-rules']` (some da lista).
- **401**: sem/JWT expirado → redirect login (tratado no client global, fora desta tela).
- **403**: viewer tentando acessar (rota é operator/admin). A tela inteira não deve ser exposta a viewer; se ainda assim chamar, toast "Sem permissão" e não renderizar ações de mutação.
- **`:id` não-UUID** → 400 (`ParseUUIDPipe`). Não ocorre via UI (ids vêm do backend); ignorar.

### Edge cases

- **`:id` UUID**: o backend usa `ParseUUIDPipe`. Ids da lista já são UUID — ok.
- **Lista vazia**: estado vazio portado ("Nenhuma regra ainda… Criar primeira regra").
- **Loading/erro da lista**: skeleton/`Carregando…` e linha de erro com "Tentar de novo" (`refetch`) — portados.
- **Exclusão**: `window.confirm` legado pode virar `AlertDialog` do kit (sem `window.confirm` em SSR/teste). Mensagem: `Excluir a regra "{name}"? Não dá pra desfazer.` (é soft-delete no backend, mas a UI o trata como definitivo).
- **Troca de modo preserva seleção** (`switchMode`): ao ir para weighted, re-semear pesos iguais se algum selecionado está sem peso válido ou total ≠ 100 (porta a lógica `needsSeed` do legado).
- **`strategy = margem`**: zerar/ocultar bloco de concorrência; `competitors` enviado vazio; `noCompetitorMargin` → null no transform.
- **Origem em regra mas não habilitada** (ver §Origens dinâmicas): mesclar na lista marcada + aviso inline; salvar como está dá 400 se realmente não habilitada — deixar o usuário desmarcá-la.
- **Cascade + `cascadeByPriority` ligado**: a ordem manual é ignorada pelo backend; avisar visualmente para não confundir o operador.

### Coluna da tabela (lista) — ajustes vs. legado

Porta `RegrasSugestao.tsx` quase intacto. Ajustes:
- `concorrenciaResumo()` usa `COMPETITOR_ORIGIN_LABELS` (9 origens) em vez de `SUGGESTION_COMPETITOR_LABELS` (3).
- Badge de classificações/cluster/exclude: inalterado (`clusterName`, `classifications`, `excludeClusterIds` continuam no contrato).
- Colunas atuais (Nome · Classificações · Estratégia · Margem mín. · Concorrência · Aplica em · Ignora PBM · Arredonda · Ativa · ações) mantidas. **Opcional:** adicionar indicador de `blockPbmInMargin`/`cascadeByPriority` (ex.: badge sutil) se houver espaço — não obrigatório para paridade.

### Critérios de aceite (observáveis)

1. **Listagem** mostra as regras na ordem `updatedAt DESC` recebida do backend, sem reordenação client-side.
2. **Criar** regra concorrência/weighted com 2 origens somando 100% → `POST` retorna 201; a regra aparece no topo da lista após invalidação.
3. **Editar** uma regra → `PATCH` retorna 200 com os valores atualizados; reabrir o dialog reflete exatamente o que foi salvo (round-trip estável, incluindo ordem da cascata e pesos).
4. **XOR alvo**: o `RadioGroup` impede selecionar classificações e cluster ao mesmo tempo; se um payload inconsistente chegar, o backend responde 400 "Uma regra mira classificação OU cluster, nunca os dois." e o toast mostra essa mensagem.
5. **Concorrência sem concorrente** → submit bloqueado pelo zod com "Estratégia de concorrência precisa de pelo menos um concorrente." (sem chamada de rede).
6. **Pesos ≠ 100% em weighted** → dica inline `Total: N% — ajuste pra 100%`, botão Salvar bloqueado; se forçado, 400 do service.
7. **Concorrente duplicado** não é possível pela UI; um payload duplicado responde 400 "Concorrente duplicado: X".
8. **Seletor de concorrentes** lista as origens **habilitadas do tenant** (derivadas de `/pricing/suggestions`), com fallback às 9 do enum; nunca os 3 hard-coded antigos.
9. **`blockPbmInMargin`** e **`cascadeByPriority`** aparecem como `Switch` com tooltip; o segundo só aparece em concorrência+cascade; ambos viajam no payload e voltam no round-trip.
10. **Sem `priceRoundingTypeId`** em nenhum lugar (form, payload, type) — só o toggle `applyRounding` (default true).
11. **Toggle `active` inline** na tabela faz `PATCH` e persiste; toast "Regra ativada/desativada".
12. **Excluir** → `DELETE` 200, regra some da lista; 404 (já deletada) também a remove da lista com toast.
13. **Erro de cluster inexistente** (FK) ao salvar → toast "Cluster da regra não existe (pode ter sido removido)." e clusters/regras são recarregados.

Arquivos-fonte do contrato (absolutos): DTO `src/tenant-api/pricing/dto/suggestion-rule.dto.ts`; service (validação + mensagens) `src/tenant-api/pricing/suggestion-rules.service.ts`; controller (paths/roles) `src/tenant-api/pricing/suggestion-rules.controller.ts`; enum `src/database/enums/competitor-origin.enum.ts`. Legado de referência: dialog `pricy-legacy/src/components/precos/RegraSugestaoDialog.tsx`; lista `pricy-legacy/src/pages/precos/RegrasSugestao.tsx`; types `pricy-legacy/src/types/pricingSuggestion.ts`.

---

I now have the complete picture: the legacy UI (table + dialog with CSV/paste ingestion), the legacy hooks (edge-function style, separated save/get/delete), and the exact new REST contract (CRUD with upsert semantics, 409 on in-use delete, single `eans[]` array). I have everything needed to produce the implementation section.

One note on the legacy `useMarketProducts`-based "validate against ERP" feature: the new contract has no documented `/pricing/suggestions`-equivalent EAN-lookup endpoint for cluster validation, so I'll handle that as an explicit edge case in the plan (format-only validation client-side, drop the live catalog check unless a market-products endpoint exists).

---

## Tela: Clusters de Produto (CRUD + gestão de EANs)

Portada de `pricy/src/pages/precos/Clusters.tsx` + `components/precos/ClusterDialog.tsx`. Contrato-alvo: `ClustersController` (`/pricing/clusters`), respostas `ClusterApi` / `ClusterApi & { eans: string[] }`. **Sem quebra de shape** — `ClusterApi` bate 1:1 com o type legado `Cluster`. A mudança real é de transporte: troca o estilo edge-function (`clusters-list/get/save/delete`, todos POST) pelas rotas REST (`GET`/`POST`/`PATCH`/`DELETE`), e o `save` único vira `POST` (create) vs `PATCH` (update).

Roles: `operator`/`admin` em todas as rotas. `viewer` não acessa (401/403 — ver tratamento abaixo).

### Arquitetura de arquivos

```
src/features/pricing/clusters/
  ClustersPage.tsx          // tela-lista (tabela)
  ClusterDialog.tsx         // form create/edit (upsert)
  ClusterDeleteDialog.tsx   // confirmação + tratamento do 409 in-use
  useClusters.ts           // hooks TanStack Query (list/detail/create/update/delete)
  parseEanCsv.ts           // parser puro (portar verbatim do legado, com teste)
  clusters.schema.ts        // zod do form + tipos derivados
```

### Camada de dados — `useClusters.ts`

Usar o cliente HTTP REST compartilhado (Bearer do token, tenant implícito no JWT). Query keys:

```ts
const KEY = {
  all:    ['pricing', 'clusters'] as const,
  detail: (id: string) => ['pricing', 'clusters', id] as const,
};
```

Hooks (método + path exatos):

| Hook | Método + Path | Payload | Retorno | Notas |
|---|---|---|---|---|
| `useClusters()` | `GET /pricing/clusters` | — | `ClusterApi[]` | `staleTime: 60_000`. Backend já ordena `updated_at DESC`. |
| `useClusterDetail(id, enabled)` | `GET /pricing/clusters/:id` | — | `ClusterApi & { eans: string[] }` | Lazy: `enabled: open && !!id`. Carrega `eans[]` só ao editar. `staleTime: 60_000`. |
| `useUpsertCluster()` | `POST /pricing/clusters` (sem id) **ou** `PATCH /pricing/clusters/:id` (com id) | `UpsertClusterDto` = `{ name: string; eans?: string[] }` | `ClusterApi & { eans: string[] }` | `retry: 0` em mutações. Ramifica por presença de `id`. |
| `useDeleteCluster()` | `DELETE /pricing/clusters/:id` | — | `{ id: string; name: string }` | `retry: 0`. |

`onSuccess` (create/update/delete): `invalidateQueries(KEY.all)`. No update/delete também `invalidateQueries(KEY.detail(id))`. Como a membership de cluster afeta as sugestões e regras, invalidar igualmente as keys de sugestões e de regras (`['pricing','suggestions']`, `['pricing','rules']`) — espelha o que o hook legado fazia (`PRICING_SUGGESTION_PRODUCTS_QUERY_KEY`, `PRICING_SUGGESTION_RULES_QUERY_KEY`).

**Semântica de `eans` no upsert (crítica, vem do backend):** `eans` ausente no PATCH = só renomeia; `eans` presente = **substitui a membership inteira**. Logo o form de edição deve **sempre** enviar `eans: [...todos os membros]` (não um delta) — porque o usuário enxerga e edita o conjunto inteiro. Só omitir `eans` se quisermos um fluxo "renomear sem tocar membros" (não exposto nesta tela; sempre mandamos o array completo).

### Tela-lista — `ClustersPage.tsx`

Componentes (shadcn/Radix, espelhando o legado): `PageHeader`, `Button`, `Table*`, ícones lucide (`Plus`, `Pencil`, `Trash2`). Toasts via `sonner`.

Estado local:
```ts
const [dialogOpen, setDialogOpen] = useState(false);
const [editing, setEditing] = useState<ClusterApi | null>(null);   // null = criar
const [deleting, setDeleting] = useState<ClusterApi | null>(null); // alvo do delete dialog
```

Colunas (4, idênticas ao legado): **Nome** · **Membros** (`memberCount.toLocaleString('pt-BR')`, alinhado à direita, `tabular-nums`) · **Criado em** (`createdAt` → `toLocaleDateString('pt-BR')`) · ações (Editar / Excluir). Linha inteira clicável abre edição; botões de ação fazem `stopPropagation`.

Ações de cabeçalho: botão **"Novo cluster"** → `setEditing(null); setDialogOpen(true)`.

Estados da tabela (via `useClusters`):
- **loading** (`isLoading`): linha única "Carregando…" centralizada, `colSpan=4`.
- **error** (`isError`): linha "Falha ao carregar os clusters." + `<Button variant="link" onClick={refetch}>Tentar de novo</Button>`. Se o erro for **401** (sessão expirada), redirecionar ao login em vez de mostrar retry; se **403**, mostrar "Você não tem acesso a clusters de preço."
- **empty** (`data?.length === 0`): card vazio explicativo ("Um cluster agrupa produtos escolhidos a dedo ou importados por CSV para criar uma regra de preço que vence a da classificação.") + botão "Criar primeiro cluster".
- **sucesso**: renderiza as linhas.

### Dialog de upsert — `ClusterDialog.tsx`

Props: `{ open: boolean; onOpenChange: (o: boolean) => void; cluster: ClusterApi | null }`. `cluster === null` → modo criar.

Form **com react-hook-form + zod** (stack-alvo; o legado era imperativo com `useState` — aqui modernizamos). Schema:

```ts
const EAN_RE = /^\d{6,14}$/;
const clusterFormSchema = z.object({
  name: z.string().trim().min(1, 'O cluster precisa de um nome.').max(120),
  eans: z.array(z.string().regex(EAN_RE)).max(5000, 'Máximo de 5000 EANs por cluster.'),
});
type ClusterForm = z.infer<typeof clusterFormSchema>;
```

Gestão de EANs (RHF controla `eans: string[]`; manter um `Set` derivado em memória para toggle/dedup O(1), sincronizado via `setValue('eans', [...set], { shouldDirty: true })`):

- **Carga (edição):** ao abrir com `cluster != null`, dispara `useClusterDetail(cluster.id, open)`; quando os `eans[]` chegam, semear o form **uma vez** (guard por `seededRef === cluster.id` para não sobrescrever edição em andamento num refetch). `reset({ name: cluster.name, eans: detail.eans })`.
- **Colar lista** (`Textarea`, mono): botão "Adicionar da lista" → `parseEanCsv(text)` → merge no Set (respeitando cap 5000) → toast `"{added} EANs adicionados · {duplicates} duplicados · {invalid} fora de formato · cortado em 5000?"`.
- **Importar CSV** (`<input type=file accept=".csv">` oculto + botão "CSV"): `await file.text()` → mesmo `ingestEans`. Limpar `input.value` após ingerir (permite re-importar o mesmo arquivo).
- **Busca por nome** + checkboxes (`ScrollArea`): **só portar se existir endpoint de catálogo de produtos no novo backend.** O contrato de pricing fornecido **não** inclui um market-products/lookup endpoint. Decisão: na v1 entregar **colar/CSV apenas** e ocultar a busca por nome até confirmar a rota de catálogo (não inventar endpoint). Manter o componente atrás de um feature-check.
- **Limpar membros:** botão ghost `setValue('eans', [])`.
- **Contador:** `"{eans.length} no cluster"` no label.

**Validação "fora do catálogo" (live check do legado):** o legado usava `useMarketProducts({ eanFilter })` para contar quantos EANs existem no ERP e exibir o pill `"{n} fora do catálogo"`. Sem endpoint equivalente confirmado, **remover esse check da v1** (é só um aviso não-bloqueante; o backend aceita qualquer EAN bem-formado e o produto inexistente simplesmente "não vira sugestão"). Substituir por nota estática: "EANs fora do catálogo do ERP são aceitos, mas não geram sugestão." Se/quando houver rota de lookup, reintroduzir o pill `SeverityPill severity=warn`.

`parseEanCsv` — **portar verbatim** do legado (`pricy/src/components/precos/ClusterDialog.tsx:27-59`): remove BOM, aceita `;`/`,`/CRLF, pula header não-numérico, fica na 1ª coluna, dedup + contagem (`total/duplicates/invalid`). Mover para `parseEanCsv.ts` com teste unitário (é a única lógica não-trivial da tela).

Salvar (`onSubmit` do RHF, já validado):
```ts
upsert.mutate(
  { id: cluster?.id, name, eans },  // eans SEMPRE presente (substitui membership)
  {
    onSuccess: () => { toast.success(cluster ? 'Cluster atualizado.' : 'Cluster criado.'); onOpenChange(false); },
    onError: handleUpsertError,      // mapeia HTTP → toast (abaixo)
  },
);
```
Botão "Salvar" `disabled={upsert.isPending}`, texto "Salvando…" enquanto pendente.

### Confirmação de exclusão + tratamento do 409 in-use — `ClusterDeleteDialog.tsx`

O legado usava `window.confirm`. Substituir por um `AlertDialog` (Radix) para acomodar o estado de erro 409 com ação navegável.

Props: `{ cluster: ClusterApi | null; onClose: () => void }`. Renderiza quando `cluster != null`.

Fluxo:
1. Confirmação: "Excluir o cluster '{name}'? Não dá pra desfazer." + Cancelar / Excluir.
2. Ao confirmar → `useDeleteCluster().mutate(cluster.id)`.
3. **Sucesso:** toast "Cluster excluído.", fecha, `invalidateQueries`.
4. **409 (in-use):** o cluster é referenciado por regra ativa (via `cluster_id` ou `exclude_cluster_ids`). Backend retorna mensagem pt-BR já formatada: `"Cluster em uso pela(s) regra(s): {nomes}. Remova a regra antes."`. **Não fechar o dialog**; transformá-lo em estado de bloqueio:
   - Banner destrutivo com a mensagem do backend (`err.message`).
   - Parsear os nomes das regras da mensagem (split após `"regra(s): "`, antes do `". Remova"`) para listar as regras citadas — ou, melhor, oferecer um CTA **"Ver regras de sugestão"** que navega para a tela de Regras (`navigate('/precos/regras')`, react-router v7) com filtro pré-aplicado pelo nome, se a tela suportar; senão, navegação simples.
   - Botão primário do estado de erro: "Ir para Regras". Botão secundário: "Fechar".
   - Esconder o botão "Excluir" enquanto nesse estado (a ação só destrava removendo a regra).

### Mapeamento de erros HTTP → UI (todas as mutações)

`handleUpsertError` / delete handler devem ler o status do erro do cliente HTTP:

| HTTP | Origem | Tratamento |
|---|---|---|
| **400** | `name` vazio/>120; `> 5000 EANs` (`"Máximo de 5000 EANs por cluster."`); body inválido | Toast com `err.message` do backend. (A validação zod do form já deve barrar antes de chegar aqui — 400 vira fallback.) |
| **400** (ParseUUIDPipe) | `:id` malformado em PATCH/DELETE | Não deve ocorrer (ids vêm do backend); toast genérico "Cluster inválido." |
| **401** | sessão expirada | Redirect login (handler global do cliente HTTP). |
| **403** | `viewer` tentando mutar | Toast "Você não tem permissão para alterar clusters." |
| **404** | PATCH/DELETE de cluster removido em paralelo (`cluster {id} not found`) | Toast "Esse cluster não existe mais."; fechar dialog; `invalidateQueries(KEY.all)`. |
| **409** | DELETE de cluster em uso | **Estado dedicado no delete dialog** (acima), não toast efêmero. |
| **5xx / rede** | — | Toast "Falha ao salvar o cluster. Tente de novo." (mutações com `retry: 0`; o usuário re-tenta manualmente). |

### Edge cases

- **`eans` ausente vs vazio:** o form sempre envia `eans` (mesmo `[]`). `[]` no PATCH **esvazia** a membership (substitui por vazio) — isso é intencional e deve ser possível (cluster sem membros). Não confundir "limpar membros e salvar" (envia `[]`) com "renomear sem tocar membros" (não exposto aqui).
- **Cap de 5000:** validado em 3 camadas — zod (form), ingestEans (corta ao colar/importar, avisa "cortado em 5000"), backend (`normalizeEans` → 400). O form nunca deve deixar passar; o 400 é só rede de segurança.
- **EAN malformado colado:** `parseEanCsv` filtra (regex `^\d{6,14}$`) e conta em `invalid`; nunca entra no Set. O backend também re-filtra (dedup + regex), então um EAN com espaços/aspas que escapou é silenciosamente normalizado server-side.
- **Edição concorrente:** dois operadores editando o mesmo cluster — last-write-wins (PATCH substitui membership inteira). Aceitável; sem locking. O `invalidateQueries` após salvar reidrata a lista.
- **Refetch durante edição:** o guard `seededRef` impede que um refetch do detalhe sobrescreva os EANs que o usuário está editando.
- **Cluster recém-criado e imediatamente referenciado:** não bloqueia nada nesta tela (o 409 só afeta DELETE).

### Critérios de aceite (observáveis)

1. A lista mostra Nome, Membros (formatado pt-BR), Criado em, ordenada por `updated_at DESC` (vinda do backend). Loading/empty/error renderizados distintamente.
2. "Novo cluster" abre dialog vazio; salvar com nome + EANs colados cria via `POST /pricing/clusters` e a nova linha aparece (memberCount correto) sem reload manual.
3. Clicar numa linha abre o dialog em modo edição, carregando os EANs via `GET /pricing/clusters/:id`; o contador reflete `eans.length`.
4. Editar nome e/ou membros e salvar dispara `PATCH /pricing/clusters/:id` com `{ name, eans: [...todos] }`; a membership no servidor passa a ser **exatamente** o conjunto enviado (substituição, não merge).
5. Colar `"7891234567890\n7891234567890\nabc\n7890000000017"` resulta em 2 EANs no Set e toast "2 EANs adicionados · 1 duplicados · 1 fora de formato".
6. Importar CSV com BOM, header textual e separador `;` ingere só a 1ª coluna numérica, pulando o header.
7. Exceder 5000 EANs ao colar corta em 5000 e avisa "cortado em 5000"; o backend nunca recebe >5000.
8. Excluir um cluster **não** referenciado: `DELETE /pricing/clusters/:id` → toast sucesso, linha some.
9. Excluir um cluster referenciado por regra ativa retorna **409**; o dialog **permanece aberto** mostrando a mensagem do backend ("Cluster em uso pela(s) regra(s): X. Remova a regra antes.") e um CTA "Ir para Regras" que navega à tela de regras; o cluster **não** é removido.
10. Um `viewer` (se autenticado em rota de pricing) recebe 403 nas mutações e vê toast de permissão; nenhuma mutação parcial ocorre.
11. Após qualquer mutação bem-sucedida, as queries de sugestões e de regras são invalidadas (a tela de Sugestões reflete a nova membership ao ser reaberta).

### Decisões em aberto que afetam esta tela

- **Endpoint de busca/lookup de catálogo de produtos:** não existe no contrato de pricing fornecido. v1 entrega ingestão por colar/CSV e **omite** a busca por nome e o pill "fora do catálogo". Confirmar com o dono do backend se há rota de market-products para reintroduzir esses dois recursos (ambos são UX, não bloqueiam o CRUD).
- **Navegação de "Ir para Regras" com filtro:** depende da tela de Regras aceitar um query param de nome/cluster para pré-filtrar. Coordenar com o autor dessa tela; fallback é navegação sem filtro.

Arquivos de referência (origem): legado `pricy-legacy/src/pages/precos/Clusters.tsx`, `.../components/precos/ClusterDialog.tsx`, `.../hooks/useProductClusters.ts`. Contrato-alvo: `src/tenant-api/pricing/clusters.controller.ts` e `clusters.service.ts` (mensagem de 409 in-use em `clusters.service.ts:113-117`; cap 5000 em `clusters.service.ts:176-180`); DTO em `.../dto/cluster.dto.ts`.

---

I now have a complete picture of both the backend contract and the legacy screen. I have enough to write a precise, executable spec. Let me produce the frontend implementation plan section.

---

## Tela: Sugestão de Precificação (tabela + filtros + dry-run)

> **Porte de** `pricy-shelf/src/pages/precos/SugestaoPrecificacao.tsx` (≈800 linhas). É o coração do produto: lista o catálogo com a sugestão de preço do motor, permite override manual linha-a-linha, seleciona em massa e faz **handoff** para o fluxo Aplicar/Agendar. **Sobre** `GET /pricing/suggestions` (REST NestJS, JWT por tenant). Roles: `operator`/`admin` (sem viewer — §1.3 pendente, ver "Decisões abertas absorvidas").

### 1. Decisões abertas absorvidas (premissas desta spec)

A tela depende de 2 das 3 decisões 🔴 do `gaps-decisions`. Premissas adotadas (ajustar se o dono de produto decidir diferente):

- **§1.1 (id/curve/EAN):** o contrato novo **não** tem `product.id` nem `curve`. A chave ponta-a-ponta é **EAN**. Seleção, overrides, limpeza pós-apply — tudo por EAN. **Esta spec assume back+front no mesmo PR (opção c)** — não há shim de compatibilidade; o hook é reescrito do zero contra `SuggestionsResponse`.
- **§1.2 (N origens):** a tela renderiza **colunas dinâmicas por origem habilitada**, derivadas de `rows[].product.competitors[]` (ordem já vem `priority ASC, origin ASC` do backend). PBM/van são **por origem**, dentro de cada coluna. Não há subconjunto fixo de 3. Ver `useEnabledOrigins` (§4) e `CompetitorCell` (§3).
- **§1.3 (viewer):** sem `VIEWER_PRICING`. A tela inteira é operator/admin. Não há modo read-only.

### 2. Rota, stack, dados

- **Rota** (react-router-dom v7): `/precos/sugestoes`. Botão "Regras" → `/precos/sugestoes/regras`.
- **Stack:** TanStack Query (cache/fetch) · `@tanstack/react-virtual` (corpo da tabela virtualizado — o legado **não** virtualizava; aqui virtualiza porque `perPage` chega a 1000) · shadcn/Radix + Tailwind · zod (parse da resposta) · `sonner` (toasts). Form de regra (para o dry-run) reusado de outra spec, sem RHF nesta tela.
- **API client:** `fetch` com `Authorization: Bearer <accessToken>` (do store de auth). Sem header de tenant (vem do JWT). **Sem global prefix** — paths são literais.

### 3. Árvore de componentes

```
<SugestaoPrecificacaoPage>                     // container; estado de filtros/seleção/overrides
├─ <PageHeader>                                // título + ações
│   ├─ <Button> "Regras"  → navigate('/precos/sugestoes/regras')
│   ├─ <Button> "Simular regra (dry-run)" → abre <DryRunRuleSheet>
│   ├─ <Button ghost> "Limpar seleção (N)"  (só se selected.size>0)
│   └─ <ApplyHandoffButton>                   // dispara o fluxo Aplicar (§7)
├─ <SuggestionStatsRibbon>                     // count / suggestionCount / lockCount / activeRuleCount
├─ <SuggestionFilters>                         // name, classification, books, direction, origem, onlyWithSuggestion
│   ├─ <Input>  (nome, debounce 400ms)
│   ├─ <ClassificationFilter>
│   ├─ <MultiSelectFilter label="Cadernos" options={availableBooks}>
│   ├─ <SegmentedButtons name="direction" ['todas','subir','abaixar']>
│   ├─ <SegmentedButtons name="origem" ['todas','cluster','classificacao']>
│   └─ <Switch> "Só com sugestão"
├─ <SuggestionTable>                           // virtualizada; colunas fixas + dinâmicas por origem
│   ├─ <SuggestionTableHeader competitors={origins} />
│   └─ <SuggestionRow> (×N)
│       ├─ <Checkbox> (seleção; disabled se !suggestion)
│       ├─ células fixas (EAN, Nome, Fab., Class., Caderno, Custo, P.Venda, P.Oferta, Margem)
│       ├─ <CompetitorCell> (×origem)         // price/isPbm-badge/van por origem
│       ├─ <DirectionCell delta>              // ▲/▼ + %
│       ├─ <EditableCell> "Preço Sugerido"    // override manual
│       ├─ <SugMarginCell>  ou <NoSuggestionReasonCell>
│       ├─ <AppliesToCell>                    // P.Venda/P.Oferta + composição + cadeado de trava
│       └─ <ClusterOriginCell>                // badge cluster + overrodeRuleName
├─ <TablePagination> (page, perPage, count)
└─ <DryRunRuleSheet>                           // Sheet lateral: form de regra transitória → preview
```

**Componentes a criar (net-new ou adaptados):** `SuggestionStatsRibbon`, `SuggestionFilters`, `SuggestionTable` (virtual), `SuggestionRow`, `CompetitorCell`, `DirectionCell`, `AppliesToCell`, `ClusterOriginCell`, `NoSuggestionReasonCell`, `DryRunRuleSheet`, `ApplyHandoffButton`. **Reaproveitados do legado:** `PageHeader`, `EditableCell`, `MarginCell`, `ClassificationFilter`, `TablePagination`, `MultiSelectFilter`, `SeverityPill`, `Checkbox`, `Switch`, `Input`, `Label`.

### 4. Hooks de dados

#### 4.1 `useSuggestions(query): UseQueryResult<SuggestionsResponse>`

- **Endpoint:** `GET /pricing/suggestions` + querystring.
- **Query params** (todos opcionais; `boolean`/`array` viram string — o backend parseia):

  | param | tipo no FE | serialização | default |
  |---|---|---|---|
  | `page` | `number` | string | 1 |
  | `perPage` | `number` | string (cap 1000) | 50 |
  | `name` | `string` | só envia se `≠""` | — |
  | `classification` | `string` | idem | — |
  | `books` | `string[]` | `join(',')` ("Caderno A,Caderno B") | — |
  | `onlyWithSuggestion` | `boolean` | só envia `"true"` quando ligado (qualquer outra coisa = off) | off |
  | `direction` | `'todas'\|'subir'\|'abaixar'` | string | `'todas'` |
  | `origem` | `'todas'\|'cluster'\|'classificacao'` | string | `'todas'` |

- **queryKey:** `['suggestions', { page, perPage, name, classification, books, onlyWithSuggestion, direction, origem }]`.
- **Cache-Control 30s:** o backend manda `private, max-age=30` **só neste GET**. Refletir no Query: `staleTime: 30_000`. **Não** desligar `refetchOnWindowFocus` cegamente — manter o default mas com `staleTime` evita refetch dentro da janela. `keepPreviousData: true` (v5: `placeholderData: keepPreviousData`) para a tabela não piscar ao paginar/filtrar.
- **select/parse:** validar com zod (§6). Mapear `count → totalItems`. Devolver `{ rows, totalItems, suggestionCount, lockCount, activeRuleCount, availableBooks, ...rqMeta }`.

#### 4.2 `useEnabledOrigins(suggestions): CompetitorOrigin[]`

- **Derivado**, não é fetch novo. Origens = `suggestions.rows[0]?.product.competitors.map(c => c.origin)` (o backend garante a **mesma ordem e o mesmo conjunto** em todas as linhas — uma entrada por origem habilitada, `priority ASC, origin ASC`).
- **Edge case (catálogo vazio / primeira página sem linhas):** `rows[0]` indefinido → sem colunas de concorrente. Aceitável: sem produtos não há o que comparar. **Não** hardcodar as 9 origens como fallback (princípio de simplicidade do CLAUDE.md: data-driven, sem assumir as 9).
- Memoizar por identidade de `rows` para estabilizar as colunas.

#### 4.3 `useSuggestionPreview()` — dry-run (mutation)

- **Endpoint:** `POST /pricing/suggestions/preview?<mesma querystring de §4.1>`.
- **Body:** `UpsertSuggestionRuleDto` (regra transitória — passa pela **mesma** validação cruzada do create, ver §6.2 do data-contract).
- **Resposta:** `SuggestionsResponse` calculada usando **só** essa regra (`activeRuleCount` será 1).
- `HttpCode(200)`. Não persiste nada.

### 5. Estado da página (container)

```ts
// filtros (todos disparam reset de page→1)
const [page, setPage] = useState(1);
const [perPage, setPerPage] = useState(50);
const [nameInput, setNameInput] = useState('');
const name = useDebounce(nameInput.trim(), 400);
const [classification, setClassification] = useState('');
const [books, setBooks] = useState<string[]>([]);
const [onlyWithSuggestion, setOnlyWithSuggestion] = useState(false);
const [direction, setDirection] = useState<'todas'|'subir'|'abaixar'>('todas');
const [origem, setOrigem] = useState<'todas'|'cluster'|'classificacao'>('todas');

// override manual do preço sugerido — chave EAN, guarda o target da época da edição
const [overrides, setOverrides] = useState<Map<string, { price: number; target: SuggestionTarget }>>(new Map());

// seleção por EAN — PERSISTE entre filtros/páginas; apply usa só linhas visíveis
const [selected, setSelected] = useState<Set<string>>(new Set());

// navegação por teclado (↑↓ move cursor, espaço marca/desmarca)
const [cursor, setCursor] = useState(0);
const tableWrapRef = useRef<HTMLDivElement>(null);
```

**Efeitos:**
- `setPage(1)` sempre que qualquer filtro (`name, classification, books, onlyWithSuggestion, direction, origem, perPage`) muda.
- `setCursor(0)` quando `rows` muda (página/filtro novos).
- **Seleção NÃO é limpa ao trocar filtro** (regra portada). Override idem.

**Regra crítica do override (portada):** o override guarda o `target` da edição. Se a regra mudar o alvo (P.Venda↔P.Oferta) entre fetches, `override.target !== suggestion.target` → o override é **ignorado** (cai pro preço do servidor), nunca aplicado no campo errado.

### 6. Validação / contrato (zod) — o ponto que quebrava no legado

O hook legado `usePricingSuggestionProducts.ts` **quebra** porque o `apiProductSchema` exige `id`, `curve` e os 3 campos fixos por concorrente. **Reescrever** o schema contra `ResponseProduct`:

```ts
const competitorViewSchema = z.object({
  origin: z.string(),                          // CompetitorOrigin (9 valores; não validar enum p/ tolerar novos)
  price: z.number().nullable(),                // null = sem coleta → "—"
  isPbm: z.boolean(),
  van: z.string().nullable(),
});

const productSchema = z.object({
  ean: z.string(),
  name: z.string(),
  supplier: z.string().nullable(),
  classification: z.string().nullable(),
  book: z.string().nullable(),
  cost: z.number().nullable(),                 // ATENÇÃO: number|null (não string!) — o service já normaliza
  priceForSell: z.number().nullable(),
  priceForOffer: z.number().nullable(),
  margin: z.number().nullable(),
  averageVariation: z.number().nullable(),
  status: z.string().nullable(),
  competitors: z.array(competitorViewSchema),  // generaliza 3→N; SEM id, SEM curve
});

const resultSchema = z.unknown();              // discriminated union — validar por `kind` em runtime, não no zod (igual ao legado: z.custom)
const clusterOriginSchema = z.object({
  clusterId: z.string(),
  clusterName: z.string().nullable(),
  overrodeRuleName: z.string().nullable(),
}).nullable();

const rowSchema = z.object({ product: productSchema, result: resultSchema, origem: clusterOriginSchema });
const responseSchema = z.object({
  rows: z.array(rowSchema),
  count: z.number(),
  suggestionCount: z.number(),
  lockCount: z.number(),
  activeRuleCount: z.number(),
  availableBooks: z.array(z.object({ value: z.string(), label: z.string() })),
});
```

**`SuggestionResult` é union discriminada** — sempre `if (result.kind === 'suggestion')` antes de ler `result.suggestion`; `result.kind === 'none'` expõe `result.reason` (+ `result.rule?`). Tipar à mão (não pelo zod) para preservar o narrowing.

**Mudanças de tipo vs legado (campos que quebravam):** `cost/priceForSell/priceForOffer/margin/averageVariation` agora são `number | null` (legado aceitava `string|number` e **estourava** no `null`). Remover `id` e `curve`. Substituir `drogal*/drogasil*/michelassi*` pelo array `competitors[]`.

### 7. Seleção → Aplicar (o handoff, net-new)

Diferença central do legado: o pricy aplicava por `productId` num ERP-proxy. Aqui a chave é **EAN** e o apply é o fluxo assíncrono `POST /pricing/apply` (202 + polling). **Esta tela só prepara e entrega os itens** — a tela "Aplicar em massa" (outra spec) é quem chama `/pricing/apply`.

#### 7.1 Itens elegíveis (derivado, memoizado por `rows/selected/overrides`)

```ts
type ApplyItem = { ean: string; target: 'precoVenda'|'precoOferta'; price: number; cadernoId?: number };

const itemsToApply = useMemo<ApplyItem[]>(() => {
  const byEan = new Map(rows.map(r => [r.product.ean, r]));
  const out: ApplyItem[] = [];
  for (const ean of selected) {
    const row = byEan.get(ean);                          // só linhas VISÍVEIS → dado fresco
    if (!row || row.result.kind !== 'suggestion') continue;
    const sug = row.result.suggestion;
    const ov = overrides.get(ean);
    const price = ov && ov.target === sug.target ? ov.price : sug.price;
    out.push({ ean, target: sug.target, price });        // cadernoId omitido → backend deriva do offer_book
  }
  return out;
}, [rows, selected, overrides]);
```

- **Selecionado fora da visão** (outra página/filtro) fica guardado em `selected` mas **não entra** em `itemsToApply` (não está em `rows`). Volta quando o filtro reabrir. Comportamento portado.
- **`cadernoId`:** não enviar — o backend resolve do `offer_book` quando `target='precoOferta'`. Só preencher se houver UI explícita de caderno (fora do escopo desta tela).
- **NÃO** existe mais a checagem client-side de "campanha de oferta ativa" do legado (era um endpoint do ERP-proxy). O backend novo já rejeita item em campanha **no worker** com reason `em_campanha` (`skipped`), e o `precoVenda` em campanha é tratado lá. Não reimplementar fail-closed de campanha no FE — confiar no backend (princípio: validar só na fronteira, e a fronteira aqui é o `/apply`).

#### 7.2 Handoff

`<ApplyHandoffButton disabled={itemsToApply.length === 0}>` → entrega `itemsToApply` ao fluxo Aplicar. Duas formas (escolher conforme a arquitetura de navegação do app):
- **Navegação:** `navigate('/precos/aplicar', { state: { items: itemsToApply } })`.
- **Store compartilhada** (Zustand/Context): `setApplyDraft(itemsToApply)` e abrir o modal/rota de Aplicar.

A tela Aplicar é quem chama `POST /pricing/apply` com `{ idempotencyKey, mode:'agora', items }` (202). **Limpeza pós-sucesso:** após o run ser aceito, o callback de sucesso da tela Aplicar deve devolver os **EANs efetivamente aceitos** para esta tela limpar `selected`/`overrides` desses EANs e `refetch()`. Se o handoff for por navegação, fazer a limpeza ao retornar com `applyRunId` no `location.state` (ou via store).

> Idempotência: a tela Aplicar gera `idempotencyKey` (ex.: `apply:<uuid>` por sessão de aplicação). Esta tela não gera a chave.

### 8. Renderização das células

#### 8.1 `CompetitorCell` (uma por origem — §1.2)
- `price === null` → "—". `price` → `formatCurrency(price)`.
- `isPbm === true` → badge "PBM" (`SeverityPill severity="info"`), com tooltip "Preço PBM (subsidiado) — a estratégia concorrência não segue".
- `van` (`string|null`) → texto pequeno/tooltip (código da origem). `null` → omitir.
- Cabeçalho da coluna = label da origem (mapa `CompetitorOrigin → label legível`; criar `COMPETITOR_ORIGIN_LABELS` para as 9; tolerar origem desconhecida exibindo o próprio valor).

#### 8.2 `DirectionCell` — delta %
- Recalcular no cliente considerando override (igual `suggestionDelta` do engine):
  `base = priceForOffer>0 ? priceForOffer : priceForSell`; `pct = (price - base)/base*100`; `|pct|<0.05 → null ("—")`.
- `pct>0` → ▲ verde "Subir"; `pct<0` → ▼ vermelho "Abaixar"; valor `|pct|.toFixed(1)` com vírgula.

#### 8.3 `EditableCell` "Preço Sugerido"
- Só quando `result.kind === 'suggestion'`. Valor = override (se `target` casar) senão `suggestion.price`.
- `onSave(v)`: rejeitar `!Number.isFinite(v) || v<=0` (toast "Preço sugerido precisa ser maior que zero."), arredondar 2 casas, gravar `overrides[ean] = { price, target: suggestion.target }`.
- `onRevert`: remover do `overrides`. `isEdited` = override ativo (target casa).

#### 8.4 `NoSuggestionReasonCell` — `result.kind === 'none'`
Mapa pt-BR (portado, 7 motivos do engine):
```ts
const NO_SUGGESTION_LABEL: Record<NoSuggestionReason, string> = {
  sem_regra: 'sem regra', sem_custo: 'sem custo', margem_ok: 'margem ok',
  sem_concorrente: 'sem preço concorrente', pbm: 'PBM no concorrente',
  acima_do_venda: 'acima do P. Venda', ja_no_alvo: 'já no alvo',
};
```
Linha sem sugestão: `opacity-60`, checkbox `disabled`, célula de margem mostra o label do motivo.

#### 8.5 `AppliesToCell` — alvo + composição + trava
- Badge alvo: `priceControlled` → "P. Oferta" (warn, tooltip "Preço controlado (CMED): P. Venda travado"); senão `target==='precoOferta'?'P. Oferta':'P. Venda'` (neutral).
- **Composição** só quando `basis==='concorrencia' && !lockApplied` (com trava o preço foi pro piso, não seguiu concorrente):
  - 1 entrada: "Seguindo <Label>" (+ " (menor preço)" se `competitorMode==='lowest'`).
  - N entradas: badge "Composição" + breakdown "X% Label · Y% Label" (usar `weightsToPercents` p/ somar exatamente 100). No modo `weighted`, sinalizar concorrentes configurados **sem preço** ("… s/ preço, peso redistribuído").
- `basis==='margem_minima'` → badge "Margem mínima". `basis==='margem_sem_concorrente'` → badge "s/ concorrência". `lockApplied` → ícone cadeado (tooltip explicando a trava).

#### 8.6 `ClusterOriginCell` — `origem != null`
Badge "Cluster: <clusterName ?? '—'>". Se `overrodeRuleName`, sufixo "sobrepõe <nome>" + tooltip "Sobrepõe a regra de classificação «<nome>»".

### 9. `SuggestionStatsRibbon` (contadores)
- `activeRuleCount === 0` (e não loading/erro) → estado **"sem regras"**: empty-state com CTA "Criar primeira regra" → `/precos/sugestoes/regras`. (A tabela não renderiza.)
- Senão: "**{suggestionCount}** de {totalItems} produtos filtrados com sugestão" + (se `lockCount>0`) "· {lockCount} preso(s) na trava de margem". Pill "{itemsToApply.length} selecionados" quando >0.
- **Atenção:** `count/suggestionCount/lockCount` são **pós-filtro, pré-paginação** (calculados sobre o conjunto filtrado inteiro no backend). `activeRuleCount` é o nº de regras ativas no cálculo. `availableBooks` é sobre o **conjunto inteiro** (não muda ao paginar) — usar para popular o multiselect de cadernos.

### 10. Dry-run (`DryRunRuleSheet`)
- Reusa o **form de regra** (mesmo componente da tela de Regras — `UpsertSuggestionRuleDto`, com os toggles `blockPbmInMargin`/`cascadeByPriority`). **Sem botão "Salvar"** — só "Simular".
- "Simular" → `useSuggestionPreview().mutate({ body: ruleDto, query: filtrosAtuais })` → `POST /pricing/suggestions/preview?<query>`.
- Renderiza o resultado **na mesma `SuggestionTable`**, em modo read-only (sem seleção/override — é hipótese), com banner "Pré-visualização da regra «<name>» — nada foi salvo". `activeRuleCount` virá 1.
- Validação cruzada acontece no servidor (mesma do create) → tratar 400 (ver §11). Idealmente validar no form antes (espelhar `validate()`), mas o servidor é a fronteira de verdade.

### 11. Estados de erro por HTTP

| Código | Quando | UI |
|---|---|---|
| **401** | JWT ausente/expirado | Interceptor global → redireciona pro login (ou tenta refresh). Não tratar local. |
| **403** | usuário sem `operator`/`admin` (ex.: viewer) | Tela de "sem permissão" (rota inteira). Idealmente o roteador já barra antes de montar. |
| **400** | query inválida (`direction`/`origem` fora do `@IsIn`, `perPage>1000`, `page<1`); no **preview**, validação cruzada da regra (cluster XOR classifications, concorrente inválido/duplicado, peso inválido, `concorrencia` sem concorrente, FK cluster inexistente) | GET: não deveria ocorrer (a UI só manda valores válidos) — se ocorrer, toast genérico + log. Preview: exibir a `message` pt-BR do backend no form do `DryRunRuleSheet` (é erro de usuário). |
| **5xx / rede** | falha do servidor | Bloco de erro com "Falha ao carregar as sugestões." + `error.message` + botão "Tentar de novo" (`refetch()`). Retry automático do apiClient só em 5xx (igual legado). |

- **Zod parse error** (contrato divergente): tratar como erro de carregamento (mesmo bloco), com `error.message` do zod — sinaliza incompatibilidade de contrato em vez de tela em branco. (Foi exatamente o modo de falha do legado; agora é capturado, não explode.)

### 12. Virtualização e performance
- O legado **não** virtualizava (paginava em 50). Como `perPage` pode ir a 1000, **virtualizar o corpo** com `@tanstack/react-virtual` (`useVirtualizer`, `estimateSize ≈ 40px`, `overscan: 10`) dentro do `tableWrapRef` com `overflow-auto`.
- Colunas dinâmicas: o nº de colunas de concorrente = `origins.length`. Cabeçalho e linhas usam a **mesma** lista `origins` (memoizada) para alinhar.
- `keepPreviousData` evita flash ao paginar; overlay "Atualizando…" (spinner) quando `isFetching && !isLoading`, com `opacity-60 pointer-events-none` na tabela (portado).
- **Cache-Control 30s:** `staleTime: 30_000` no Query alinha o cache do cliente à diretiva do servidor — re-render dentro de 30s usa o cache, não refaz o full-scan caro do backend.

### 13. Navegação por teclado (portada)
- Handler no `tableWrapRef` (`tabIndex={0}`, `onKeyDown`): ignora quando o foco está em `INPUT`/`TEXTAREA` (edição inline). ↑↓ movem `cursor` (clamp 0..rows.length-1) e `scrollIntoView({block:'nearest'})` na linha (`data-row-index`). Espaço marca/desmarca a linha do cursor **se** `result.kind==='suggestion'` (ignora se foco em `BUTTON`/`[role=checkbox]`, que já tratam espaço).
- Com virtualização, `scrollIntoView` deve usar o índice virtual; ao mover o cursor para fora da janela renderizada, chamar `virtualizer.scrollToIndex(next)`.

### 14. Critérios de aceite (observáveis)

1. **Carregamento:** `GET /pricing/suggestions` com os filtros default retorna 200 e a tabela renderiza linhas; o ribbon mostra "X de Y produtos filtrados com sugestão". Resposta com `Cache-Control: private, max-age=30` → segundo carregamento dentro de 30s **não** dispara novo request (cache do Query).
2. **Colunas dinâmicas:** habilitando N origens no tenant, a tabela mostra **exatamente N** colunas de concorrente, na ordem `priority ASC, origin ASC`; cada uma exibe price/"—", badge PBM quando `isPbm`, e o `van`. Trocar o conjunto de origens habilitadas muda as colunas sem deploy.
3. **Filtros server-side:** mudar `name/classification/books/direction/origem/onlyWithSuggestion` reseta para `page=1` e refaz o fetch com a querystring correta; `books` vai como CSV; `onlyWithSuggestion` só envia `"true"` quando ligado.
4. **Sem sugestão:** linhas `result.kind==='none'` aparecem com `opacity-60`, checkbox desabilitado, e o motivo em pt-BR (7 valores mapeados).
5. **Override:** editar o "Preço Sugerido" para um valor `>0` muda o delta e a margem sugerida da linha; reverter volta ao valor do servidor; se a regra mudar o `target` da sugestão, o override deixa de ser aplicado.
6. **Seleção persistente:** marcar linhas, trocar de página/filtro e voltar — a seleção dos EANs continua marcada; o "Limpar seleção (N)" zera `selected` e `overrides`.
7. **Handoff:** com ≥1 linha sugestionável selecionada, `itemsToApply` contém `{ean,target,price}` (price = override quando casa, senão sugerido) só para linhas **visíveis**; o botão Aplicar entrega esses itens ao fluxo `/pricing/apply`. Selecionado fora da visão não entra no payload.
8. **Dry-run:** abrir o `DryRunRuleSheet`, montar uma regra e "Simular" chama `POST /pricing/suggestions/preview` com a regra no body + os filtros na query, retorna 200, renderiza o resultado read-only com `activeRuleCount=1` e banner "nada foi salvo"; uma regra inválida (ex.: `concorrencia` sem concorrente) retorna 400 e a `message` pt-BR aparece no form.
9. **Contadores:** `count/suggestionCount/lockCount` refletem o conjunto **filtrado inteiro** (não só a página); `lockCount>0` mostra "N presos na trava de margem"; `activeRuleCount===0` mostra o empty-state "Criar primeira regra".
10. **Erros:** 5xx/parse-error mostram o bloco de erro com "Tentar de novo" (refetch) em vez de tela em branco; 403 leva a "sem permissão"; 400 no GET não derruba a tela.
11. **Performance:** com `perPage=1000` a tabela permanece responsiva (corpo virtualizado); navegação ↑↓ rola a linha em foco para a viewport.

### 15. Edge cases

- **Catálogo vazio / página sem linhas:** `origins = []` (sem `rows[0]`) → tabela sem colunas de concorrente; corpo mostra "Nenhum produto…". Não hardcodar 9 origens.
- **`origem='classificacao'`:** o backend filtra `origem===null && (suggestion || reason!=='sem_regra')` — ou seja, inclui linhas **sem** sugestão mas que **tinham** regra de classificação. A UI mostra essas linhas (com motivo), não só as com sugestão. Não confundir com `onlyWithSuggestion`.
- **`priceForOffer>0` força `target=precoOferta`** mesmo sem `priceControlled` (vide engine: `rule.priceControlled || product.precoOferta>0`). O badge "Aplica em" reflete isso; o override também guarda esse target.
- **`competitors[].price === 0` no backend vira `null`?** Não — o engine trata `price>0`; mas o `CompetitorView.price` pode vir `0`. Renderizar `0` como `formatCurrency(0)` é enganoso → tratar `price===0` como "sem coleta" na exibição **só se** o backend confirmar que 0 nunca é preço real. (Hoje `num()` mantém 0; assumir `0` = sem preço para concorrente é seguro pelo domínio.) **Confirmar com backend**; default: exibir "—" para `price==null`, e `R$ 0,00` literal para `0`.
- **Numéricos:** nesta resposta o service **já normaliza** para `number` (`cost`, `priceForSell`, etc. são `number|null`). Diferente do `ApplyReport.items[]` (onde `price`/`priceOld` vêm `string`). Não aplicar `Number()` defensivo aqui.

---

**Arquivos de referência (absolutos):**
- Contrato-alvo (backend): `src/tenant-api/pricing/pricing-suggestions.service.ts` (`SuggestionsResponse`, `ResponseProduct`, `CompetitorView`, `ClusterOrigin`), `.../pricing-suggestion.engine.ts` (`SuggestionResult` union, `PriceSuggestion`, `NoSuggestionReason`, `suggestionDelta`), `.../dto/list-suggestions.query.ts` (query params + `@IsIn`), `.../dto/suggestion-rule.dto.ts` (body do preview), `src/database/enums/competitor-origin.enum.ts` (9 origens).
- Porte (legado): `pricy-legacy/src/pages/precos/SugestaoPrecificacao.tsx` (tela), `.../hooks/usePricingSuggestionProducts.ts` (zod a reescrever), `.../types/pricingSuggestion.ts` (types travados em 3 concorrentes — generalizar).

---

Contract fully confirmed. The `report` query selects `price_old_sell AS "priceOld"` (note: not the offer price_old — verified detail for the UI), and run statuses are `pending`/`running`/`done`/`failed`. Here is the implementation plan section.

---

## Fluxo NET-NEW: Aplicar preço em massa (preview → apply → report → rollback) + Aprovação

Sem precedente no legado (o pricy mandava preço direto ao ERP-proxy `/scheduling`). Aqui há um **run assíncrono** com idempotência, circuit breaker, polling de relatório, histórico, rollback e (opcional) aprovação de admin. Toda a seção é `operator`/`admin`; aprovar/rejeitar é `admin`. JWT por tenant (`Authorization: Bearer`); sem `:tenant` na URL.

### 0. Máquina de estados visível ao usuário

O usuário enxerga **dois níveis de estado**: o do *run* e o de cada *item*.

**Run (`status` + `approvalStatus`):**

```
                 POST /pricing/apply (202)
                          │
          ┌───────────────┴────────────────┐
   accepted===0                       accepted>0
          │                                │
     status=done            ┌──────────────┴───────────────┐
   (nada despacha)   approvalStatus=null            approvalStatus='pending'
                     (despacha já)                  (segura dispatch)
                          │                                │
                    pending→running                 aguarda admin
                          │                     ┌──────────┴──────────┐
                       done/failed         approve(202)          reject(200)
                                           →running→done      →status=failed
                                                              (itens 'rejeitado')
```

- `status`: `pending` → `running` → `done` | `failed`. (Polling enquanto `pending`/`running`.)
- `approvalStatus`: `null` | `pending` | `approved` | `rejected`. Só vem `pending` quando `PRICING_APPLY_REQUIRES_APPROVAL=1` no servidor — **o FE detecta pela resposta, não por env**: presença de `approvalStatus:'pending'` no `POST /pricing/apply`.

**Item (`status` + `reason`):** `pending` → `applied` | `skipped` | `failed`.
- `skipped` (política, não é erro): `em_campanha`, `monitored`, `sem_external_id`.
- `failed`: `a7_nao_configurado`, `nao_encontrado`, `erp_conflito`, `erro_transitorio` (reaplicável), `rejeitado` (run rejeitado na aprovação).
- `applied` traz `erpResult` (ex.: `precoVenda=12.90` ou `precoOferta=9.90@caderno=123`) e `appliedAt`.

Mapa de cor/badge recomendado (componente `<ApplyStatusBadge status reason />`): `applied`=verde, `skipped`=âmbar, `failed`=vermelho, `pending`=cinza/spinner. Rejeições **síncronas** (do preview/POST) são distintas e nunca viram item — só aparecem na lista `rejected[]`.

### 1. Da seleção de Sugestões → itens de apply

Origem: `SugestoesPage` mantém `selected: Set<ean>` e `overrides: Map<ean, {price, target}>` (já existe no legado, mas migrado de `productId`→**EAN** — a chave ponta-a-ponta agora é EAN). Botão "Aplicar selecionados (N)" abre o `<ApplyDrawer>`.

Builder puro (testável, sem hooks):

```ts
// buildApplyItems.ts
type ApplyItem = { ean: string; target: 'precoVenda'|'precoOferta'; price: number; cadernoId?: number };

function buildApplyItems(
  selected: Set<string>,
  rows: ResponseRow[],                  // de GET /pricing/suggestions
  overrides: Map<string, { price: number; target: 'precoVenda'|'precoOferta' }>,
): ApplyItem[] {
  const byEan = new Map(rows.map(r => [r.product.ean, r]));
  return [...selected].flatMap((ean) => {
    const row = byEan.get(ean);
    const ov = overrides.get(ean);
    // alvo/preço: override manual > sugestão do motor
    const target = ov?.target ?? (row?.result.kind === 'suggestion' ? row.result.suggestion.target : 'precoVenda');
    const price  = ov?.price  ?? (row?.result.kind === 'suggestion' ? row.result.suggestion.price : NaN);
    if (!Number.isFinite(price) || price <= 0) return [];   // não enviar; sinalizar na UI
    return [{ ean, target, price }];   // cadernoId omitido → server deriva do offer_book
  });
}
```

Regras de borda do builder (validar client-side, antes de qualquer chamada):
- Linha selecionada **sem sugestão e sem override** (`result.kind==='none'`) → excluir do payload e mostrar aviso "N selecionados sem preço sugerido foram ignorados". Não bloquear o resto.
- `price` deve ser `>0` e finito (mesma trava do legado). Override inválido → toast e remove da seleção.
- **Não** enviar `cadernoId` por padrão; só preenchê-lo se a UI tiver um seletor explícito de caderno (raro). O server resolve via `offer_book`; se não resolver, o item volta `rejected:sem_caderno`.
- `ArrayMaxSize(5000)`: se `selected.size > 5000`, bloquear com mensagem "Máximo 5000 itens por lote".

### 2. DRY-RUN — `POST /pricing/apply/preview` (HTTP 200, nada persiste)

Chamada exata:
```
POST /pricing/apply/preview
Body: { items: ApplyItem[] }            // PreviewApplyDto: ArrayMinSize(1), ArrayMaxSize(5000)
→ 200 ApplyPreview {
    total, 
    accepted: { ean, target, price, basis: string|null }[],
    rejected: { ean, reason }[],
    wouldAbort: boolean
  }
```

Hook:
```ts
function usePreviewApply() {
  return useMutation({
    mutationFn: (items: ApplyItem[]) =>
      api.post<ApplyPreview>('/pricing/apply/preview', { items }),
  });
}
```

UI do passo de confirmação (`<ApplyPreviewStep>`):
- Cabeçalho: `accepted.length` aceitos · `rejected.length` rejeitados · `total`.
- Se `wouldAbort === true`: banner vermelho **bloqueante** "Lote seria abortado pela checagem de sanidade (>50% rejeitado em lote ≥10). Revise os preços/regras." e **desabilita** o botão "Aplicar agora". Esse é o pré-check do circuit breaker — evita o 422 no apply real.
- Tabela de `rejected[]` agrupada por `reason` com rótulos pt-BR (mapa `APPLY_REJECT_LABELS`):
  - `nao_encontrado`→"EAN fora do catálogo", `sem_custo`→"Sem custo cadastrado", `preco_invalido`→"Preço ≤ 0", `abaixo_do_piso`→"Abaixo da margem mínima", `variacao_excessiva`→"Variação suspeita (>3x ou <⅓)", `acima_do_venda`→"Oferta acima do preço de venda", `sem_caderno`→"Oferta sem caderno".
- `accepted[]` mostra `target` (P. Venda / P. Oferta), `price` formatado e `basis` (`concorrencia`/`margem_minima`/`margem_sem_concorrente`/`null`→"manual").
- Botão primário "Aplicar agora" só habilita quando `accepted.length > 0 && !wouldAbort`.

Erros do preview:
- **400** body inválido (item sem `ean`/`target`/`price`, `price<0`, `>5000`) → erro de validação local antes; se vier do servidor, toast "Itens inválidos".
- **401** → redirect login. **403** (viewer) → tela não deveria estar acessível; guard de rota por role.

### 3. CONFIRMAR — `POST /pricing/apply` (HTTP 202)

`idempotencyKey` **gerada no cliente** no momento em que o drawer abre (não a cada clique), e reusada em retries. Usar `crypto.randomUUID()`. Persistir a key no estado do drawer para que um duplo-clique/retry de rede caia na mesma key.

```
POST /pricing/apply
Body: { idempotencyKey: string (1..200), mode?: 'agora', items: ApplyItem[] (1..5000) }
→ 202 ApplyResponse {
    applyRunId: string,
    accepted: number,
    rejected: { ean, reason }[],
    idempotent?: boolean,
    approvalStatus?: 'pending'
  }
```

Hook:
```ts
function useApplyPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { idempotencyKey: string; items: ApplyItem[] }) =>
      api.post<ApplyResponse>('/pricing/apply', { mode: 'agora', ...vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apply','list'] }),
  });
}
```

Tratamento da resposta 202 (decisão de roteamento de UI):
1. `idempotent === true` → POST reincidiu na key existente; **não** é novo run nem nova auditoria. Mostrar "Lote já enviado" e navegar direto pro report de `applyRunId` (que pode já estar `done`).
2. `approvalStatus === 'pending'` → run criado mas **não despachado**. Mostrar estado "Aguardando aprovação de um administrador"; limpar `selected`; navegar pro report (que ficará `pending` até approve). Não fazer polling agressivo (ver §4).
3. `accepted === 0` → run nasce `done`, nada despachado. Mostrar "Nenhum item aplicável" + lista `rejected[]`. Não navegar pro polling (status já final).
4. Caso normal (`accepted>0`, sem approval) → limpar `selected`/`overrides` dos EANs aceitos, navegar pro report e iniciar polling.

**Limpeza de seleção por EAN** (não por productId): remover de `selected` somente os EANs que entraram em `accepted` (os `rejected` permanecem selecionados para correção).

Erros do POST:
- **422 circuit breaker**: corpo `{ message, aborted:true, rejected: {ean,reason}[] }`. Não navegar; reabrir o passo de preview com o banner vermelho e a lista `rejected` do corpo do erro. Mensagem do `message` (já em pt-BR: "Lote abortado: N/M itens rejeitados…"). O cliente deve **ler `error.response.data.rejected`** para repopular a tabela.
- **400** body/validação → toast; manter drawer aberto.
- **401** → login. **403** → guard (não deveria ocorrer aqui).
- Falha de rede/5xx → o `api` faz retry de 5xx; como há `idempotencyKey`, o retry é seguro (no pior caso retorna `idempotent:true`).

### 4. ACOMPANHAR — `GET /pricing/apply/:id` (polling)

```
GET /pricing/apply/:id?page=&perPage=
→ 200 ApplyReport {
    id, status, mode, approvalStatus,
    total, applied, skipped, failed,
    items: ApplyReportItem[]
  }
```
`ApplyReportItem`: `{ ean, target, price(string), status, reason(string|null), basis(string|null), priceOld(string|null), cadernoId(string|null), ruleId(string|null), erpResult(string|null), appliedAt(string|null) }`.
Atenção de fidelidade (PG numeric→string): `price`, `priceOld`, `cadernoId` chegam como **string** — formatar com `Number(...)`. **`priceOld` é sempre o `price_old_sell`** (o backend seleciona só o de venda mesmo para itens de oferta); não confie nele para reverter oferta na UI — o rollback é server-side.

Hook com polling condicional (TanStack Query `refetchInterval` que para em estado final):
```ts
function useApplyReport(id: string, page = 1, perPage = 100) {
  return useQuery({
    queryKey: ['apply','report', id, page, perPage],
    queryFn: () => api.get<ApplyReport>(`/pricing/apply/${id}`, { params: { page, perPage } }),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      // Polla enquanto trabalha; para em done/failed. 'pending' com approval pendente NÃO é "rodando".
      if (s === 'running' || (s === 'pending' && q.state.data?.approvalStatus !== 'pending')) return 2000;
      return false;
    },
  });
}
```
Regra de polling fina:
- `status==='pending'` **e** `approvalStatus==='pending'` → **não** pollar a 2s (não está rodando, está esperando humano). Pollar devagar (ex.: 15s) ou só on-focus, ou nem pollar e oferecer "Atualizar".
- `status==='running'` ou `pending` sem approval → poll 2s até `done`/`failed`.
- `done`/`failed` → para.

UI do report (`<ApplyReportView>`):
- Header: barra de progresso `applied + skipped + failed` / `total`; chips `applied`/`skipped`/`failed`; badge de `status` e (se houver) `approvalStatus`.
- Tabela paginada de `items` (server-side via `page`/`perPage`, default 100, cap 1000 — mandar como **string** na query): colunas EAN · Alvo · Preço · Preço anterior · `<ApplyStatusBadge>` · Motivo (rótulo pt-BR de §0) · `erpResult` · Aplicado em.
- Filtro client-side por status (applied/skipped/failed) para triagem.
- Se `status==='failed'` com itens `erro_transitorio`: CTA "Reaplicar transitórios" que monta um novo lote (novo `idempotencyKey`) só com esses EANs e volta ao §2.

Erros: **404** `apply run {id} not found` → tela "Run não encontrado" (pode ter sido soft-deletado pelo TTL `PRICING_RUN_TTL_DAYS`). **400** `:id` não-UUID → 404 client-side.

### 5. HISTÓRICO — `GET /pricing/apply` (lista paginada)

```
GET /pricing/apply?page=&perPage=          // strings; default page=1, perPage=100, cap 1000
→ 200 ApplyRunSummary[] {
    id, status, mode, approvalStatus, total, applied, skipped, failed, createdAt
  }[]
```
(Resposta é **array puro**, sem envelope de total — paginação é "tem próxima página se vier `perPage` itens". Mandar `page`/`perPage` como string.)

`<ApplyHistoryPage>`:
- Tabela: Data (`createdAt`) · Status · Aprovação (`approvalStatus`) · Total · Aplicados · Pulados · Falhos · ação "Ver". Linha → `<ApplyReportView>` do `id`.
- Coluna Aprovação destaca `pending` (precisa de admin). Para `admin`, botões inline approve/reject (ver §7).
- Botão "Desfazer" (rollback) visível quando `status==='done' && applied>0` (ver §6). Esconder para runs sem itens aplicados.
- Paginação simples (prev/next) já que não há `count` total.

### 6. ROLLBACK — `POST /pricing/apply/:id/rollback` (HTTP 202)

```
POST /pricing/apply/:id/rollback           // sem body
→ 202 ApplyResponse  // novo run que reaplica price_old dos itens 'applied'; idempotencyKey="rollback:<runId>"
```
- É um **novo apply enfileirado** (passa pelas mesmas guarda-corpos). A resposta é um `ApplyResponse` com `applyRunId` do *run de rollback*. Após 202, navegar pro report desse novo run e pollar (§4).
- Idempotente por `rollback:<runId>`: re-POST retorna `idempotent:true` apontando o mesmo run de reversão (não cria outro). Tratar igual ao §3.1.
- `<RollbackConfirmDialog>`: confirmação explícita ("Reaplicar os preços anteriores dos N itens aplicados deste lote?"). Disparar só após confirmar.

Erros:
- **404** run inexistente.
- **422** `{ message: "Run {id} não tem item aplicado reversível." }` → o run não tem nenhum item `applied` com `price_old>0`. Mostrar a `message`; desabilitar o botão preventivamente quando `applied===0`.
- Itens individuais podem voltar a ser rejeitados na revalidação (preço anterior hoje inválido) — aparecem no `rejected[]`/report do run de rollback, não abortam o resto (salvo se baterem no circuit breaker → 422 com `aborted:true`).

### 7. APROVAÇÃO (admin) — quando `approvalStatus==='pending'`

Só aparece quando o servidor está com `PRICING_APPLY_REQUIRES_APPROVAL=1` (FE detecta pela resposta). Ações são **admin-only** (guard de role; esconder botões para operator).

```
POST /pricing/apply/:id/approve   → 202 { id, approved: true }   // despacha ao ERP; run → running
POST /pricing/apply/:id/reject    → 200 { id, rejected: true }   // run → failed; itens pending → failed/'rejeitado'
```

`<ApprovalActions runId>` (no report e na linha do histórico):
- Botões "Aprovar" / "Rejeitar", visíveis só se `approvalStatus==='pending'` e role `admin`.
- `approve` (202): após sucesso, invalidar report; iniciar polling 2s (agora vai despachar). 
- `reject` (200): após sucesso, mostrar "Lote rejeitado"; status vira `failed`, itens `pending`→`failed/rejeitado`. Sem polling.
- **409** em re-decisão: corpo "apply run {id} não está aguardando aprovação (approved/rejected/sem aprovação)." → o run já foi decidido (provável corrida entre dois admins). Tratar otimisticamente: toast informativo + **refetch do report** para refletir o estado atual; não tratar como erro fatal.
- **404** run inexistente. **403** se um operator tentar (não deveria — botão escondido).

Hooks:
```ts
function useApproveRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/pricing/apply/${id}/approve`),
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ['apply','report', id] });
                             qc.invalidateQueries({ queryKey: ['apply','list'] }); },
  });
}
function useRejectRun() { /* idem, POST .../reject */ }
```

### 8. Componentes nomeados (resumo)

- `<ApplyDrawer>` — orquestra o fluxo; guarda `idempotencyKey` estável, `items`, e o passo atual (`preview | confirm | running`).
- `<ApplyPreviewStep>` — consome `usePreviewApply`; renderiza `accepted`/`rejected`/`wouldAbort`.
- `<ApplyReportView>` — consome `useApplyReport`; barra de progresso + tabela paginada + `<ApprovalActions>` + CTA rollback/reaplicar.
- `<ApplyHistoryPage>` — consome `useApplyList`.
- `<ApplyStatusBadge status reason />`, `<RunStatusBadge status approvalStatus />` — apresentação.
- `<RollbackConfirmDialog>`, `<ApprovalActions runId approvalStatus />`.
- Mapas de rótulo pt-BR: `APPLY_REJECT_LABELS` (síncrono, §2), `APPLY_ITEM_REASON_LABELS` (assíncrono, §0).

### 9. Tabela de tratamento por código HTTP (consolidada)

| Endpoint | Código | Significado | Ação na UI |
|---|---|---|---|
| `POST /apply/preview` | 200 | dry-run ok | renderizar accepted/rejected/wouldAbort |
| `POST /apply/preview` | 400 | item inválido/`>5000` | validar local antes; toast se vier do server |
| `POST /apply` | 202 | run criado/enfileirado | rotear por `idempotent`/`approvalStatus`/`accepted` (§3) |
| `POST /apply` | 422 | circuit breaker (`aborted:true`) | voltar ao preview, banner + `error.data.rejected` |
| `POST /apply/:id/approve` | 202 | aprovado, despachando | invalidar+poll |
| `POST /apply/:id/approve` | 409 | não está `pending` | toast + refetch report (estado mudou) |
| `POST /apply/:id/reject` | 200 | rejeitado | status→failed; sem poll |
| `POST /apply/:id/reject` | 409 | não está `pending` | toast + refetch |
| `GET /apply` | 200 | lista de runs | tabela; paginação prev/next |
| `GET /apply/:id` | 200 | report | progresso + itens; poll se running |
| `GET /apply/:id` | 404 | inexistente/TTL-expirado | tela "Run não encontrado" |
| `POST /apply/:id/rollback` | 202 | run de reversão criado | navegar+poll (tratar `idempotent`) |
| `POST /apply/:id/rollback` | 422 | sem item reversível | mostrar `message`; desabilitar quando `applied===0` |
| qualquer | 401 | sem/inv. JWT | redirect login |
| qualquer | 403 | role insuficiente | guard de rota (operator não vê approve/reject; viewer não vê nada) |

### 10. Critérios de aceite observáveis

1. Selecionar N sugestões e clicar "Aplicar" abre o drawer e dispara **um** `POST /pricing/apply/preview` com exatamente os itens `{ean,target,price}` derivados (override > sugestão); linhas sem preço são omitidas e contadas no aviso.
2. `wouldAbort:true` no preview **desabilita** "Aplicar agora" e mostra banner; nenhum `POST /pricing/apply` é emitido.
3. "Aplicar agora" envia `POST /pricing/apply` com a **mesma `idempotencyKey`** em retries; um segundo clique não cria segundo run (resposta `idempotent:true` reaproveitada).
4. 422 do apply real reabre o preview com a lista `rejected` vinda do **corpo do erro** (`error.data.rejected`), não de uma nova chamada.
5. Após 202 normal, a tela navega ao report e faz polling a ~2s; ao atingir `done`/`failed` o polling **para** (sem requisições adicionais no network tab).
6. Run com `approvalStatus:'pending'` **não** é pollado a 2s; mostra "Aguardando aprovação"; e (como admin) os botões Aprovar/Rejeitar aparecem; aprovar dispara `POST .../approve` (202) e o run passa a `running`.
7. Re-aprovar/re-rejeitar um run já decidido recebe **409** e a UI faz refetch do report sem quebrar.
8. "Desfazer" em run `done` com `applied>0` chama `POST .../rollback` (202), navega ao run de reversão e mostra seu progresso; em run sem aplicados, o botão está desabilitado e o 422 (`message`) é exibido se forçado.
9. Itens no report renderizam status+motivo com rótulos pt-BR corretos para todos os reasons síncronos (§2) e assíncronos (§0); `price`/`priceOld`/`cadernoId` são formatados a partir de **string**.
10. `viewer` não acessa a tela; `operator` vê tudo exceto approve/reject; `admin` vê tudo.

---

Arquivos-fonte verificados (verdade de base, caminhos absolutos):
- Controller: `src/tenant-api/pricing/pricing-apply.controller.ts` — confirma 202/200, roles, ParseUUIDPipe, leitura de `PRICING_APPLY_REQUIRES_APPROVAL` e ações de auditoria `apply`/`apply_pending`/`approve`/`reject`/`rollback`.
- Service: `src/tenant-api/pricing/pricing-apply.service.ts` — circuit breaker (`CIRCUIT_MIN_ITEMS=10`, `>50%`), idempotência (`ON CONFLICT`/`rollback:<runId>`), dedup `(ean|target)`, reasons síncronos, e o report select onde `priceOld` = `price_old_sell`.
- DTOs: `src/tenant-api/pricing/dto/apply.dto.ts` — `ApplyItemDto`/`ApplyPricesDto`/`PreviewApplyDto` com limites (`1..5000`, `idempotencyKey 1..200`).
- Worker (reasons assíncronos): `src/pipeline/steps/apply-price.step.ts` — `applied/skipped/failed` + `em_campanha`/`monitored`/`sem_external_id`/`a7_nao_configurado`/`nao_encontrado`/`erp_conflito`/`erro_transitorio` e gravação de `erp_result`/`applied_at`.

---

I have everything I need. The cron fires `EVERY_MINUTE` (per-minute granularity confirmed), `recalc` swaps both price AND target via the engine, `cronExpr` re-arms, cancel is a status guard (409 if not pending). Here is the FE implementation section.

---

## Fluxo NET-NEW: Agendamentos (one-shot + recorrente + recálculo)

> Sem precedente no legado (pricy só gravava `executionDate` no ERP, sem UI própria). Todo o fluxo abaixo é design do zero. Rota base: `/pricing/schedules`. Roles: **`operator`/`admin`** em todas as rotas. Tenant vem do JWT (`Authorization: Bearer`), nunca do path.

### 0. Conceitos que a UI precisa traduzir para o usuário (copy obrigatória)

Dois eixos **independentes e ortogonais** — a tela deve deixar isso explícito, porque o usuário confunde:

1. **Quando dispara** — *one-shot* (`runAt` apenas) vs *recorrente* (`runAt` é a primeira ocorrência + `cronExpr` re-arma para a próxima após cada disparo). Backend confirmado: `reArm()` recalcula `run_at = nextOccurrence(cronExpr)` e volta status para `pending`; one-shot vira `fired` permanente.
2. **Qual preço aplica** — *congelado* (`recalc: false`, default — aplica exatamente o `{ean,target,price}` que o operador viu e aprovou) vs *recalculado* (`recalc: true` — no disparo o motor recalcula preço **E alvo** pelo catálogo do momento; itens sem sugestão no disparo são **descartados silenciosamente**).

Copy de referência (componente `<ScheduleConceptHelp />`, dois `Tooltip`/`Popover` reaproveitáveis):
- One-shot vs recorrente: *"One-shot dispara uma vez em [data]. Recorrente usa [data] como primeiro disparo e repete conforme o cron — a granularidade efetiva é por minuto (o cron é avaliado a cada minuto)."*
- Congelado vs recalc: *"Congelado aplica os preços que você revisou agora. Recalcular pelo motor ignora os preços congelados: no disparo, o motor recalcula preço e alvo (venda/oferta) de cada produto pelas regras vigentes — produtos sem sugestão no momento são pulados."*

> **Aviso crítico de recalc (banner amarelo no form quando `recalc` ligado):** *"Com recálculo, o preço e o alvo finais podem diferir do que você está vendo. Itens sem sugestão no disparo não serão aplicados."* — isto reflete `recalcItems()` que troca `target` pela escolha do motor e faz `flatMap` descartando `undefined`.

---

### 1. Componentes (nomes + responsabilidade)

| Componente | Tipo | Responsabilidade |
|---|---|---|
| `SchedulesPage` | rota `/precos/agendamentos` | container: `useSchedules()` (lista), botão "Novo agendamento", estado de criação |
| `SchedulesTable` | tabela shadcn `<Table>` (sem virtualização — runs são poucos) | colunas abaixo; ação cancelar; linha clicável → detalhe |
| `ScheduleStatusBadge` | presentational | `pending`→azul "Agendado", `fired`→verde "Disparado", `cancelled`→cinza "Cancelado" |
| `ScheduleRecurrenceBadge` | presentational | `cronExpr` null → "Único"; senão badge com `humanizeCron(cronExpr)` + ícone `Repeat` |
| `ScheduleRecalcBadge` | presentational | `recalc` true → badge "Recalcula no disparo" (ícone `RefreshCw`); false → "Congelado" (ícone `Lock`) |
| `CreateScheduleDialog` | `Dialog` + `react-hook-form` + `zod` | form de criação; recebe `items: ApplyItem[]` por prop (vindo da seleção da tela de Sugestões) |
| `CronBuilder` | controlado (`value: string \| undefined`, `onChange`) | builder amigável de cron — ver §3 |
| `ScheduleDetailDrawer` | `Sheet`/`Drawer` | `useSchedule(id)`; mostra itens, recorrência, recalc, link para o report do `applyRunId` |
| `ScheduleItemsSummary` | presentational | `itemCount` + amostra dos primeiros N EANs/targets (itens completos não voltam na lista; só `itemCount`) |
| `CancelScheduleButton` | botão + `AlertDialog` confirm | só habilitado quando `status === 'pending'`; chama `cancelSchedule(id)` |
| `ScheduleConceptHelp` | dois `Popover` | copy do §0 |

> **Origem dos `items`:** o form **não monta itens do zero**. Ele recebe `items: ApplyItem[]` da tela de Sugestões (mesma seleção/override por EAN que alimenta `POST /pricing/apply`). "Agendar" é uma alternativa a "Aplicar agora" no mesmo fluxo de seleção. `CreateScheduleDialog` é aberto pela tela de Sugestões com os itens já congelados; a página `SchedulesPage` só lista/cancela/detalha.

---

### 2. Estado

#### `SchedulesPage`
```ts
// dados via TanStack Query (sem estado local de lista)
const { data: schedules, isLoading, error } = useSchedules();        // GET /pricing/schedules
const [detailId, setDetailId] = useState<string | null>(null);       // abre drawer
// criação só existe quando aberta a partir de Sugestões; ver CreateScheduleDialog
```

#### `CreateScheduleDialog` (react-hook-form + zod resolver)
```ts
interface ScheduleFormValues {
  runAt: string;                 // ISO; do <DateTimePicker>. Default: agora + 1h, arredondado ao minuto
  recurrent: boolean;            // toggle "Repetir" → habilita CronBuilder
  cronExpr?: string;             // só quando recurrent; produzido pelo CronBuilder
  recalc: boolean;               // toggle congelado/recalc. default false
}
// items NÃO está no form — vem por prop (já validado pelo fluxo Aplicar)
const form = useForm<ScheduleFormValues>({ resolver: zodResolver(scheduleSchema), defaultValues: {
  runAt: defaultRunAt(), recurrent: false, recalc: false,
}});
```

#### `CronBuilder`
```ts
type CronMode = 'daily' | 'weekly' | 'monthly' | 'advanced';
interface CronBuilderState {
  mode: CronMode;
  time: string;        // "HH:mm" (presets daily/weekly/monthly)
  weekday: number;     // 0..6 (weekly)
  monthday: number;    // 1..28 (monthly — cap 28 p/ evitar meses curtos)
  raw: string;         // textarea (advanced)
}
// emite cronExpr de 5 campos via onChange a cada mudança
```

---

### 3. CronBuilder — builder amigável (presets + avançado)

O backend valida com `validateCronExpression` da lib `cron` e roda o disparo `@Cron(EVERY_MINUTE)` — **granularidade efetiva é por minuto**. O builder gera **cron de 5 campos** (`min hour dom month dow`).

**Presets → expressão gerada:**

| Preset | UI | cron gerado (ex.: 08:30) |
|---|---|---|
| Diário | seletor de hora `HH:mm` | `30 8 * * *` |
| Semanal | hora + dia da semana (dom–sáb) | `30 8 * * 1` (segunda) |
| Mensal | hora + dia do mês (1–28) | `30 8 15 * *` (dia 15) |
| Avançado | `<textarea>` cron cru + preview | string como digitada |

**Regras do builder:**
- **Limite a dia 1–28 no mensal** (evita pular fevereiro). Texto auxiliar: *"Para dia 29–31 use o modo Avançado."*
- **Length 9–100** (constraint do DTO `@Length(9,100)`): valide client-side antes de enviar. Cron de 5 campos cabe nessa faixa; bloqueie só o caso degenerado (`cronExpr.length < 9`) com mensagem própria.
- **Validação client-side leve** (não reimplementar o parser): regex de sanidade dos 5 campos + length. O parser **autoritativo é o backend** — sempre tratar o 400 (§6).
- **`humanizeCron(cronExpr)`** para o preview e os badges da lista: traduz os presets conhecidos para pt-BR ("Todo dia às 08:30", "Toda segunda às 08:30", "Dia 15 de cada mês às 08:30"); para expressões fora dos presets, exibe a string crua com um `Tooltip` "expressão cron".
- **Aviso de granularidade** (texto fixo sob o builder): *"O agendamento é avaliado a cada minuto; segundos são ignorados."*
- **Modo avançado → preview "próximos 3 disparos"** opcional via lib client-side (ex.: `cron-parser`) **apenas para feedback visual**; nunca como gate (o backend decide). Se a lib falhar em parsear, mostre "não foi possível pré-visualizar" e deixe o backend validar.

**Zod do form (cross-field):**
```ts
const scheduleSchema = z.object({
  runAt: z.string().datetime(),                       // ISO
  recurrent: z.boolean(),
  cronExpr: z.string().min(9).max(100).optional(),
  recalc: z.boolean(),
}).refine(v => !v.recurrent || !!v.cronExpr, {
  path: ['cronExpr'], message: 'Defina a recorrência.',
}).refine(v => new Date(v.runAt).getTime() > Date.now(), {
  path: ['runAt'], message: 'A data de disparo deve ser no futuro.',
});
```
> `runAt` no futuro é validação **só de UX** (o backend aceita passado — o cron pega `run_at <= now()` no próximo minuto e dispara imediatamente). Permita override "agendar mesmo assim" se o produto quiser, mas o default deve barrar passado.

---

### 4. Chamadas de API (método + path + payload exatos)

Hooks em `useSchedules.ts` (TanStack Query), apontando para o NestJS REST (não mais `fn/<edge>`).

#### Listar — `useSchedules()`
```
GET /pricing/schedules
→ 200  ScheduleView[]
```
`queryKey: ['schedules']`. Cache curto; refetch on focus. `ScheduleView`:
```ts
interface ScheduleView {
  id: string; runAt: string /*ISO*/; status: 'pending'|'fired'|'cancelled';
  applyRunId: string | null; itemCount: number;
  cronExpr: string | null; recalc: boolean; createdAt: string /*ISO*/;
}
```

#### Detalhe — `useSchedule(id)`
```
GET /pricing/schedules/:id
→ 200 ScheduleView   | 404 schedule {id} not found
```
`queryKey: ['schedules', id]`, `enabled: !!id`. **Nota:** o detalhe **não traz os itens** (`items` não está no `ScheduleView`; só `itemCount`). O drawer mostra `itemCount` + os campos; para ver itens aplicados, siga o `applyRunId` → report (§5).

#### Criar — `useCreateSchedule()`
```
POST /pricing/schedules
Content-Type: application/json
Body (CreateScheduleDto):
{
  "runAt": "2026-06-24T11:30:00.000Z",          // ISO (IsDateString) — obrigatório
  "items": [                                     // 1..5000 (ApplyItemDto)
    { "ean": "7891234567890", "target": "precoVenda", "price": 12.90 },
    { "ean": "7890000000001", "target": "precoOferta", "price": 9.90, "cadernoId": 123 }
  ],
  "cronExpr": "30 8 * * 1",                       // opcional — torna recorrente
  "recalc": false                                 // opcional, default false
}
→ 201 ScheduleView
```
**Montagem do body a partir do form:** `cronExpr` só presente quando `recurrent === true`; quando one-shot, **omita a chave** (não envie `""` nem `null` — `@IsOptional` + `@Length(9,100)` rejeitaria string vazia com 400). `recalc` envia o boolean do toggle. `items` vem da prop. `mode` não existe no schedule (é só do apply ad-hoc).

`onSuccess`: `invalidateQueries(['schedules'])`, toast "Agendamento criado", fecha o dialog.

#### Cancelar — `useCancelSchedule()`
```
DELETE /pricing/schedules/:id
→ 200 { id: string, cancelled: true }
   | 404 schedule {id} not found
   | 409 schedule {id} is {status} and cannot be cancelled
```
`onSuccess`: `invalidateQueries(['schedules'])` + `invalidateQueries(['schedules', id])`, toast "Agendamento cancelado".
`onError` 409: **não** é erro de fato — significa que o cron já disparou (race). Toast informativo + `invalidateQueries(['schedules'])` para puxar o novo status (`fired`). Ver §6.

---

### 5. Ligação `applyRunId` → report do fluxo Aplicar

- Na lista e no detalhe, quando `applyRunId != null`, renderize **link "Ver resultado do disparo"** → navega para o report do fluxo Aplicar: `GET /pricing/apply/:applyRunId` (tela `ApplyRunReport`). É o mesmo report do apply ad-hoc (status por item, motivos `applied/skipped/failed`).
- **Recorrente:** `applyRunId` é **o último disparo** (backend sobrescreve `apply_run_id` em cada `reArm`). Deixe claro na UI: rótulo "Último disparo:" + `humanize(createdAt do run)`. Disparos anteriores de um recorrente **não são recuperáveis por esta tela** — para histórico completo, use a tela de Histórico de runs (`GET /pricing/apply`).
- **`applyRunId === null` num `fired`:** acontece quando o disparo não teve item aplicável (recalc descartou tudo, ou items vazios). Mostre "Disparado sem aplicação" (cinza), sem link. Backend: `markFired(..., null)`.
- Para o report em si, **não** poll a partir desta tela; ao clicar no link, a tela `ApplyRunReport` faz o polling enquanto `status` for `pending`/`running`.

---

### 6. Estados de erro por código HTTP

| Código | Quando | Tratamento na UI |
|---|---|---|
| **400** | body inválido; **`cronExpr` inválido** → `"cron inválido: <expr>"`; `cronExpr` fora de 9–100; `runAt` não-ISO; `items` vazio/>5000 ou `ApplyItemDto` inválido (`price<0`, `target` fora do enum) | Mapear no form: se a mensagem casa `^cron inválido` → erro no campo `cronExpr` ("Expressão cron inválida — revise"); demais → erro no campo correspondente ou toast genérico. **Sempre tratar 400 de cron** mesmo com validação client-side (parser autoritativo é o backend). |
| **401** | sem JWT / token expirado | interceptor global → refresh ou redirect login (fora deste módulo) |
| **403** | role `viewer` | esta tela não deve ser acessível a viewer; se chegar, "Sem permissão" |
| **404** | `:id` inexistente em GET detalhe / DELETE | drawer: "Agendamento não encontrado" + fechar; DELETE: toast + `invalidateQueries(['schedules'])` |
| **409** | DELETE de schedule já não-`pending` (`fired`/`cancelled`) | **não tratar como falha dura.** Toast: "Este agendamento já foi disparado e não pode ser cancelado." + refetch da lista (o status real virá `fired`). Desabilitar o botão de cancelar de antemão quando `status !== 'pending'` reduz a janela. |
| **5xx** | erro de servidor | toast "Erro ao salvar agendamento, tente novamente"; o `apiClient` já faz retry de 5xx |

> **Parsing do 400 de cron:** o backend retorna `BadRequestException(`cron inválido: ${expr}`)`. O `message` do NestJS pode vir como `string` (exceção custom) — leia `error.response.message` (string ou `string[]` do ValidationPipe) e cheque `String(msg).startsWith('cron inválido')`.

---

### 7. Edge cases

1. **One-shot com `runAt` no passado:** backend aceita; o cron dispara no próximo minuto. UI default barra (zod), mas se permitido, avise "Será disparado imediatamente."
2. **Recorrente com `runAt` no passado:** primeira ocorrência dispara já no próximo minuto, depois `reArm` para a próxima do cron. Avise igual ao item 1.
3. **`recalc: true` que descarta todos os itens no disparo:** `fired` com `applyRunId: null`. A lista deve renderizar "Disparado sem aplicação" — não deixe parecer sucesso aplicado.
4. **Cancelar durante a janela de disparo (race):** UPDATE filtra `status='pending'`; se o cron já travou a linha (`FOR UPDATE SKIP LOCKED`) e disparou, o cancel afeta 0 linhas → 409. Tratar como item 409 acima.
5. **Granularidade segundos:** usuário digita cron com 6 campos (com segundos) no avançado. A lib `cron` do backend aceita 6 campos, mas o disparo é por minuto — segundos são efetivamente ignorados. Avise no helper de granularidade; não bloqueie.
6. **`cronExpr` válido mas que nunca casa** (ex.: `0 0 30 2 *` — 30 de fevereiro): backend valida sintaxe, não semântica de "existe próxima ocorrência". `reArm` calcula `nextOccurrence` que pode lançar/retornar inválido — não há proteção no backend hoje. **Mitigação FE:** no preview avançado, se `cron-parser` não achar próxima ocorrência em 4 anos, alertar "Esta expressão pode nunca disparar."
7. **`cronExpr` enviado como `""`:** `@Length(9,100)` rejeita → 400. Garantir que one-shot **omite** a chave (não manda string vazia).
8. **`items` com `precoOferta` sem `cadernoId`:** aceito no schedule (o `ApplyItemDto` torna `cadernoId` opcional); a derivação/rejeição (`sem_caderno`) acontece **no disparo**, dentro do apply — aparece no report, não no POST do schedule. Não bloquear no form do agendamento.
9. **Lista vazia:** estado vazio "Nenhum agendamento" + CTA que leva à tela de Sugestões (onde se monta a seleção).
10. **Detalhe não traz itens:** não prometa lista de produtos no drawer; só `itemCount`. Itens reais só via `applyRunId` → report.

---

### 8. Critérios de aceite (observáveis)

1. **Criar one-shot congelado:** seleção na tela de Sugestões → "Agendar" → escolho data futura, recorrência OFF, recalc OFF → `POST /pricing/schedules` com body **sem** `cronExpr`, `recalc:false` → 201 → o agendamento aparece na lista com badges "Único" + "Congelado" + "Agendado".
2. **Criar recorrente (preset semanal):** ligo "Repetir" → preset Semanal, segunda, 08:30 → preview mostra "Toda segunda às 08:30" → salvo → body com `cronExpr:"30 8 * * 1"` → lista mostra badge "Repete" com o texto humanizado.
3. **Cron inválido:** modo avançado, digito `99 99 * * *` → salvo → backend 400 `"cron inválido: ..."` → erro inline no campo `cronExpr`, dialog **não** fecha, nada criado.
4. **Recalc ON mostra aviso:** ligo "Recalcular pelo motor" → banner amarelo de aviso aparece; ao salvar, badge "Recalcula no disparo" na lista.
5. **Cancelar pending:** schedule `pending` → botão Cancelar habilitado → confirmo → `DELETE` 200 → some/marca "Cancelado", lista atualizada.
6. **Cancelar já disparado:** schedule `fired` → botão Cancelar **desabilitado**; se forçado por race → 409 → toast "já foi disparado" + lista mostra `fired` (sem erro vermelho).
7. **Link para o report:** schedule `fired` com `applyRunId` → "Ver resultado do disparo" navega ao report do apply (`/precos/aplicar/<runId>` ou equivalente) e exibe status por item.
8. **Fired sem aplicação:** schedule recalc que descartou tudo → `fired`, `applyRunId:null` → UI mostra "Disparado sem aplicação", sem link, sem aparência de sucesso.
9. **Granularidade comunicada:** o builder exibe o aviso "avaliado a cada minuto; segundos ignorados" em todos os modos.
10. **403 para viewer:** usuário viewer não acessa `/precos/agendamentos` (rota guardada).

---

Arquivos backend de referência (verdade do contrato): controller `src/tenant-api/pricing/pricing-schedule.controller.ts`; DTO `src/tenant-api/pricing/dto/schedule.dto.ts`; service (shape `ScheduleView`, validação de cron, guard de cancel 409) `src/tenant-api/pricing/pricing-schedule.service.ts`; cron (`EVERY_MINUTE`, recalc troca preço+alvo, re-arma, `markFired(null)`) `src/tenant-api/pricing/pricing-schedule.cron.ts`; item base `ApplyItemDto` `src/tenant-api/pricing/dto/apply.dto.ts`.

---

I now have everything grounded in the actual backend code. The `actor` is always `user.sub` (user UUID), there is no user-listing endpoint, and the `changes` payloads are exactly mapped per action. Here is the FE implementation plan section.

---

## Tela NET-NEW: Auditoria (admin-only)

Trilha append-only de tudo que mutou em pricing (regras, clusters, runs de apply, agendamentos). Não há precedente no pricy legado (farmacore não tinha auditoria) — design do zero. Endpoint único: `GET /pricing/audit`, **admin apenas**.

### Contrato de backend (verificado no código)

```ts
// Resposta: AuditView[] (sem envelope, sem total — só o array da página)
interface AuditView {
  actor: string | null;     // SEMPRE user.sub (UUID do usuário no JWT). NÃO é nome/email.
  action: string;           // ver vocabulário abaixo
  entity: string;           // 'suggestion_rule' | 'cluster' | 'apply_run' | 'schedule'
  entityId: string | null;  // UUID da entidade afetada
  changes: unknown;         // jsonb — shape varia por action (tabela abaixo)
  createdAt: string;        // ISO, ordenado DESC
}
```

Query params (todos opcionais, strings cruas — parse no server):
- `entity?: string` — match exato em `entity`.
- `entityId?: string` — match exato em `entity_id` (UUID).
- `page?: string` — default `1`.
- `perPage?: string` — default `50`, **cap 200** (server faz `Math.min(perPage, 200)`).

> **Limitação de contrato que o FE precisa absorver:**
> 1. **Sem total/count.** A resposta é só o array da página. Paginação só pode ser "próxima/anterior" inferida pelo tamanho do array (`length < perPage` ⇒ última página). Não há "página X de Y".
> 2. **`actor` é UUID, não nome.** Não existe endpoint de listagem de usuários neste módulo (`GET /auth/me` só devolve o próprio token). A resolução UUID→nome/email é best-effort (ver §Resolução de actor).
> 3. **`changes` é `unknown`.** O render precisa ser defensivo: nunca assumir shape sem checar `action`.

### Vocabulário (verbatim do código — `action` × `entity` × `changes`)

| `action` | `entity` | `changes` (shape exato no backend) | Origem |
|---|---|---|---|
| `create` | `suggestion_rule` | `UpsertSuggestionRuleDto` completo (o DTO inteiro) | criação de regra |
| `update` | `suggestion_rule` | `UpsertSuggestionRuleDto` completo | edição de regra |
| `delete` | `suggestion_rule` | `null` | soft-delete de regra |
| `create` | `cluster` | `{ name: string, eanCount: number }` | criação de cluster |
| `update` | `cluster` | `{ name: string, eanCount: number \| undefined }` (`eanCount` ausente quando só renomeou) | edição de cluster |
| `delete` | `cluster` | `null` | soft-delete de cluster |
| `apply` | `apply_run` | `{ accepted: number, rejected: number }` | `POST /pricing/apply` (sem aprovação) |
| `apply_pending` | `apply_run` | `{ accepted: number, rejected: number }` | `POST /pricing/apply` com `PRICING_APPLY_REQUIRES_APPROVAL=1` |
| `approve` | `apply_run` | `null` | `POST /:id/approve` (admin) |
| `reject` | `apply_run` | `null` | `POST /:id/reject` (admin) |
| `rollback` | `apply_run` | `{ sourceRunId: string, accepted: number }` (`entityId` = id do **novo** run de rollback; `sourceRunId` = run revertido) | `POST /:id/rollback` |
| `schedule_create` | `schedule` | `{ runAt: string, itemCount: number }` | `POST /pricing/schedules` |
| `schedule_cancel` | `schedule` | `null` | `DELETE /pricing/schedules/:id` |

> Notas que mudam o render:
> - **CRUD de regra grava o DTO inteiro em `changes`**, não um diff. Não há valor "antes" — só o "depois" submetido. O label deve ser "Valores enviados", nunca "Diff".
> - **`rollback`** é a única action cujo `entityId` ≠ entidade-fonte: aponta para o run novo; o run original está em `changes.sourceRunId`. Linkar ambos.

### Componentes

```
AuditPage                      // rota /pricing/auditoria
├── PageHeader                 // título "Auditoria" + subtítulo (reusa shadcn header do legado)
├── AdminOnlyGate              // 403 → mensagem; loading do role
├── AuditFilters
│   ├── Select (entity)        // "Todas" | Regra | Cluster | Run de apply | Agendamento
│   ├── Input (entityId)       // UUID; chip "limpar"; preenchido via deep-link
│   └── (action NÃO é filtro de servidor — ver edge cases; filtro client-side opcional)
├── AuditTable                 // shadcn <Table>, NÃO virtualizada (cap 200/página)
│   └── AuditRow[]
│       ├── ActorCell          // nome/email resolvido OU UUID truncado + tooltip UUID completo
│       ├── ActionBadge        // SeverityPill por severidade da action (cores abaixo)
│       ├── EntityCell         // label PT-BR + link "ver entidade" quando aplicável
│       ├── EntityIdCell       // UUID truncado, copiável, link "ver histórico" (filtra por entityId)
│       ├── ChangesCell        // <ChangesRenderer> — resumo inline + "expandir"
│       └── CreatedAtCell      // data-fns formatRelative + tooltip ISO absoluto
├── ChangesRenderer            // dispatch por (action, entity) → render legível; fallback <JsonViewer>
├── TablePagination            // prev/next inferida (sem total) — ver §Paginação
└── EmptyState / TableSkeleton / ErrorState
```

Componentes reusados do legado (`pricy`): `PageHeader`, `SeverityPill`, `TableSkeleton`, `TablePagination`, shadcn `Table/Select/Input/Badge/Tooltip/ScrollArea`, ícones lucide.

### Estado

```ts
// AuditPage — useState (sincronizado com URL search params para deep-linking)
entity?: 'suggestion_rule' | 'cluster' | 'apply_run' | 'schedule';  // undefined = todas
entityId?: string;        // UUID; vem do deep-link de Regras/Clusters/Apply
page: number;             // default 1
const perPage = 50;       // constante (não exposto; cap server = 200)
// derivados de useQuery: data (AuditView[]), isLoading, isError, error
// hasNextPage = data?.length === perPage
```

URL como fonte de verdade dos filtros (`useSearchParams` do react-router v7): `?entity=apply_run&entityId=<uuid>&page=2`. Isso torna o deep-link de "ver histórico" trivial e dá voltar/avançar do browser de graça.

### Chamada de API

```ts
// hooks/useAuditLog.ts — TanStack Query
function useAuditLog(params: { entity?: string; entityId?: string; page: number; perPage: number }) {
  return useQuery({
    queryKey: ['audit', params],
    queryFn: () => api.get<AuditView[]>('/pricing/audit', { params }),
    placeholderData: keepPreviousData,   // evita flash ao paginar/filtrar
    staleTime: 15_000,
  });
}
// Request exato:
//   GET /pricing/audit?entity=apply_run&entityId=<uuid>&page=2&perPage=50
//   Authorization: Bearer <jwt admin>
// Strings cruas: mandar page/perPage como string ou number (Type coerção no server tolera ambos).
```

### Resolução de actor (UUID → nome/email)

`actor` é sempre o `user.sub` (UUID). **Não há endpoint de usuários neste módulo.** Estratégia em camadas, sem bloquear a tela:

1. **Default (sem fonte):** renderizar UUID truncado (`a1b2c3d4…`) + tooltip com UUID completo + botão copiar. Rótulo "Usuário {uuid curto}". **Aceito como MVP** — o CLAUDE.md pede simplicidade; não inventar abstração de diretório de usuários que não existe.
2. **Se existir (fora deste módulo) um endpoint de usuários do tenant** (ex.: `GET /users` ou similar): hook `useTenantUsers()` cacheado (staleTime longo), monta `Map<sub, {name,email}>`, e `ActorCell` resolve. Degradar para UUID quando o sub não está no mapa (usuário removido).
3. **Auto-resolução do próprio usuário:** comparar `actor === me.sub` (de `GET /auth/me`) → badge "você".

> **Decisão a confirmar com produto/backend (registrar como gap):** existe endpoint de listagem de usuários do tenant para resolver `actor`? Se não, o MVP fica em UUID truncado. Não criar tabela de mapeamento no FE.

### ChangesRenderer — render legível do `changes` por tipo de ação

Dispatch por `(entity, action)`. Cada branch produz um **resumo inline** (1 linha na célula) e um **detalhe expandível**. Fallback final: `<JsonViewer>` colapsável.

```tsx
function renderChanges(row: AuditView): { summary: ReactNode; detail?: ReactNode } {
  const { action, entity, changes } = row;

  // null → sem payload (delete, approve, reject, schedule_cancel)
  if (changes == null) return { summary: <Muted>—</Muted> };

  // apply_run
  if (entity === 'apply_run') {
    if (action === 'apply' || action === 'apply_pending') {
      const c = changes as { accepted: number; rejected: number };
      return { summary: <>{c.accepted} aceitos · {c.rejected} rejeitados</> };
    }
    if (action === 'rollback') {
      const c = changes as { sourceRunId: string; accepted: number };
      return {
        summary: <>Reverteu {c.accepted} itens do run <Link>{short(c.sourceRunId)}</Link></>,
      };
    }
  }

  // cluster create/update
  if (entity === 'cluster') {
    const c = changes as { name: string; eanCount?: number };
    return {
      summary: <>“{c.name}” {c.eanCount != null ? `· ${c.eanCount} EANs` : '· (só renomeou)'}</>,
    };
  }

  // schedule_create
  if (entity === 'schedule' && action === 'schedule_create') {
    const c = changes as { runAt: string; itemCount: number };
    return { summary: <>{c.itemCount} itens em {fmtDate(c.runAt)}</> };
  }

  // suggestion_rule create/update → changes é o DTO inteiro (UpsertSuggestionRuleDto)
  if (entity === 'suggestion_rule') {
    const dto = changes as UpsertSuggestionRule;
    return {
      summary: <>Regra “{dto.name}” · {dto.strategy ?? 'margem'} · margem mín. {dto.minMargin}%</>,
      detail: <RuleChangesTable dto={dto} />,  // tabela campo→valor dos campos preenchidos
    };
  }

  // fallback defensivo (action/entity fora da enum conhecida)
  return { summary: <Muted>Ver detalhes</Muted>, detail: <JsonViewer value={changes} /> };
}
```

`RuleChangesTable`: renderiza só os campos presentes no DTO em uma `<dl>` com labels PT-BR (Nome, Estratégia, Margem mínima, Concorrentes, Modo, Variação %, Ignora PBM, Bloqueia PBM na margem, Cascade por prioridade, Arredonda, Ativa). Como o backend grava o DTO inteiro (sem diff), o label da seção é **"Valores enviados"** — não prometer um "antes/depois" que o dado não tem.

Cores do `ActionBadge` (SeverityPill):
- `create` / `schedule_create` → verde (info/positivo)
- `update` → azul (neutro)
- `apply` / `approve` → âmbar (ação com efeito no ERP)
- `apply_pending` → âmbar-tracejado (aguardando)
- `delete` / `reject` / `rollback` / `schedule_cancel` → vermelho (reversão/destrutivo)

### Deep-linking "ver histórico desta entidade"

Cada tela de origem ganha um botão/ação que navega para a auditoria já filtrada:

| Origem | Ação na UI | Navega para |
|---|---|---|
| `RegrasSugestao` (linha) | menu "Histórico" | `/pricing/auditoria?entity=suggestion_rule&entityId={rule.id}` |
| `Clusters` (linha) | menu "Histórico" | `/pricing/auditoria?entity=cluster&entityId={cluster.id}` |
| Histórico de Apply (`GET /pricing/apply`, linha do run) | menu "Histórico" | `/pricing/auditoria?entity=apply_run&entityId={run.id}` |
| `Schedules` (linha) | menu "Histórico" | `/pricing/auditoria?entity=schedule&entityId={schedule.id}` |

Reverso: na `EntityIdCell` e em `changes.sourceRunId` (rollback), o UUID é um `<Link>` que **re-filtra** a própria auditoria por aquele `entityId` (mantendo `entity`). Permite seguir a cadeia apply → rollback. Esses botões em Regras/Clusters/Apply/Schedules só aparecem para `role === 'admin'` (a tela de destino é admin-only; não oferecer link que dá 403).

### Estados de erro por código HTTP

| Código | Quando | Render |
|---|---|---|
| **200** com `[]` | filtro sem resultados (ou página além do fim) | `EmptyState`: "Nenhum registro de auditoria" + (se há filtro) botão "Limpar filtros" |
| **400** | `entity` com valor fora do enum esperado, `entityId`/page malformados | toast "Filtro inválido" + manter última lista válida; não derrubar a tela |
| **401** | JWT ausente/expirado | interceptor global → fluxo de refresh/login (igual ao resto do app) |
| **403** | role `operator`/`viewer` chamando a rota | `AdminOnlyGate` mostra "Acesso restrito a administradores" (não exibir a tabela). Idealmente nem renderizar a rota se `role !== 'admin'` (route guard) — a chamada é só fail-safe. |
| **5xx** | erro de servidor | `ErrorState` com botão "Tentar novamente" (`refetch`) |

`AdminOnlyGate`: lê `role` de `GET /auth/me` (ou do JWT decodificado em memória). Se `!== 'admin'`, renderiza estado de bloqueio e **não dispara** `useAuditLog`. Route-level guard no router redundante com isto.

### Paginação (sem total)

A resposta não traz contagem total. `TablePagination` opera em modo "cursor por offset":
- **Anterior** habilitado quando `page > 1`.
- **Próxima** habilitado quando `data.length === perPage` (página cheia ⇒ provavelmente há mais). Quando `data.length < perPage`, é a última página → "Próxima" desabilitada.
- Não mostrar "página X de Y". Mostrar "Página {page}" + "{data.length} registros nesta página".
- Edge: página cheia que era exatamente a última ⇒ "Próxima" leva a uma página vazia; tratar `[]` como fim (mostrar EmptyState com botão "Voltar"). Aceitável — o backend não dá meio melhor.

### Edge cases

- **`actor === null`:** registro de sistema/cron (futuro). Renderizar "Sistema" em itálico.
- **`entityId === null`:** sem link de entidade; célula mostra "—". (Hoje toda mutação grava entityId, mas o tipo permite null — tolerar.)
- **`changes` com shape inesperado** (ex.: backend muda o DTO): nunca acessar campo sem o branch certo; cair no `<JsonViewer>`. Não usar `as` sem o guard de `action`/`entity` antes.
- **`action` desconhecida** (nova action adicionada no backend antes do FE): `ActionBadge` mostra a string crua em cinza; `ChangesRenderer` cai no fallback JSON. Tela não quebra.
- **`apply` vs `apply_pending`:** se `PRICING_APPLY_REQUIRES_APPROVAL` estava on, o run nasceu `apply_pending` e haverá um `approve`/`reject` subsequente com o **mesmo `entityId`** — ao filtrar por aquele run, a UI mostra a cadeia (`apply_pending` → `approve` → … → `rollback`). Ordená-los por `createdAt DESC` (já vem assim do server).
- **`entity` sem rota de detalhe** (ex.: futura entity): mostrar label cru sem link "ver entidade".
- **Filtro por `action` não existe no servidor:** se o produto pedir, fazer filtro **client-side** sobre a página atual (com aviso de que filtra só a página visível) — não simular paginação por action no FE.

### Critérios de aceite (observáveis)

1. `operator`/`viewer` que acessam `/pricing/auditoria` veem "Acesso restrito a administradores" e **nenhuma chamada** a `GET /pricing/audit` é disparada (verificável no Network). Forçar a chamada retorna 403.
2. Admin vê a tabela ordenada por data **decrescente** (mais recente no topo), 50 linhas por página.
3. Cada linha mostra: actor (nome/email se resolvível, senão UUID truncado com tooltip do UUID completo), badge de action colorida por severidade, entidade em PT-BR, entityId truncado copiável, resumo legível de `changes`, e data relativa com tooltip ISO absoluto.
4. Os 13 pares `(action, entity)` da tabela de vocabulário renderizam um resumo legível **sem** cair no JSON bruto. `changes: null` mostra "—".
5. Filtrar por `entity=apply_run` chama `GET /pricing/audit?entity=apply_run&page=1&perPage=50` e a lista só contém linhas `entity=apply_run`.
6. Clicar "Histórico" numa regra/cluster/run/schedule navega para a auditoria já filtrada por aquele `entityId` (URL reflete `entity` + `entityId`), e a lista mostra só os eventos daquela entidade.
7. Numa linha de `rollback`, `changes.sourceRunId` é um link clicável que re-filtra a auditoria pelo run revertido.
8. Paginação: "Anterior" desabilitado na página 1; "Próxima" desabilitado quando a página retorna < 50 linhas; navegar avança/volta sem perder o filtro (e o botão Voltar do browser funciona, pois o estado vive na URL).
9. Filtro sem resultados mostra EmptyState com "Limpar filtros"; 5xx mostra ErrorState com "Tentar novamente" que dispara `refetch`.
10. Trocar de filtro/página não pisca a tabela para vazio (graças a `keepPreviousData`), mostrando skeleton só no primeiro load.

### Notas de simplicidade (CLAUDE.md)

- **Não** construir um sistema de "diff antes/depois": o backend não guarda o estado anterior (CRUD grava só o DTO enviado; deletes não guardam nada). Renderizar o que existe.
- **Não** criar um diretório de usuários no FE para resolver `actor` se não houver endpoint — UUID truncado é aceitável como MVP. Registrar como gap aberto.
- `ChangesRenderer` é um `switch` por `(entity, action)` com fallback JSON — três linhas por branch, sem fábrica de renderers. A union de actions é pequena e estável.
- Tabela **não** virtualiza (cap 200/página) — `@tanstack/react-virtual` é peso desnecessário aqui.

---

**Arquivos de origem do contrato (verificados):** `src/tenant-api/pricing/audit.controller.ts` (rota + `@Roles(ADMIN)`), `src/tenant-api/pricing/audit.service.ts` (shape `AuditView`, cap 200, ordem DESC, sem total). Call sites que definem `action`/`changes`: `suggestion-rules.controller.ts` (l.50-92), `clusters.controller.ts` (l.55-92), `pricing-apply.controller.ts` (l.51-141), `pricing-schedule.controller.ts` (l.57-76). `actor` é sempre `user.sub` (UUID); não há endpoint de listagem de usuários no módulo (`auth.controller.ts` só expõe `GET /auth/me`).

---

I have everything I need. The two legacy files confirm the exact field-by-field break points. Here is the implementation plan section.

---

## Migração do contrato legado + decisões de corte

> Escopo: portar a tela de **Sugestões** (e os types/hooks que ela carrega) do front legado `pricy-shelf` para o contrato REST do farmacore. O legado mora em `pricy-legacy/src`; o contrato-alvo é `SuggestionsResponse` / `ResponseProduct` de `pricing-suggestions.service.ts`. **Regras e Clusters mudam pouco; Sugestões quebra inteira.**

### 1. O que quebra no corte (por que é "quebra dura", não degradação)

A função `mapResponse` de `usePricingSuggestionProducts.ts:148` faz `apiResponseSchema.parse(data)` — **`.parse()`, não `.safeParse()`**. Qualquer divergência de shape lança `ZodError` síncrono dentro do `select`/`mapResponse` do React Query → o hook entra em `isError`, `rows` fica `[]`, e a tela renderiza o estado de erro. **Não há fallback nem degradação parcial: o primeiro produto do payload novo derruba a página toda.**

Três pontos do `apiProductSchema` (linhas 7–28) garantem a quebra contra o payload novo:

1. **`id: z.number()`** (linha 8, obrigatório, sem `.default`) — o novo `ResponseProduct` **não tem `id`**. Zod: `"Required"` / `"Expected number, received undefined"`.
2. **`cost/priceForSell/priceForOffer/margin/averageVariation: z.union([z.string(), z.number()])`** (linhas 14–21) — o novo backend manda `number | null`. O `null` **não** casa com `union([string, number])` → `ZodError` em toda linha com qualquer um desses campos nulo (comum: produto sem custo/sem coleta).
3. **`drogalPrice/drogasilPrice/michelassiPrice` + `*IsPbm` + `*Van`** (linhas 17–19, 24–27) — não existem mais; viraram `competitors: [{origin, price, isPbm, van}]`. Esses têm `.default`, então **não** lançam sozinhos, mas alimentam `mapApiToProduct` (linhas 104–116) com zeros/false → **silenciosamente perdem todos os concorrentes** mesmo se os dois bloqueadores acima fossem corrigidos.

Conclusão operacional: **não dá para apontar a tela legada de Sugestões ao endpoint novo sem reescrever o hook.** Regras e Clusters não têm esse acoplamento de parse (ver §3).

### 2. Mapa campo-a-campo (legado → novo)

#### 2.1 Produto da linha de sugestão — `apiProductSchema` → `ResponseProduct`

| Legado (`apiProductSchema` / `Product`) | Novo (`ResponseProduct`) | Ação no FE |
|---|---|---|
| `id: z.number()` (obrigatório) | — (removido) | **Remover do schema.** Chave de linha e de seleção passa a ser `ean` (string). Eliminar `Product.id` e `mapApiToProduct` `id: 0`/`apiProduct.id`. |
| `curve: string\|null` → `curvaQntBrick` | — (removido) | Remover. Apagar coluna/uso de `curvaQntBrick` (já era sempre `""` no legado). |
| `cost / priceForSell / priceForOffer / margin / averageVariation: union([string,number]) default "0"` | `number \| null` | Trocar por `z.number().nullable()`. UI renderiza `null` como "—" (não como `0` — `0` e "sem dado" são coisas distintas na tela de preço). |
| `drogalPrice / drogasilPrice / michelassiPrice` | `competitors[].price` (por `origin`) | Remover os 3 campos fixos. Renderizar `competitors[]` data-driven (§2.3). |
| `drogalIsPbm / drogasilIsPbm` | `competitors[].isPbm` | Idem. `product.pbm` agregado = `competitors.some(c => c.isPbm)`. |
| `drogalVan / drogasilVan` | `competitors[].van` | Idem. `buildPbmVans` vira: `competitors.filter(c => c.isPbm && c.van).map(...)`. |
| `name / supplier / classification / book / status` (nullable) | iguais (nullable) | Sem mudança. |
| — | `competitors: { origin: CompetitorOrigin; price: number\|null; isPbm: boolean; van: string\|null }[]` | **Campo novo, modelar no schema.** Uma entrada por origem habilitada do tenant, já ordenada `priority ASC, origin ASC`. |

Schema-alvo do produto (substitui linhas 7–28):

```ts
const competitorViewSchema = z.object({
  origin: z.string(),                 // CompetitorOrigin (9 valores; não fixar enum no parse)
  price: z.number().nullable(),
  isPbm: z.boolean(),
  van: z.string().nullable(),
});

const apiProductSchema = z.object({
  ean: z.string(),
  name: z.string().nullable(),
  supplier: z.string().nullable(),
  classification: z.string().nullable(),
  book: z.string().nullable(),
  cost: z.number().nullable(),
  priceForSell: z.number().nullable(),
  priceForOffer: z.number().nullable(),
  margin: z.number().nullable(),
  averageVariation: z.number().nullable(),
  status: z.string().nullable(),
  competitors: z.array(competitorViewSchema),
});
```

> Nota de simplicidade (CLAUDE.md): o `parseNumber()` (linhas 81–85) existia só para coagir `string|number` em `number`. Com `number|null` no contrato, **delete `parseNumber`** — `mapApiToProduct` passa o valor direto (ou `null`). Não reintroduzir coerção "por via das dúvidas".

#### 2.2 Envelope da resposta — **não muda**

`suggestionRowSchema` + `apiResponseSchema` (linhas 30–43) já batem com `SuggestionsResponse`: `count, suggestionCount, lockCount, activeRuleCount, availableBooks, rows[]`, e `result`/`origem` são `z.custom()` (não validados). **Mantém.** Só o `product` interno é reescrito.

#### 2.3 `SuggestionCompetitor` 3 → 9 origens (data-driven)

| Legado | Novo |
|---|---|
| `type SuggestionCompetitor = 'drogal'\|'drogasil'\|'michelassi'` (minúsculo) | `type CompetitorOrigin = 'DROGAL'\|'DROGASIL'\|'PAGUE_MENOS'\|'IKESAKI'\|'MICHELASSI'\|'PACHECO'\|'SAO_PAULO'\|'VENANCIO'\|'INDIANA'` (MAIÚSCULO) |
| `SUGGESTION_COMPETITOR_LABELS: Record<SuggestionCompetitor,string>` (3 fixos) | `Record<CompetitorOrigin, string>` (9; labels human-readable, p.ex. `PAGUE_MENOS → 'Pague Menos'`, `SAO_PAULO → 'São Paulo'`) |
| `ALL_SUGGESTION_COMPETITORS` (array literal de 3) | Não usar lista fixa para renderizar. **As colunas saem de `rows[0].product.competitors[]`** (origens habilitadas do tenant, na ordem que vêm). |
| `priceComposition[].competitor: SuggestionCompetitor` (minúsculo) | `string` (MAIÚSCULO, mesmo vocabulário). Mapear pelo `SUGGESTION_COMPETITOR_LABELS` novo. |

**Decisão de colunas (resolve gap §1.2):** colunas de concorrente são **dinâmicas, derivadas do array `competitors[]`**, não um subconjunto hard-coded de 3. Motivo: o backend já entrega exatamente as origens habilitadas do tenant, na ordem de prioridade; replicar isso no FE como lista fixa quebraria tenants com origens diferentes de Drogal/Drogasil/Michelassi. PBM/van também são **por origem** (badge PBM + tooltip do `van` na própria célula da coluna), não duas colunas separadas. A label set das 9 origens é estática (constante no FE); o que é dinâmico é **quais** renderizar.

> Edge case: tenant sem nenhuma origem habilitada → `competitors[]` vazio em todas as linhas → renderizar zero colunas de concorrente (não quebrar). Quando `rows` está vazio (sem produtos na página), derivar a ordem de colunas de `availableBooks`-style fallback não é possível; nesse caso não há linha para renderizar mesmo, então é inócuo.

#### 2.4 Regra de sugestão — `SuggestionRule` → `SuggestionRuleApi`

| Legado (`types/pricingSuggestion.ts`) | Novo (`SuggestionRuleApi`) | Ação |
|---|---|---|
| `priceRoundingTypeId: number \| null` (linha 57) | — (removido; só `applyRounding: boolean`) | **Remover do type, do `FormState` e do envio.** Apagar o `Select` de tipo + o hook `usePriceRoundingTypes` no `RegraSugestaoDialog`. `applyRounding` (toggle) basta. |
| — | `blockPbmInMargin: boolean` (novo, default `false`) | **Adicionar** toggle no form. Label: "Bloquear PBM também na estratégia margem". |
| — | `cascadeByPriority: boolean` (novo, default `false`) | **Adicionar** toggle (só relevante em `competitorMode === 'cascade'`). Label: "Seguir prioridade do tenant na cascata". |
| `competitors[].competitor` minúsculo | `CompetitorOrigin` MAIÚSCULO (9) | Seletor de concorrentes no form passa a oferecer as **origens habilitadas do tenant** (derivadas de `suggestions.rows[].product.competitors[].origin`, deduplicadas). Enviar origem não habilitada → 400 `Concorrente inválido: X`. |
| `id, name, clusterId, clusterName, excludeClusterIds, strategy, minMargin, competitorMode, variationPct, noCompetitorMargin, priceControlled, ignorePbm, active, createdAt, updatedAt` | iguais | Sem mudança. |

#### 2.5 Clusters — **sem mudança de contrato**

`Cluster` (`{id,name,memberCount,createdAt,updatedAt}`) e `ClusterInput` (`{name, eans?}`) batem 1:1 com `ClusterApi`/`UpsertClusterDto`. **Só migra a URL** (de `fn/clusters-*` para `/pricing/clusters`). Nenhuma reescrita de parse.

### 3. As 3 opções de corte (prós / contras / recomendação)

| Opção | Como | Prós | Contras |
|---|---|---|---|
| **(a) Compat: manter `id`/`curve` + 3 campos fixos** | Backend volta a emitir `id`, `curve`, `drogal*/drogasil*/michelassi*` além de `competitors[]` | Front legado não muda; corte sem coordenação | **Rejeitada.** Viola simplicidade (CLAUDE.md): mantém campos mortos e duplica concorrentes; trava o FE em 3 origens para sempre; `id` numérico do ERP não existe mais como chave (apply é por EAN). Dívida que nunca sai. |
| **(b) Versionar endpoint** (`/pricing/suggestions` novo vs. shim `v1`) | Manter um shim `v1` com o shape antigo enquanto o front migra | Desacopla deploy de back e front | Custo de manter dois shapes do mesmo cálculo no backend; o shim precisaria fabricar `id`/`curve` que **não existem mais** na fonte — ou seja, não é um shim honesto, é a opção (a) disfarçada. Só vale se houvesse múltiplos consumidores; **não há** (um único front). |
| **(c) Back + front reescrito, corte coordenado por tenant** | Reescrever `usePricingSuggestionProducts.ts` + types + UI de concorrentes; cortar atrás de **feature-flag por tenant** | Contrato limpo, sem dívida; alinhado ao backend (apply por EAN, N origens); um shape só | Exige PR de FE coordenado com o flip do flag; tela de Sugestões fica indisponível para o tenant entre o flip e o deploy do FE (mitigado pelo flag — flip só após FE no ar). |

**Recomendação: (c).** O backend já é a fonte única de verdade (o cálculo não tem como reproduzir `id`/`curve`), há um único consumidor, e o princípio de simplicidade do projeto desautoriza carregar campos mortos. (b) só seria justificável com múltiplos clientes — não é o caso.

### 4. Estratégia incremental e sequência de rollout

A chave é que **os fluxos net-new (Apply / Schedule / Audit / Approval / Rollback / Preview) não dependem do contrato legado** — não passam pelo Zod que quebra. Eles podem subir **antes** do corte das telas portadas.

**Feature-flag por tenant** (`pricingV2` no front, lido do mesmo lugar que o JWT/tenant): controla qual conjunto de telas/rotas o tenant vê. Default off; flip por tenant só **depois** do FE reescrito estar em produção.

Sequência:

1. **Onda 0 — net-new, sem dependência do corte (pode ir primeiro):**
   `POST /pricing/apply` + `GET /pricing/apply/:id` (Aplicar em massa + relatório), `GET /pricing/apply` (Histórico), `POST /:id/rollback`, `POST /:id/approve|reject`, `POST/GET/DELETE /pricing/schedules`, `GET /pricing/audit`, `POST /pricing/apply/preview` + `POST /pricing/suggestions/preview`. Telas novas, types novos, zero acoplamento ao Zod legado. Entregam valor isoladamente.
2. **Onda 1 — Clusters:** migrar URL `fn/clusters-*` → `/pricing/clusters`. Contrato idêntico (§2.5), risco mínimo. Pode ir junto da Onda 0.
3. **Onda 2 — Regras de sugestão:** aplicar §2.4 (remover `priceRoundingTypeId`, adicionar `blockPbmInMargin`/`cascadeByPriority`, origens MAIÚSCULAS). Migrar URLs `fn/pricing-suggestion-rules-*` → `/pricing/suggestion-rules`. Independente da tela de Sugestões.
4. **Onda 3 — Sugestões (o corte duro):** reescrever `usePricingSuggestionProducts.ts` (§2.1), generalizar concorrentes 3→9 (§2.3), absorver `result` como discriminated union e as 4 contagens de cabeçalho. **Coordenado:** merge do FE → deploy → só então flip do `pricingV2` por tenant. Apply continua sendo por **EAN** (seleção do front migra de `productId` para `ean`).

### 5. Riscos

| Risco | Mitigação |
|---|---|
| Flip do flag antes do FE reescrito no ar → tela de Sugestões quebra (Zod `.parse`) | Flag default off; flip **somente** após confirmar FE v2 em produção. Runbook: flip por tenant, um de cada vez, com verificação. |
| Seleção em massa hoje é por `productId` numérico; apply é por EAN | Migrar `selected: Set<ean>` (string) no estado da tela; remover qualquer `productId`. Chave de linha da tabela = `ean`. |
| `cost/price* === null` renderizado como `0` (decisão de preço errada na cara do operador) | UI distingue `null` ("—") de `0` ("R$ 0,00"). Validar no QA. |
| `priceComposition[].competitor` MAIÚSCULO não casa com `SUGGESTION_COMPETITOR_LABELS` minúsculo legado | Reescrever a constante de labels para `CompetitorOrigin` MAIÚSCULO (9 chaves) antes do corte. |
| Origens habilitadas variam por tenant; seletor de concorrentes do form pode listar origem não habilitada → 400 no save | Derivar a lista de origens habilitadas de `suggestions.rows[].product.competitors[].origin` (deduplicada); idealmente um endpoint dedicado de config de origens (fora deste módulo) se existir. |
| Decisão `VIEWER_PRICING` em aberto (gap §1.3) | Não bloqueia Ondas 0–3 (todas operator/admin, auditoria admin). Tratar como item separado; não desenhar tela read-only especulativamente. |

### 6. Critérios de aceite observáveis

- Apontar a tela de Sugestões reescrita a `GET /pricing/suggestions` com um payload real do farmacore renderiza **sem `ZodError`** no console e popula `rows`, as 4 contagens de cabeçalho e as colunas de concorrente dinâmicas.
- Uma linha com `cost: null` mostra "—" na coluna Custo (não "R$ 0,00").
- Um tenant com 5 origens habilitadas renderiza **5** colunas de concorrente, na ordem `priority ASC, origin ASC` recebida; cada célula sem coleta mostra "—"; PBM mostra badge + `van` no tooltip.
- `result.kind === 'none'` renderiza o motivo (7 valores) sem acessar `result.suggestion`; `kind === 'suggestion'` mostra preço/margem/composição.
- Salvar uma regra sem `priceRoundingTypeId` (campo removido) e com `blockPbmInMargin`/`cascadeByPriority` togláveis retorna `200` e o `SuggestionRuleApi` ecoa os dois flags.
- Com `pricingV2` off, o tenant continua na tela legada; com on (pós-deploy FE), vê a v2 — sem erro em nenhum dos dois estados.
- Selecionar produtos, aplicar, e o `POST /pricing/apply` usa **EAN** como chave de item (não `productId`); a seleção persiste por EAN entre filtros/páginas.

---

Arquivos load-bearing (absolutos):
- Hook a reescrever: `pricy-legacy/src/hooks/usePricingSuggestionProducts.ts` (o `.parse()` na linha 148; `apiProductSchema` linhas 7–28; `parseNumber` linhas 81–85 a remover; `mapApiToProduct` linhas 94–117).
- Types a migrar: `pricy-legacy/src/types/pricingSuggestion.ts` (`SuggestionCompetitor` linha 9; `priceRoundingTypeId` linha 57; `SUGGESTION_COMPETITOR_LABELS`/`ALL_SUGGESTION_COMPETITORS` linhas 130–136).
- Form pesado: `pricy-legacy/src/components/precos/RegraSugestaoDialog.tsx` (remover Select de arredondamento + `usePriceRoundingTypes`; adicionar `blockPbmInMargin`/`cascadeByPriority`).
- Contrato-alvo: `src/tenant-api/pricing/pricing-suggestions.service.ts` (`ResponseProduct`, `CompetitorView`, `SuggestionsResponse`); `src/tenant-api/pricing/dto/suggestion-rule.dto.ts`; `src/database/enums/competitor-origin.enum.ts`.

---

# Apêndice — Referência de Backend (fase Understand do workflow)

> Material cru produzido pelos agentes de leitura. Fonte de verdade para o contrato; consulte antes de inventar shapes.

### api-surface
I now have the complete picture. Here is the catalog.

# Catálogo de API REST — Precificação + Auth (NestJS, Farmacore)

## Convenções globais (aplicam a todos os endpoints)

- **Sem global prefix.** `src/main.http.ts` não chama `setGlobalPrefix`. Os paths abaixo são exatamente os dos `@Controller(...)`.
- **Tenant scoping é por JWT, não por path.** O slug/tenant vem do token (`SearchPathInterceptor` + `JwtAuthGuard` globais; `@TenantEm()` abre a transação com `search_path` do tenant do JWT). Não há `:tenant` na URL e não há header de tenant exigido pelo frontend.
- **Auth padrão:** todas as rotas exigem JWT, exceto as marcadas `@Public()` (`POST /auth/login`, `POST /auth/refresh`). Sem JWT válido → **401**.
- **Roles:** `@Roles(...)` é validado pelo `RolesGuard` (`src/auth/guards/roles.guard.ts`). Sem `@Roles` = qualquer autenticado. Role faltante/insuficiente → **403** `{message:'Insufficient role'}`. Papéis: `operator`/`admin`/`viewer` (`UserRole`).
- **ValidationPipe global** (`whitelist + forbidNonWhitelisted + transform`, `src/app.module.ts`): body/query inválido, campo extra não-whitelisted, ou tipo errado → **400**. `@Param('id', ParseUUIDPipe)` com UUID malformado → **400**.
- **Status default:** `@Get`/`@Patch`/`@Delete` → **200**; `@Post` → **201** salvo `@HttpCode(...)` explícito (anotado por rota).

---

## Recurso: Auth — `src/auth/auth.controller.ts`

### POST `/auth/login` — público
- **Roles:** público (`@Public`). **Status:** `@HttpCode(200)`.
- **Body** (`LoginDto`, `src/auth/dto/login.dto.ts`): `{ email: string(@IsEmail), password: string(1..256), tenantSlug: string(/^[a-z][a-z0-9-]{2,31}$/) }`.
- **Resposta** (`LoginResponseDto`): `{ accessToken: string, refreshToken: string, expiresIn: number }`.
- **Status:** 200 sucesso; 400 body inválido; 401 credenciais inválidas (de `AuthService.login`).

### POST `/auth/refresh` — público
- **Roles:** público. **Status:** `@HttpCode(200)`.
- **Body** (`RefreshDto`): `{ refreshToken: string }`.
- **Resposta:** `LoginResponseDto` (mesmo shape do login).
- **Status:** 200; 400 body inválido; 401 refresh token inválido/expirado.

### POST `/auth/logout` — autenticado
- **Roles:** qualquer autenticado. **Status:** `@HttpCode(204)` (sem corpo).
- **Body:** nenhum. Usa `@CurrentUser().sub`.
- **Status:** 204; 401 sem JWT.

### GET `/auth/me` — autenticado
- **Roles:** qualquer autenticado. **Status:** 200.
- **Resposta** (`JwtPayload`, devolve o token decodificado): `{ sub: string, tenantId: string, role: UserRole, iat?: number, exp?: number }`.
- **Status:** 200; 401 sem JWT.

---

## Recurso: Suggestion Rules — `src/tenant-api/pricing/suggestion-rules.controller.ts`

Todas exigem **`operator`/`admin`**. Mutações gravam auditoria (mesma transação).
Response interface: **`SuggestionRuleApi`** (`src/tenant-api/pricing/suggestion-rules.service.ts`):
`{ id, name, classifications: string[], clusterId: string|null, clusterName: string|null, excludeClusterIds: string[], strategy: 'margem'|'concorrencia', minMargin: number, competitorMode: 'weighted'|'cascade'|'lowest', competitors: {competitor: CompetitorOrigin, weight: number}[], variationPct: number, noCompetitorMargin: number|null, priceControlled, ignorePbm, blockPbmInMargin, cascadeByPriority, applyRounding, active: boolean, createdAt: string(ISO), updatedAt: string(ISO) }`.

Body de create/update: **`UpsertSuggestionRuleDto`** (`src/tenant-api/pricing/dto/suggestion-rule.dto.ts`):
`{ name: string(1..120), classifications?: string[](max200), clusterId?: uuid|null, excludeClusterIds?: uuid[](max100), strategy?: 'margem'|'concorrencia', minMargin: number(0..95), competitorMode?: 'weighted'|'cascade'|'lowest', competitors?: {competitor: CompetitorOrigin, weight?: number(0..100)}[], variationPct?: number(-90..90), noCompetitorMargin?: number(0..95)|null, priceControlled?, ignorePbm?, blockPbmInMargin?, cascadeByPriority?, applyRounding?, active?: boolean }`.

| Método | Path | Status | Query | Body | Resposta |
|---|---|---|---|---|---|
| GET | `/pricing/suggestion-rules` | 200 | — | — | `SuggestionRuleApi[]` |
| POST | `/pricing/suggestion-rules` | 201 | — | `UpsertSuggestionRuleDto` | `SuggestionRuleApi` |
| PATCH | `/pricing/suggestion-rules/:id` | 200 | — | `UpsertSuggestionRuleDto` | `SuggestionRuleApi` |
| DELETE | `/pricing/suggestion-rules/:id` | 200 | — | — | `{ id: string, deleted: true }` (soft-delete) |

- **400** (validação cruzada no `validate()`): classificação >200 chars; `clusterId` + `classifications` juntos (XOR); cluster excluindo a si mesmo; concorrente inválido/duplicado; peso inválido em `weighted`; `concorrencia` sem concorrente; **FK cluster inexistente (23503)** → "Cluster da regra não existe".
- **404** PATCH/DELETE com `id` inexistente (`rule {id} not found`).

---

## Recurso: Clusters — `src/tenant-api/pricing/clusters.controller.ts`

Todas exigem **`operator`/`admin`**. Mutações gravam auditoria.
List response: **`ClusterApi`** (`src/tenant-api/pricing/clusters.service.ts`): `{ id, name, memberCount: number, createdAt: string(ISO), updatedAt: string(ISO) }`. Get/create/update retornam **`ClusterApi & { eans: string[] }`**.
Body: **`UpsertClusterDto`** (`src/tenant-api/pricing/dto/cluster.dto.ts`): `{ name: string(1..120), eans?: string[] }`. Regra: `eans` ausente = só renomeia; presente = substitui a membership inteira (dedup + regex `^\d{6,14}$`, máx 5000).

| Método | Path | Status | Query | Body | Resposta |
|---|---|---|---|---|---|
| GET | `/pricing/clusters` | 200 | — | — | `ClusterApi[]` |
| GET | `/pricing/clusters/:id` | 200 | — | — | `ClusterApi & { eans: string[] }` |
| POST | `/pricing/clusters` | 201 | — | `UpsertClusterDto` | `ClusterApi & { eans: string[] }` |
| PATCH | `/pricing/clusters/:id` | 200 | — | `UpsertClusterDto` | `ClusterApi & { eans: string[] }` |
| DELETE | `/pricing/clusters/:id` | 200 | — | — | `{ id: string, name: string }` (soft-delete) |

- **400** >5000 EANs por cluster.
- **404** GET/PATCH/DELETE com `id` inexistente (`cluster {id} not found`).
- **409** DELETE de cluster referenciado por regra ativa (`cluster_id` ou `exclude_cluster_ids`): "Cluster em uso pela(s) regra(s): ... Remova a regra antes."

---

## Recurso: Suggestions (cálculo/preview) — `src/tenant-api/pricing/pricing-suggestions.controller.ts`

Ambas exigem **`operator`/`admin`** (geração faz full-scan do catálogo). Sem auditoria.
Response interface: **`SuggestionsResponse`** (`src/tenant-api/pricing/pricing-suggestions.service.ts`):
`{ rows: { product: ResponseProduct, result: SuggestionResult, origem: ClusterOrigin|null }[], count: number, suggestionCount: number, lockCount: number, activeRuleCount: number, availableBooks: {value,label}[] }`.
- `ResponseProduct`: `{ ean, name, supplier|null, classification|null, book|null, cost|null, priceForSell|null, priceForOffer|null, margin|null, averageVariation|null, status|null, competitors: {origin, price|null, isPbm, van|null}[] }`.
- `SuggestionResult` (`pricing-suggestion.engine.ts`): `{ kind:'suggestion', suggestion: PriceSuggestion }` **ou** `{ kind:'none', reason: NoSuggestionReason, rule? }`. `PriceSuggestion`: `{ price, margin, rule, target:'precoVenda'|'precoOferta', basis:'concorrencia'|'margem_minima'|'margem_sem_concorrente', lockApplied, priceComposition: {competitor,price,weight}[]|null }`. `NoSuggestionReason`: `'sem_regra'|'sem_custo'|'margem_ok'|'sem_concorrente'|'pbm'|'acima_do_venda'|'ja_no_alvo'`.

### GET `/pricing/suggestions`
- **Status:** 200. **Header:** `Cache-Control: private, max-age=30`.
- **Query** (`ListSuggestionsQueryDto`, `src/tenant-api/pricing/dto/list-suggestions.query.ts`): `page?: int≥1`, `perPage?: int 1..1000`, `name?: string`, `classification?: string`, `books?: string` (csv "Caderno A,Caderno B"), `onlyWithSuggestion?: 'true'`, `direction?: 'todas'|'subir'|'abaixar'`, `origem?: 'todas'|'cluster'|'classificacao'`.
- **400** query inválida (ex.: `direction`/`origem` fora do `@IsIn`, `perPage` > 1000).

### POST `/pricing/suggestions/preview` — dry-run de regra não salva
- **Status:** `@HttpCode(200)`.
- **Query:** mesma `ListSuggestionsQueryDto`.
- **Body:** `UpsertSuggestionRuleDto` (regra transitória; passa pela mesma validação do create).
- **Resposta:** `SuggestionsResponse` calculada usando só essa regra.
- **400** mesmas validações cruzadas do `validate()` (vide Suggestion Rules).

---

## Recurso: Apply (aplicação em massa, assíncrona) — `src/tenant-api/pricing/pricing-apply.controller.ts`

**Fluxo assíncrono:** `POST /pricing/apply` valida + congela + cria o run e **enfileira** o dispatch ao ERP via outbox (publicado após o commit) → **202**. O progresso é lido por `GET /pricing/apply/:id` (report). O push real roda no worker.
**Aprovação segura o dispatch:** se `process.env.PRICING_APPLY_REQUIRES_APPROVAL === '1'`, o run nasce `approvalStatus:'pending'` e **não** despacha até `POST /:id/approve` (admin).
**Idempotência:**
- `POST /pricing/apply` é idempotente por `idempotencyKey` (`ON CONFLICT DO NOTHING`; reenvio → run existente com `idempotent:true`, sem nova auditoria).
- `POST /:id/rollback` é idempotente por chave derivada `rollback:<runId>` (re-POST seguro).
- `approve`/`reject` são idempotentes por estado: só transitam de `pending` (UPDATE filtra `approval_status`).

DTOs (`src/tenant-api/pricing/dto/apply.dto.ts`):
- `ApplyItemDto`: `{ ean: string, target: 'precoVenda'|'precoOferta', price: number(≥0), cadernoId?: int(≥1) }`.
- `ApplyPricesDto`: `{ idempotencyKey: string(1..200), mode?: 'agora', items: ApplyItemDto[](1..5000) }`.
- `PreviewApplyDto`: `{ items: ApplyItemDto[](1..5000) }`.

Response interfaces (`src/tenant-api/pricing/pricing-apply.service.ts`):
- `ApplyResponse`: `{ applyRunId: string, accepted: number, rejected: {ean,reason}[], idempotent?: boolean, approvalStatus?: 'pending' }`.
- `ApplyRunSummary`: `{ id, status, mode, approvalStatus: string|null, total, applied, skipped, failed, createdAt: string }`.
- `ApplyReport`: `ApplyRunSummary`-like + `items: Record<string,unknown>[]` (campos por item: `ean, target, price, status, reason, basis, priceOld, cadernoId, ruleId, erpResult, appliedAt`).
- `ApplyPreview`: `{ total, accepted: {ean,target,price,basis|null}[], rejected: {ean,reason}[], wouldAbort: boolean }`.

| Método | Path | Roles | Status | Query | Body | Resposta |
|---|---|---|---|---|---|---|
| POST | `/pricing/apply` | operator/admin | **202** | — | `ApplyPricesDto` | `ApplyResponse` |
| POST | `/pricing/apply/:id/approve` | **admin** | **202** | — | — | `{ id: string, approved: true }` |
| POST | `/pricing/apply/:id/reject` | **admin** | **200** | — | — | `{ id: string, rejected: true }` |
| GET | `/pricing/apply` | operator/admin | 200 | `page?`, `perPage?` (strings, default page=1/perPage=100, cap 1000) | — | `ApplyRunSummary[]` |
| POST | `/pricing/apply/preview` | operator/admin | **200** | — | `PreviewApplyDto` | `ApplyPreview` (dry-run; nada persistido) |
| POST | `/pricing/apply/:id/rollback` | operator/admin | **202** | — | — | `ApplyResponse` (reaplica `price_old` dos itens `applied`) |
| GET | `/pricing/apply/:id` | operator/admin | 200 | `page?`, `perPage?` | — | `ApplyReport` |

Status de erro específicos:
- **400** body/query inválido; `:id` não-UUID.
- **404** `:id` inexistente em report/approve/reject/rollback (`apply run {id} not found`).
- **409** `approve`/`reject` quando o run não está `pending` (já approved/rejected/sem aprovação): "apply run {id} não está aguardando aprovação (...)".
- **422** (`UnprocessableEntity`) em dois casos no `POST /pricing/apply` e no `rollback`:
  - **Circuit breaker:** lote ≥10 itens com >50% rejeitado → aborta o lote inteiro; corpo `{ message, aborted:true, rejected:[] }`.
  - **Rollback sem item reversível:** nenhum item `applied` com `price_old > 0` → `{ message: "Run {id} não tem item aplicado reversível." }`.
- Itens individualmente rejeitados (não abortam, vão em `rejected[]` com `reason`): `nao_encontrado`, `sem_custo`, `preco_invalido`, `abaixo_do_piso`, `variacao_excessiva` (teto 3x/⅓), `acima_do_venda`, `sem_caderno`.
- `POST /pricing/apply` com 0 aceitos: ainda **202**, run marcado `done`, sem dispatch.

---

## Recurso: Schedules (agendamento) — `src/tenant-api/pricing/pricing-schedule.controller.ts`

Todas exigem **`operator`/`admin`**. Mutações gravam auditoria. O cron dispara em `runAt` (fora da superfície HTTP).
Body: **`CreateScheduleDto`** (`src/tenant-api/pricing/dto/schedule.dto.ts`): `{ runAt: string(ISO date), items: ApplyItemDto[](1..5000), cronExpr?: string(9..100), recalc?: boolean }`. `cronExpr` torna recorrente (re-arma); `recalc` recalcula pelo motor no disparo em vez do preço congelado.
Response interface: **`ScheduleView`** (`src/tenant-api/pricing/pricing-schedule.service.ts`): `{ id, runAt: string(ISO), status: string, applyRunId: string|null, itemCount: number, cronExpr: string|null, recalc: boolean, createdAt: string(ISO) }`.

| Método | Path | Status | Query | Body | Resposta |
|---|---|---|---|---|---|
| GET | `/pricing/schedules` | 200 | — | — | `ScheduleView[]` |
| GET | `/pricing/schedules/:id` | 200 | — | — | `ScheduleView` |
| POST | `/pricing/schedules` | 201 | — | `CreateScheduleDto` | `ScheduleView` |
| DELETE | `/pricing/schedules/:id` | 200 | — | — | `{ id: string, cancelled: true }` |

- **400** body inválido; `cronExpr` inválido (`validateCronExpression`) → "cron inválido: ...".
- **404** GET/DELETE com `id` inexistente (`schedule {id} not found`).
- **409** DELETE de schedule já não-`pending` (ex.: `fired`/`cancelled`): "schedule {id} is {status} and cannot be cancelled".

---

## Recurso: Audit (trilha, somente leitura) — `src/tenant-api/pricing/audit.controller.ts`

Append-only; sem rota de escrita (o registro acontece junto da mutação que o gerou).

### GET `/pricing/audit` — **admin** apenas
- **Roles:** `admin`. **Status:** 200.
- **Query:** `entity?: string`, `entityId?: string`, `page?: string` (default 1), `perPage?: string` (default 50, cap 200).
- **Resposta** (`AuditView[]`, `src/tenant-api/pricing/audit.service.ts`): `{ actor: string|null, action: string, entity: string, entityId: string|null, changes: unknown, createdAt: string(ISO) }[]`. Ordenado `created_at DESC`.
- **403** para operator/viewer.

### Vocabulário de auditoria (gravado pelas mutações acima — útil pra filtrar)
- `entity`: `suggestion_rule`, `cluster`, `apply_run`, `schedule`.
- `action`: `create`/`update`/`delete` (rules, clusters); `apply`/`apply_pending`/`approve`/`reject`/`rollback` (apply_run); `schedule_create`/`schedule_cancel` (schedule).

---

## Notas de integração para o frontend

- **Header `Cache-Control`** só existe em `GET /pricing/suggestions` (`private, max-age=30`). Nenhum outro endpoint seta cache.
- **Fluxo apply completo:** `POST /pricing/apply` (202, guarde `applyRunId`) → poll `GET /pricing/apply/:id` até `status` final (`done`/`failed`). Se vier `approvalStatus:'pending'`, um **admin** precisa `POST /:id/approve` (202) ou `POST /:id/reject` (200) antes do dispatch. `rollback` é um novo apply enfileirado (202) com `idempotencyKey=rollback:<runId>`.
- **Dry-runs sem efeito colateral:** `POST /pricing/suggestions/preview` (regra hipotética) e `POST /pricing/apply/preview` (`wouldAbort` antecipa o circuit breaker) — ambos `@HttpCode(200)`, nada persiste.
- **Paginação inconsistente entre recursos:** `apply`/`audit` recebem `page`/`perPage` como `@Query` strings cruas (parse manual, defaults no service); `suggestions` recebe via DTO tipado (`@IsInt`). O frontend deve mandar números como string em apply/audit.

### data-contracts
I now have the complete picture. Here are the exact data contracts for the frontend.

# Contratos de Dados — Pricing (Farmacore)

Todos os tipos abaixo são extraídos verbatim do backend NestJS. Prefixo de rotas: `/pricing/*`. Auth: JWT por tenant; cada rota tem `@Roles` (anotado). `viewer` **não** acessa nada de pricing — todas as rotas exigem `operator`/`admin` (exceto auditoria, só `admin`).

---

## 1. Tipos compartilhados / enums

```ts
// src/database/enums/competitor-origin.enum.ts — os 9 valores (ver §2 para impacto na tela)
export type CompetitorOrigin =
  | 'DROGAL' | 'DROGASIL' | 'PAGUE_MENOS' | 'IKESAKI' | 'MICHELASSI'
  | 'PACHECO' | 'SAO_PAULO' | 'VENANCIO' | 'INDIANA';

// src/database/enums/user-role.enum.ts (valores em minúsculo no JWT)
export type UserRole = 'admin' | 'operator' | 'viewer';

// pricing-suggestion-rule.entity.ts
export type SuggestionStrategy = 'margem' | 'concorrencia';
export type CompetitorMode = 'weighted' | 'cascade' | 'lowest';

// pricing-suggestion.engine.ts
export type SuggestionTarget = 'precoVenda' | 'precoOferta';
```

---

## 2. CompetitorOrigin — lista COMPLETA e impacto na tela

Os 9 valores do enum (todos): `DROGAL`, `DROGASIL`, `PAGUE_MENOS`, `IKESAKI`, `MICHELASSI`, `PACHECO`, `SAO_PAULO`, `VENANCIO`, `INDIANA`.

**O que muda na tela — colunas dinâmicas por origem habilitada:**
- O tenant habilita um subconjunto dessas 9 origens (tabela `core.tenant_competitor_origin`, com `enabled` + `priority`). O FE **não deve assumir as 9**.
- A fonte de verdade do que renderizar é o array `product.competitors[]` em cada linha de `GET /pricing/suggestions` — ele contém **uma entrada por origem habilitada do tenant**, já na ordem `priority ASC, origin ASC`. Renderize uma coluna de concorrente por entrada, na ordem em que vêm.
- Cada coluna mostra `price` (`null` = sem coleta → renderizar “—”), badge PBM se `isPbm`, e o `van` (código/identificador da origem, pode ser `null`).
- No formulário de regra (`competitors[]`), o seletor de concorrentes deve oferecer **só as origens habilitadas do tenant** (não há endpoint dedicado aqui; derive das origens presentes em `suggestions.rows[].product.competitors[]`, ou de um endpoint de config de origens fora deste módulo). Enviar uma origem não habilitada/ inexistente → 400 (`Concorrente inválido: X`).
- `weight` só aparece/edita quando `competitorMode === 'weighted'`; em `cascade`/`lowest` o peso é ignorado (backend grava 1).

---

## 3. Vocabulário que a UI precisa renderizar (`basis`, `reason`, `target`)

### 3.1 `target` (alvo do preço) — `SuggestionTarget`
```ts
type SuggestionTarget = 'precoVenda' | 'precoOferta';
// precoVenda  → preço de venda regular
// precoOferta → preço de oferta/caderno (exige cadernoId; nunca pode ficar > precoVenda)
```

### 3.2 `basis` (origem do cálculo da sugestão) — só em `result.kind === 'suggestion'`
```ts
type SuggestionBasis = 'concorrencia' | 'margem_minima' | 'margem_sem_concorrente';
// concorrencia          → preço derivado dos concorrentes (modo weighted/cascade/lowest)
// margem_minima         → preço derivado do piso de margem mínima da regra
// margem_sem_concorrente→ concorrência sem preços coletados, usou noCompetitorMargin
```
No relatório de apply (`ApplyReport.items[].basis` e `ApplyPreview.accepted[].basis`) o `basis` é `string | null` (mesmos 3 valores acima, ou `null` quando o item não casou com regra).

### 3.3 `reason` quando NÃO há sugestão — `NoSuggestionReason` (tela de sugestões)
```ts
type NoSuggestionReason =
  | 'sem_regra'        // nenhuma regra ativa cobre o produto
  | 'sem_custo'        // custo ≤ 0, base ≤ 0, minMargin ≥ 100, ou preço final inválido
  | 'margem_ok'        // estratégia margem: já está acima da margem mínima
  | 'sem_concorrente'  // estratégia concorrência: nenhum concorrente com preço (e sem noCompetitorMargin)
  | 'pbm'              // produto PBM bloqueado pela política da regra
  | 'acima_do_venda'   // oferta calculada ficaria acima do preço de venda
  | 'ja_no_alvo';      // preço sugerido == preço atual (nada a fazer)
```

### 3.4 `reason` de REJEIÇÃO no apply (síncrono — `ApplyRejection.reason`, no POST e no preview)
```ts
type ApplyRejectReason =
  | 'nao_encontrado'      // EAN não existe no catálogo do tenant
  | 'sem_custo'           // custo ≤ 0 (sem piso de margem confiável)
  | 'preco_invalido'      // price ≤ 0
  | 'abaixo_do_piso'      // price abaixo do piso de margem da regra vencedora (ou custo)
  | 'variacao_excessiva'  // price sobe >3x ou cai a <1/3 do preço atual do alvo (fat-finger)
  | 'acima_do_venda'      // target=precoOferta e price > precoVenda
  | 'sem_caderno';        // target=precoOferta sem cadernoId resolvível (item nem offer_book)
```

### 3.5 `reason`/`status` do WORKER (assíncrono — aparece em `ApplyReport.items[]` após processar)
Status do item: `'pending' | 'applied' | 'skipped' | 'failed'`. O `reason` acompanha `skipped`/`failed`:
```ts
// skipped (não aplicado por política, não é erro):
//   'em_campanha'        → target=precoVenda com campanha de oferta ativa (não sobrescreve promo)
//   'monitored'          → produto monitorado no ERP (preço travado)
//   'sem_external_id'    → caderno/oferta sem external_id no ERP
// failed:
//   'a7_nao_configurado' → integração A7 do tenant não configurada
//   'nao_encontrado'     → produto não encontrado no ERP no momento do push
//   'erp_conflito'       → conflito genérico (409) do ERP
//   'erro_transitorio'   → erro de rede/HTTP do A7 (reaplicável manualmente)
//   'rejeitado'          → run rejeitado na aprovação (todos os itens pending viram failed)
type ApplyItemReason =
  | 'em_campanha' | 'monitored' | 'sem_external_id'
  | 'a7_nao_configurado' | 'nao_encontrado' | 'erp_conflito'
  | 'erro_transitorio' | 'rejeitado';
```
Nota: `reason` no `ApplyReport.items[]` é `string | null` no backend — a UI deve tolerar valores fora da enum, mas os acima são os únicos emitidos hoje.

---

## 4. Sugestões — `GET /pricing/suggestions` e `POST /pricing/suggestions/preview`

Roles: `operator`, `admin`. `GET` tem `Cache-Control: private, max-age=30`.

### 4.1 Request (query) — `ListSuggestionsQueryDto`
```ts
interface ListSuggestionsQuery {
  page?: number;          // IsInt, Min(1). default 1
  perPage?: number;       // IsInt, Min(1), Max(1000). default 50 (cap 1000)
  name?: string;          // ILIKE %name% no nome do produto
  classification?: string;// ILIKE %classification% na classificação
  books?: string;         // CSV: "Caderno A,Caderno B" — filtra por caderno de oferta
  onlyWithSuggestion?: string; // string literal 'true' para ligar (qualquer outra coisa = off)
  direction?: 'todas' | 'subir' | 'abaixar';        // IsIn. default 'todas'
  origem?: 'todas' | 'cluster' | 'classificacao';   // IsIn. default 'todas'
}
// Nota: filtros boolean/array chegam como STRING (parse no server). page/perPage podem ir como string (Type Number).
```
`POST /preview`: body = `UpsertSuggestionRule` (§6, regra transitória, mesma validação do create) + a MESMA query acima. Calcula a base inteira usando só essa regra.

### 4.2 Response — `SuggestionsResponse`
```ts
interface SuggestionsResponse {
  rows: ResponseRow[];
  count: number;            // total de linhas APÓS filtros (pré-paginação)
  suggestionCount: number;  // quantas linhas (filtradas) têm sugestão
  lockCount: number;        // quantas sugestões bateram no piso de margem (lockApplied)
  activeRuleCount: number;  // nº de regras ativas no cálculo
  availableBooks: { value: string; label: string }[]; // cadernos distintos do conjunto inteiro
}

interface ResponseRow {
  product: ResponseProduct;
  result: SuggestionResult;          // discriminated union (§4.3)
  origem: ClusterOrigin | null;      // !=null quando a regra vencedora é de cluster
}

interface ResponseProduct {
  ean: string;
  name: string;
  supplier: string | null;
  classification: string | null;
  book: string | null;              // caderno de oferta
  cost: number | null;
  priceForSell: number | null;      // preço de venda atual
  priceForOffer: number | null;     // preço de oferta atual
  margin: number | null;
  averageVariation: number | null;
  status: string | null;
  competitors: CompetitorView[];    // uma entrada por origem habilitada (§2)
}

interface CompetitorView {
  origin: CompetitorOrigin;
  price: number | null;             // null = sem coleta
  isPbm: boolean;
  van: string | null;
}

interface ClusterOrigin {
  clusterId: string;
  clusterName: string | null;
  overrodeRuleName: string | null;  // nome da regra de classificação que o cluster sobrepôs (badge "Origem")
}
```

### 4.3 `SuggestionResult` — union discriminada por `kind` (CRÍTICO para a UI)
```ts
type SuggestionResult =
  | { kind: 'suggestion'; suggestion: PriceSuggestion }
  | { kind: 'none'; reason: NoSuggestionReason; rule?: SuggestionRuleApi };

interface PriceSuggestion {
  price: number;                    // preço sugerido (já arredondado se a regra arredonda)
  margin: number;                   // margem % resultante
  rule: SuggestionRuleApi;          // a regra vencedora (shape completo, §6.3)
  target: SuggestionTarget;         // 'precoVenda' | 'precoOferta'
  basis: SuggestionBasis;           // §3.2
  lockApplied: boolean;             // true se bateu no piso de margem mínima
  priceComposition:                 // de onde veio o preço de concorrência (null fora de 'concorrencia')
    | { competitor: string; price: number; weight: number }[]
    | null;
}
```
Nota: em `result.kind === 'none'`, `rule` é `SuggestionRuleApi | undefined` (presente quando havia regra mas ela não gerou sugestão; ausente em `sem_regra`).

---

## 5. Apply (aplicação em massa) — `/pricing/apply`

### 5.1 Item base — `ApplyItemDto`
```ts
interface ApplyItem {
  ean: string;                          // IsString (obrigatório)
  target: 'precoVenda' | 'precoOferta'; // IsIn (obrigatório)
  price: number;                        // IsNumber, Min(0) — preço APROVADO/congelado (pode ser override manual)
  cadernoId?: number;                   // IsInt, Min(1). Opcional; só p/ precoOferta — se ausente, server deriva do offer_book
}
```

### 5.2 `POST /pricing/apply` — cria run e enfileira push ao ERP
Roles: `operator`, `admin`. HTTP **202**.
```ts
interface ApplyPricesRequest {
  idempotencyKey: string;   // IsString, Length(1,200) — reenviar o mesmo POST é no-op
  mode?: 'agora';           // IsIn(['agora']). só 'agora' hoje
  items: ApplyItem[];       // IsArray, ArrayMinSize(1), ArrayMaxSize(5000)
}

interface ApplyResponse {
  applyRunId: string;
  accepted: number;                 // nº de itens aceitos (congelados/validados)
  rejected: ApplyRejection[];       // rejeições síncronas (§3.4)
  idempotent?: boolean;             // true se o POST caiu na chave idempotente existente
  approvalStatus?: 'pending';       // presente quando o run aguarda aprovação de admin (não despachado)
}

interface ApplyRejection {
  ean: string;
  reason: string;                   // §3.4 ApplyRejectReason
}
```
**422 (circuit breaker):** se `total ≥ 10` e `>50%` rejeitado, o lote inteiro é abortado. Body do erro:
```ts
interface ApplyAbortedError {
  message: string;            // "Lote abortado: N/M itens rejeitados. Revise as regras/preços."
  aborted: true;
  rejected: ApplyRejection[];
}
```
Quando `accepted === 0`, retorna `{ applyRunId, accepted: 0, rejected }` e o run fica `done` (nada despachado).
Aprovação obrigatória depende de flag de ambiente (`PRICING_APPLY_REQUIRES_APPROVAL=1`); o FE detecta pelo `approvalStatus: 'pending'` na resposta.

### 5.3 `POST /pricing/apply/preview` — dry-run (nada persiste) — `ApplyPreview`
Roles: `operator`, `admin`. HTTP **200**. Body: `{ items: ApplyItem[] }` (`PreviewApplyDto`, `ArrayMinSize(1)`/`ArrayMaxSize(5000)`).
```ts
interface ApplyPreview {
  total: number;
  accepted: {
    ean: string;
    target: string;          // 'precoVenda' | 'precoOferta'
    price: number;
    basis: string | null;    // §3.2
  }[];
  rejected: ApplyRejection[];
  wouldAbort: boolean;       // true se o circuit breaker barraria o lote real
}
```

### 5.4 `GET /pricing/apply` — histórico de runs — `ApplyRunSummary[]`
Roles: `operator`, `admin`. Query: `page?`, `perPage?` (string; default 1/100, cap 1000).
```ts
interface ApplyRunSummary {
  id: string;
  status: string;                  // 'pending' | 'running' | 'done' | 'failed'
  mode: string;                    // 'agora'
  approvalStatus: string | null;   // null | 'pending' | 'approved' | 'rejected'
  total: number;
  applied: number;
  skipped: number;
  failed: number;
  createdAt: string;               // ISO
}
```

### 5.5 `GET /pricing/apply/:id` — relatório paginado — `ApplyReport`
Roles: `operator`, `admin`. Query: `page?`, `perPage?`.
```ts
interface ApplyReport {
  id: string;
  status: string;                  // 'pending' | 'running' | 'done' | 'failed'
  mode: string;
  approvalStatus: string | null;
  total: number;
  applied: number;
  skipped: number;
  failed: number;
  items: ApplyReportItem[];        // tipado como Record<string,unknown>[] no backend; shape real abaixo
}

interface ApplyReportItem {
  ean: string;
  target: 'precoVenda' | 'precoOferta';
  price: string;                   // numeric → vem como STRING do PG
  status: 'pending' | 'applied' | 'skipped' | 'failed';
  reason: string | null;           // §3.5 ApplyItemReason
  basis: string | null;            // §3.2
  priceOld: string | null;         // price_old do alvo (numeric → string)
  cadernoId: string | null;        // bigint → string
  ruleId: string | null;
  erpResult: string | null;        // ex.: "precoVenda=12.90" / "precoOferta=9.90@caderno=123"
  appliedAt: string | null;        // timestamptz
}
```

### 5.6 Aprovação / rejeição / rollback (admin)
```ts
// POST /pricing/apply/:id/approve  — Roles: admin, HTTP 202
//   → { id: string; approved: boolean }
//   Conflito 409 se o run não está 'pending'; 404 se não existe.

// POST /pricing/apply/:id/reject   — Roles: admin, HTTP 200
//   → { id: string; rejected: boolean }
//   Marca run e itens pending como failed/'rejeitado'.

// POST /pricing/apply/:id/rollback — Roles: operator, admin, HTTP 202
//   → ApplyResponse (reaplica o preço ANTERIOR dos itens 'applied', idempotencyKey "rollback:<runId>")
//   422 se o run não tem nenhum item aplicado reversível.
```

---

## 6. Regras de sugestão — `/pricing/suggestion-rules`

### 6.1 Rotas
- `GET /pricing/suggestion-rules` — `operator`/`admin` → `SuggestionRuleApi[]`
- `POST /pricing/suggestion-rules` — `operator`/`admin`, body `UpsertSuggestionRule` → `SuggestionRuleApi`
- `PATCH /pricing/suggestion-rules/:id` — `operator`/`admin` → `SuggestionRuleApi`
- `DELETE /pricing/suggestion-rules/:id` — `operator`/`admin` → `{ id: string; deleted: boolean }`

### 6.2 Request — `UpsertSuggestionRuleDto` (com TODAS as constraints)
```ts
interface UpsertSuggestionRule {
  name: string;                              // Length(1,120) — obrigatório

  classifications?: string[];                // ArrayMaxSize(200), cada item ≤200 chars (checado no service)
  clusterId?: string | null;                // IsUUID — XOR com classifications (erro 400 se ambos preenchidos)
  excludeClusterIds?: string[];             // ArrayMaxSize(100), UUIDs — não pode conter o próprio clusterId

  strategy?: 'margem' | 'concorrencia';      // default 'margem'

  minMargin: number;                         // Min(0), Max(95) — OBRIGATÓRIO. (motor rejeita ≥100)
  competitorMode?: 'weighted' | 'cascade' | 'lowest'; // default 'weighted'
  competitors?: RuleCompetitor[];            // obrigatório quando strategy='concorrencia' (≥1); senão []
  variationPct?: number;                     // Min(-90), Max(90). default 0 — ajuste % sobre o preço de concorrência
  noCompetitorMargin?: number | null;        // Min(0), Max(95). só vale em strategy='concorrencia' (senão coage null)

  priceControlled?: boolean;                 // default false — força target=precoOferta
  ignorePbm?: boolean;                       // default false — descarta produto PBM em qualquer estratégia
  blockPbmInMargin?: boolean;                // default false — bloqueia PBM especificamente na estratégia margem
  cascadeByPriority?: boolean;               // default false — reordena cascade pela priority do tenant
  applyRounding?: boolean;                   // default TRUE — aplica faixas de arredondamento
  active?: boolean;                          // default true
}

interface RuleCompetitor {
  competitor: CompetitorOrigin;              // IsIn(CompetitorOrigin) — obrigatório
  weight?: number;                           // Min(0), Max(100). só usado em 'weighted' (0<w≤100); ignorado em cascade/lowest
}
```
**Regras cruzadas (validadas no service → 400 com mensagem em pt-BR):**
- `clusterId` XOR `classifications` (não os dois).
- `excludeClusterIds` não pode conter o `clusterId` da própria regra.
- `strategy='concorrencia'` exige ≥1 concorrente; em `weighted` cada peso deve ser `0 < w ≤ 100`.
- Concorrente inválido (fora do enum) ou duplicado → 400.
- `noCompetitorMargin` só persiste em `concorrencia`.
- FK de cluster inexistente → 400 (`Cluster da regra não existe...`).

### 6.3 Response — `SuggestionRuleApi` (numéricos já como `number`)
```ts
interface SuggestionRuleApi {
  id: string;
  name: string;
  classifications: string[];
  clusterId: string | null;
  clusterName: string | null;        // join no nome do cluster
  excludeClusterIds: string[];
  strategy: SuggestionStrategy;
  minMargin: number;
  competitorMode: CompetitorMode;
  competitors: { competitor: CompetitorOrigin; weight: number }[];
  variationPct: number;
  noCompetitorMargin: number | null;
  priceControlled: boolean;
  ignorePbm: boolean;
  blockPbmInMargin: boolean;
  cascadeByPriority: boolean;
  applyRounding: boolean;
  active: boolean;
  createdAt: string;                 // ISO
  updatedAt: string;                 // ISO
}
```

---

## 7. Clusters — `/pricing/clusters`

Rotas: `GET` (lista), `GET /:id`, `POST`, `PATCH /:id`, `DELETE /:id` — todas `operator`/`admin`.
```ts
// Request — UpsertClusterDto
interface UpsertCluster {
  name: string;        // Length(1,120) — obrigatório
  eans?: string[];     // ausente = só renomeia; presente = SUBSTITUI a membership inteira
                       // EANs re-validados no service: regex ^\d{6,14}$, dedup, máx 5000
}

// Response — lista
interface ClusterApi {
  id: string;
  name: string;
  memberCount: number;
  createdAt: string;   // ISO
  updatedAt: string;   // ISO
}

// Response — GET /:id, POST, PATCH (inclui os EANs)
type ClusterDetail = ClusterApi & { eans: string[] };

// DELETE → { id: string; name: string }
//   409 se o cluster está em uso por alguma regra (precisa remover a regra antes).
```

---

## 8. Agendamentos — `/pricing/schedules`

Rotas: `GET` (lista), `GET /:id`, `POST`, `DELETE /:id` — todas `operator`/`admin`.
```ts
// Request — CreateScheduleDto
interface CreateSchedule {
  runAt: string;        // IsDateString (ISO) — quando aplicar — obrigatório
  items: ApplyItem[];   // ArrayMinSize(1), ArrayMaxSize(5000) — mesmo ApplyItem do §5.1
  cronExpr?: string;    // Length(9,100), cron válido — torna recorrente (re-arma após disparar)
  recalc?: boolean;     // default false — no disparo recalcula pelo motor em vez de usar o preço congelado
}

// Response — ScheduleView (GET, GET/:id, POST)
interface ScheduleView {
  id: string;
  runAt: string;             // ISO
  status: string;            // 'pending' | 'fired' | 'cancelled'
  applyRunId: string | null; // preenchido após disparar (último disparo se recorrente)
  itemCount: number;
  cronExpr: string | null;
  recalc: boolean;
  createdAt: string;         // ISO
}

// DELETE /:id → { id: string; cancelled: boolean }
//   409 se o schedule não está 'pending' (ex.: já 'fired'); 404 se não existe.
```

---

## 9. Auditoria — `GET /pricing/audit`

Role: **`admin` apenas**. Query: `entity?`, `entityId?`, `page?`, `perPage?` (string; default 1/50, cap 200).
```ts
interface AuditView {
  actor: string | null;     // user.sub
  action: string;           // 'apply' | 'apply_pending' | 'approve' | 'reject' | 'rollback'
                            // | 'schedule_create' | 'schedule_cancel' | (CRUD de rule/cluster)
  entity: string;           // 'apply_run' | 'schedule' | 'rule' | 'cluster'
  entityId: string | null;
  changes: unknown;         // jsonb arbitrário (ex.: { accepted, rejected } / { runAt, itemCount })
  createdAt: string;        // ISO
}
// Response: AuditView[]
```

---

## Notas de fidelidade para o FE
- **Numéricos do PG via `em.query` chegam como `string`** quando o tipo é `numeric`/`bigint` e a query não os converte. Confirmado em `ApplyReportItem` (`price`, `priceOld`, `cadernoId` são `string|string|null`). Nas demais responses os services já normalizam para `number` (ex.: `SuggestionRuleApi.minMargin`, `ResponseProduct.cost`).
- **`SuggestionResult` é uma union discriminada** — sempre cheque `result.kind` antes de acessar `result.suggestion` ou `result.reason`.
- **`ApplyReport.items` é tipado como `Record<string, unknown>[]`** no backend; o shape real é o `ApplyReportItem` acima (vem do SELECT explícito).
- Caminhos de origem dos contratos (absolutos): DTOs em `src/tenant-api/pricing/dto/`; interfaces de resposta nos services do mesmo diretório; motor em `.../pricing/pricing-suggestion.engine.ts`; worker (reasons assíncronos) em `src/pipeline/steps/apply-price.step.ts`; enums em `src/database/enums/competitor-origin.enum.ts` e `user-role.enum.ts`.

### legacy-ui
I now have the complete picture. Here is the archaeology report.

---

# ARQUEOLOGIA DA UI LEGADA (pricy) — relatório

Raiz: `pricy-legacy/src`

## 1) STACK REAL (de `package.json`)

| Camada | Lib | Versão | Onde aparece |
|---|---|---|---|
| Roteamento | **react-router-dom** | `^7.14.2` | `useNavigate`, `Link` em `SugestaoPrecificacao.tsx`; `Link to="/precos/clusters"` no `RegraSugestaoDialog.tsx` |
| Data-fetching/cache | **@tanstack/react-query** (`catalog:`) | — | `useQuery`/`useMutation`/`useQueryClient` em todos os hooks; wrapper genérico `useApiProxy.ts` |
| HTTP | **fetch** nativo (sem axios) | — | `lib/apiClient.ts` → `fetchEdgeFunction()` chama `${API_BASE}/fn/<endpoint>`, `credentials: 'include'`, Bearer do localStorage, retry 5xx, AbortController |
| Forms | **react-hook-form** `^7.55` + **@hookform/resolvers** `^3.10` | — | Instalados, mas **os dois dialogs NÃO os usam** — usam `useState` manual (`FormState`) + validação imperativa no `handleSave` |
| Validação | **zod** (`catalog:`) | — | Só no `usePricingSuggestionProducts.ts` (parse da resposta). É o ponto que quebra. |
| Tabela | shadcn `Table` (`@/components/ui/table`) | — | Markup `<Table>` plano, sem TanStack Table |
| Virtualização | **@tanstack/react-virtual** `^3.13.24` | — | Instalada e usada em outras telas, mas **a tabela de Sugestão NÃO virtualiza** — renderiza `rows` direto e pagina server-side via `TablePagination` |
| UI kit | **shadcn/ui sobre Radix** (`@radix-ui/*`) + **tailwindcss** `^3.4` + **class-variance-authority** + **lucide-react** (ícones) + **sonner** (toasts) | — | `Button`, `Switch`, `Checkbox`, `RadioGroup`, `Select`, `ScrollArea`, `Dialog`, `Badge`, `Input`, `Textarea`, `Label`; componentes próprios `SeverityPill`, `RibbonHero`, `PageHeader`, `EditableCell`, `MarginCell`, `TableSkeleton` |
| Outras | date-fns, recharts, write-excel-file, @xyflow/react, cmdk | — | Não usadas nestas 5 telas |

Confirmações pedidas: react-router-dom **v7** ✓; @tanstack/react-virtual ✓ (presente, não usado aqui); UI = **shadcn/Radix + Tailwind**; form = **react-hook-form instalado mas não usado nos dialogs**; validação = **zod só no hook de produtos**.

---

## 2) POR TELA

### A) `pages/precos/SugestaoPrecificacao.tsx` (a tela central, ~800 linhas)
**O que faz:** lista produtos com preço sugerido pelo motor (servidor), permite editar o sugerido inline, selecionar em massa por EAN e aplicar/agendar a mudança de preço.

- **Componentes:** `PageHeader`, `RibbonHero`, `SeverityPill`, `Table*`, `EditableCell`, `MarginCell`, `TableSkeleton`, `ClassificationFilter`, `TablePagination`, `MultiSelectFilter`, `PriceChangeDialog`, `Checkbox`, `Switch`, `Input`, ícones lucide (`Lock`, `ArrowUp/Down`, `AlertTriangle`, `RefreshCw`, `Settings2`).
- **Estado (useState/useRef):** `page`, `perPage`, `nameInput` (+ `useDebounce` 400ms → `name`), `classification`, `cadernos[]`, `soComSugestao`, `direcao` (`todas|subir|abaixar`), `origem` (`todas|cluster|classificacao`), `overrides: Map<ean, {price, target}>`, `selected: Set<ean>` (persiste entre filtros/páginas), `cursor` (navegação ↑↓ + espaço), `tableWrapRef`.
- **Colunas (15):** checkbox · EAN · Nome · Fab. · Class. · Caderno · Custo · P. Venda · P. Oferta · Margem · Direção (delta %) · **Preço Sugerido (EditableCell)** · Margem Sug. · Aplica em (P.Venda/P.Oferta + composição/cadeado de trava) · Origem (badge de cluster).
- **Filtros client→server:** todos viram query params via o hook (`name, classification, books, onlyWithSuggestion, direction, origem`).
- **Validações client-side:** override de preço `>0` e finito (senão toast); re-checa campanhas de oferta ativas no momento do apply (bloqueia EANs em campanha; fail-closed se a lista não carrega).
- **Chamadas API:** `usePricingSuggestionProducts` (endpoint `pricing-suggestions-products`); `useQuery` direto p/ `offer-campaign-list?eans=active`; `usePriceMutations.updatePrices` (apply agora); `usePriceSchedules.createSchedule` (agendar). Cada item aplicado mapeia `priceType: campo==='precoOferta' ? 'offer' : 'sell'` e usa `productId`.

### B) `pages/precos/RegrasSugestao.tsx`
**O que faz:** CRUD em tabela das regras de sugestão; toggle de `active` inline; abre `RegraSugestaoDialog`.
- **Estado:** `dialogOpen`, `editing: SuggestionRule | null`.
- **Colunas (10):** Nome · Classificações (badges; cluster 🧩 / "Todas" / excludeClusters −N) · Estratégia (`SeverityPill`) · Margem mín. · **Concorrência** (`concorrenciaResumo()` — renderiza cascata `→`, "menor preço" `·`, ou ponderada com `weightsToPercents`) · Aplica em (P.Venda vs P.Oferta se `priceControlled`) · Ignora PBM · Arredonda · Ativa (`Switch`) · ações.
- **API:** `useSuggestionRules` (list), `useSaveSuggestionRule`, `useDeleteSuggestionRule` (endpoints `pricing-suggestion-rules-list/save/delete`). Exclusão via `window.confirm`.

### C) `pages/precos/Clusters.tsx`
**O que faz:** CRUD em tabela de clusters de EAN; abre `ClusterDialog`.
- **Colunas (4):** Nome · Membros (`memberCount`) · Criado em (`createdAt`) · ações.
- **API:** `useProductClusters` (list, endpoint `clusters-list`), `useDeleteCluster` (`clusters-delete`).

### D) `components/precos/RegraSugestaoDialog.tsx` (o form pesado, ~880 linhas)
- **Form:** `useState<FormState>` derivado de `toFormState(rule)`; **sem react-hook-form/zod** — validação 100% imperativa no `handleSave` espelhando o `validate()` do backend antigo.
- **Campos:** `name`; `target` (classification|cluster, RadioGroup); `classifications[]` (busca + ScrollArea de checkboxes, cap 100 visíveis); `clusterId` (RadioGroup); `excludeClusterIds[]`; `strategy` (margem|concorrencia); `competitorMode` (`weighted`|`cascade`|`lowest`, com `switchMode` que re-semeia pesos iguais); `minMargin`; `competitorChecked`/`competitorWeight` por concorrente; `cascadeOrder[]` (mover ↑↓, add/remove); `variationPct`; `noCompetitorMargin`; `priceControlled`; `ignorePbm`; `applyRounding` + `priceRoundingTypeId` (Select de `usePriceRoundingTypes`); `active`.
- **Validações:** nome obrigatório; cluster obrigatório se target=cluster; `minMargin` 0–95; pesos somam 100 (±0.5) no weighted, ≥1 concorrente no cascade/lowest; `variationPct` −90..90; `noCompetitorMargin` 0–95; tipo de arredondamento obrigatório se `applyRounding`.
- **Hooks auxiliares:** `useGroupedClassifications`, `useProductClusters`, `usePriceRoundingTypes`, `useSaveSuggestionRule`.

### E) `components/precos/ClusterDialog.tsx`
- **Form:** `useState` manual; campos `name`, `eans: Set<string>`, `search`, `pasteText`.
- **Lógica:** `parseEanCsv()` (BOM, `;`/`,`, header, dedup); busca via `useMarketProducts`; validação preguiçosa "fora do catálogo" via `useMarketProducts` com `eanFilter`; cap `MAX_MEMBERS=5000`; `EAN_RE=/^\d{6,14}$/`.
- **API:** `useClusterEans` (`clusters-get`, lazy), `useSaveCluster` (`clusters-save`).

---

## 3) O CONTRATO QUE QUEBRA

### 3.1 `usePricingSuggestionProducts.ts` — o Zod que estoura (`apiResponseSchema.parse(data)` na linha 148)

O schema `apiProductSchema` (linhas 7–28) exige um **objeto achatado por concorrente fixo (Drogal/Drogasil/Michelassi)**. O novo backend (`pricing-suggestions.service.ts`, interface `ResponseProduct` linhas 33–46) devolve **um array genérico `competitors[]`**. Diffs campo a campo:

| Campo que o Zod legado lê | Novo backend (`ResponseProduct`) | Efeito |
|---|---|---|
| `id: z.number()` **(obrigatório, sem default)** | **REMOVIDO** — não há `id`; `toSuggestionProduct` usa `id: 0` interno | **`.parse()` lança** "Required" / "Expected number, received undefined". Quebra dura. |
| `curve: z.string().nullable().optional().default(null)` | **REMOVIDO** | Não quebra o parse (tem default), mas `mapApiToProduct` grava `curvaQntBrick` sempre `""` |
| `drogalPrice`, `drogasilPrice`, `michelassiPrice` | **REMOVIDOS** — agora vêm em `competitors: [{ origin, price, isPbm, van }]` | `precoDrogal/precoDrogasil/precoMichelassi` sempre 0; competidores reais ignorados |
| `drogalIsPbm`, `drogasilIsPbm` | substituídos por `competitors[].isPbm` (por origem) | `buildPbmVans` e flag `pbm` sempre vazios/false |
| `drogalVan`, `drogasilVan` | substituídos por `competitors[].van` | idem |
| `priceForSell`, `priceForOffer`, `cost`, `margin`, `averageVariation` | **mudaram de tipo**: legado aceita `string|number` default `"0"`; novo manda `number \| null` | `null` **falha** o `z.union([string,number])` (não aceita `null`) → outro ponto de quebra |
| `name/supplier/classification/book/status` | iguais (nullable) | ok |

Campos **novos** que o backend traz e o front ainda não modela: o array `competitors[]` cobre **9 origens** (`DROGAL, DROGASIL, PAGUE_MENOS, IKESAKI, MICHELASSI, PACHECO, SAO_PAULO, VENANCIO, INDIANA` — `competitor-origin.enum.ts`), não mais 3 fixos. Toda a UI de Sugestão (composição, badges "Seguindo X", `SUGGESTION_COMPETITOR_LABELS`) e o type `SuggestionCompetitor = 'drogal'|'drogasil'|'michelassi'` (`types/pricingSuggestion.ts:9`) estão presos a 3 concorrentes minúsculos; o backend usa enum MAIÚSCULO com 9 valores.

A camada externa (`suggestionRowSchema`, `apiResponseSchema`: `count, suggestionCount, lockCount, activeRuleCount, availableBooks, rows[]`) **continua compatível** com `SuggestionsResponse` do novo service. O `result`/`origem` são `z.custom()` (não validados), então só o `product` quebra.

### 3.2 Regra de sugestão (`types/pricingSuggestion.ts` `SuggestionRule` vs `SuggestionRuleApi` do backend)

| Campo legado | Novo backend (`suggestion-rules.service.ts` `SuggestionRuleApi`) | Nota |
|---|---|---|
| `priceRoundingTypeId: number \| null` | **REMOVIDO** do `SuggestionRuleApi` e do DTO (`suggestion-rule.dto.ts` só tem `applyRounding: boolean`) | O `RegraSugestaoDialog` envia/lê `priceRoundingTypeId` (linhas 71, 120, 371) — campo **morto** no novo contrato |
| — | **`blockPbmInMargin: boolean` (NOVO)** | Não existe no type nem no dialog legados |
| — | **`cascadeByPriority: boolean` (NOVO)** | Idem; controla reordenação por prioridade de origem no service (linhas 220–229) |
| `competitors[].competitor` minúsculo (`drogal`...) | `CompetitorOrigin` MAIÚSCULO (9 valores) | Incompatível com `SUGGESTION_COMPETITOR_LABELS`/`ALL_SUGGESTION_COMPETITORS` |
| `id: string`, `clusterName`, datas | iguais | ok |

### 3.3 Clusters — **sem quebra**
`Cluster` (`{ id, name, memberCount, createdAt, updatedAt }`, `types/pricingSuggestion.ts:108`) bate exatamente com o `ClusterApi` do `clusters.service.ts`. `ClusterInput`/`clusters-save`/`clusters-get` (EANs) idem.

---

## Resumo executável para o redesenho
1. **Reescrever `usePricingSuggestionProducts.ts`**: trocar os 9 campos por-concorrente do `apiProductSchema` por `competitors: z.array(z.object({ origin, price: number().nullable(), isPbm, van: string().nullable() }))`; **remover `id` obrigatório** (ou `.optional()`); aceitar `null` em `cost/priceForSell/priceForOffer/margin/averageVariation` (`z.union([string, number]).nullable()`); remover `curve`.
2. **Generalizar concorrentes de 3→9**: `SuggestionCompetitor`, `SUGGESTION_COMPETITOR_LABELS`, `ALL_SUGGESTION_COMPETITORS` e toda a UI de composição/badges precisam virar data-driven pelo enum `CompetitorOrigin` (vir do backend, idealmente via `/pricing/competitor-origins`).
3. **`SuggestionRule` + `RegraSugestaoDialog`**: remover `priceRoundingTypeId` (e o Select + `usePriceRoundingTypes`); **adicionar** os toggles `blockPbmInMargin` e `cascadeByPriority`.
4. Migrar URLs de endpoint do estilo `fn/<edge-function>` (`pricing-suggestions-products`, `pricing-suggestion-rules-*`, `clusters-*`, `offer-campaign-list`) para as rotas REST do novo NestJS (`/pricing/suggestions`, `/pricing/rules`, `/pricing/clusters`, etc.).

Arquivos-chave (absolutos):
- `pricy-legacy/src/hooks/usePricingSuggestionProducts.ts` (Zod que quebra)
- `pricy-legacy/src/types/pricingSuggestion.ts` (types travados em 3 concorrentes + `priceRoundingTypeId`)
- `pricy-legacy/src/components/precos/RegraSugestaoDialog.tsx` (form imperativo, sem RHF/zod)
- Backend novo (contrato-alvo): `src/tenant-api/pricing/pricing-suggestions.service.ts`, `.../dto/suggestion-rule.dto.ts`, `.../suggestion-rules.service.ts`, `src/database/enums/competitor-origin.enum.ts`

### gaps-decisions
I have the full document. I also already read CLAUDE.md (it's in my context). Let me produce the deliverable.

# Plano de Backend → o que trava o FE e o que é NET-NEW

Fonte: `docs/plano-pricing-suggestion-port-2026-06-22.md`

Leitura-chave do CLAUDE.md (princípio de simplicidade): o front deve evitar abstração prematura — 3 colunas fixas repetidas valem mais que um sistema de colunas dinâmicas se só 3 origens importam na prática. Isso é relevante para a decisão de N origens (item 1.2 abaixo).

---

## 1. Decisões de produto/contrato AINDA EM ABERTO que o FE precisa que alguém feche

Status crítico do plano: as Fases 1–2 estão entregues no backend, mas **valor ao usuário hoje é zero** porque nenhuma tela consome o contrato. A tela atual (`usePricingSuggestionProducts.ts`, validação Zod, em OUTRO repo — `pricy-shelf`) **quebra inteira no corte** (Zod rejeita, não degrada). Todas as decisões abaixo estão marcadas no §17-bis como 🔴 "impossível neste repo" — ou seja, o backend NÃO vai fechá-las; **precisam de um dono fora deste repo**. O plano não atribui dono nem prazo a nenhuma — esse é o gap principal.

### 1.1 Contrato vs. front pricy — id/curve/campos fixos (BLOQUEADOR de valor) — §17.1, §14, §17-bis #1

- **O que quebra:** a API nova **não** retorna `product.id` (numérico do ERP) nem `curve`, e troca `precoDrogal/precoDrogasil/precoMichelassi` + `*IsPbm` + `*Van` por um array `competitors:[{origin,price,isPbm,van}]`. O Zod do hook exige os campos antigos → tela morre no dia do corte.
- **Decisão a fechar (3 opções, sem default escolhido):**
  - (a) manter `id`/`curve` + os 3 campos fixos por compat;
  - (b) versionar o endpoint;
  - (c) entregar back + front reescrito no mesmo PR.
- **Implicação já decidida pelo backend que o FE precisa absorver:** a chave de apply ponta-a-ponta é **EAN**, não `productId`. A limpeza de seleção do front (que hoje é por `productId` numérico) **passa a ser por EAN** (§9.8).
- **Dono + prazo: A DEFINIR.** O plano explicita "Dono e prazo a definir" e marca como bloqueador de valor.

### 1.2 N origens na tela — colunas dinâmicas vs. subconjunto fixo + PBM/van por origem — §17.11, §17-bis #11

- **O conflito:** o backend generalizou para **9 origens** (`DROGAL, DROGASIL, PAGUE_MENOS, IKESAKI, MICHELASSI, PACHECO, SAO_PAULO, VENANCIO, INDIANA`), habilitadas/priorizadas por tenant em `core.tenant_competitor_origin`. O legado é hard-coded em **3 colunas** (Drogal/Drogasil/Michelassi) com **PBM/van só de Drogal+Drogasil**.
- **Decisão a fechar:** a tela mostra **colunas dinâmicas por origem habilitada** ou um **subconjunto fixo**? E **como exibir PBM/van para N origens** (hoje van vem por-origem no array `competitors[]`, antes era só 2 colunas)?
- **Por que trava o FE:** "isso fecha o shape final de `competitors[]` e desbloqueia o redesign do front." Sem essa decisão, o FE não sabe como renderizar a linha de produto.
- **Dono + prazo: A DEFINIR** (marcado "decisão de layout da tela (outro repo)").

### 1.3 RBAC / viewer — §17.3, §7, §12, §17-bis #3

- **Já decidido (travado, não em aberto):** leitura de `GET /pricing/suggestions` e `/suggestion-rules` exige `@Roles(OPERATOR, ADMIN)` — **não** "qualquer autenticado", porque expõe custo/margem/composição (inteligência competitiva). O FE não pode assumir uma rota de leitura pública.
- **Já entregue como flag:** aprovação do apply ad-hoc via `PRICING_APPLY_REQUIRES_APPROVAL` (default off) → segura o dispatch até `POST /pricing/apply/:id/approve` (admin); `/reject` falha o run. **Escopo:** só o POST direto; agendamento e rollback passam sem nova aprovação.
- **Ainda em aberto para o FE:** se deve existir um perfil **`VIEWER_PRICING`** (só-leitura). O plano diz: "se surgir necessidade de um perfil só-leitura, criar `VIEWER_PRICING` em vez de abrir a rota" — mas **a necessidade não foi confirmada**. O FE precisa saber se haverá um terceiro perfil para desenhar a tela read-only.
- **Dono + prazo: A DEFINIR** (decisão de produto sobre se viewer existe).

> Nota: as demais decisões de negócio do §17 (dedup de concorrente #4, PBM em margem #5, cascade por priority #6, retenção #7, banda de override #8, recalc vs congela #9, auditoria #10) **já foram resolvidas no backend** como flag/feito (§17-bis) e não bloqueiam o FE — viram opções de UI (seção 3 abaixo).

---

## 2. Telas PORTADAS do legado vs. NET-NEW (sem precedente — precisam de design do zero)

### PORTADAS (têm precedente no pricy-shelf — design existente para referência)

| Tela | Rota farmacore | Precedente legado |
|---|---|---|
| **Regras de sugestão** (CRUD) | `GET/POST/PATCH/DELETE /pricing/suggestion-rules` | `/regras` — `pricing-suggestion-rules-*` |
| **Clusters de produto** (CRUD + membership) | `GET/POST/PATCH/DELETE /pricing/clusters` | `clusters-*` (parte de `/regras`) |
| **Sugestões de preço** (lista filtrável, edição linha-a-linha) | `GET /pricing/suggestions` | `/precos/sugestoes` — `pricing-suggestions-products` |

Mesmo "portadas", **mudam de shape**: a tela de Sugestões precisa absorver `competitors[]`, perda de `id`/`curve`, `result` como discriminated union (`kind: suggestion|none` + 7 motivos), e as 4 contagens de cabeçalho (`count`, `suggestionCount`, `lockCount`, `activeRuleCount`). A edição linha-a-linha (override manual) continua válida e é explicitamente legítima (§9.8).

### NET-NEW — sem precedente no legado, precisam de design do zero

O legado aplicava preço pelo ERP-proxy `/scheduling`; o farmacore não tem esse proxy. Logo, todo o fluxo de aplicação/agendamento/auditoria/aprovação é UI inédita:

| Tela / Fluxo NET-NEW | Endpoints | Por que é design do zero |
|---|---|---|
| **Aplicar em massa** | `POST /pricing/apply` (→202 `{applyRunId, accepted, rejected[]}`), `GET /pricing/apply/:id` (relatório paginado, polling enquanto `queued/running`) | Legado mandava direto ao ERP sem run/relatório próprio. Agora há um **run assíncrono** com estados por item (`pending/applying/applied/skipped/failed`) e **8 motivos estruturados de rejeição** (`monitored`, `sem_external_id`, `a7_nao_configurado`, `em_campanha`, `recalculo_divergente`, `sem_sugestao`, `sem_caderno`, `expirado`) que a UI tem de mostrar item-a-item. |
| **Agendamentos** (com recorrência + recálculo) | `POST/GET/DELETE /pricing/schedules` | Legado só gravava `executionDate` no ERP (sem UI própria de gestão). NET-NEW: lista de schedules, `run_at` (one-shot) vs `cronExpr` (recorrente), guarda-corpos `max_items`/`max_variation_pct`, flag `recalc`, `last_run_id`. |
| **Auditoria** | `GET /pricing/audit` (admin) | Farmacore **não tinha auditoria**. NET-NEW: trilha de ator + EANs + preço anterior/novo + basis/regra + timestamp + resultado A7, por item. |
| **Fluxo de Aprovação** | `POST /pricing/apply/:id/approve` · `/reject` (admin) | Inexistente no legado. NET-NEW: estado "aguardando aprovação" quando `PRICING_APPLY_REQUIRES_APPROVAL` está on; tela admin para aprovar/rejeitar um run pendente. |
| **Histórico + Rollback** | `GET /pricing/apply` (lista runs), `POST /pricing/apply/:id/rollback` | NET-NEW (roadmap §18, já entregue): reaplica `price_old_*`. UI de histórico de runs + botão de desfazer. |
| **Dry-run / Preview** | `POST /pricing/suggestions/preview` (regra não salva), `POST /pricing/apply/preview` (revalida sem persistir) | NET-NEW (§18, entregue): preview de regra antes de salvar e pré-check de apply/schedule. |

---

## 3. Flags configuráveis que a UI deve expor

Todas seguem a convenção opt-in, **default = comportamento atual** (§17-bis). A UI precisa de controles para elas:

### Por regra (`pricing_suggestion_rule`) — toggles no formulário de regra

| Flag | Default | Efeito | Ref |
|---|---|---|---|
| `blockPbmInMargin` | `false` | Bloqueia sugestão de gôndola para item PBM também na estratégia **margem** (hoje só bloqueia em concorrência) | §17-bis #5a, §8 |
| `cascadeByPriority` | `false` | No modo `cascade`, segue a `priority` de `core.tenant_competitor_origin` em vez da ordem do array `competitors` que o usuário inseriu | §17-bis #6, §8 |

(Outros campos da regra já existiam no legado: `strategy`, `minMargin`, `competitorMode`, `competitors[]`+`weight`, `variationPct`, `noCompetitorMargin`, `priceControlled`, `ignorePbm`, `applyRounding`, `active` — formulário portado, não net-new.)

### Por schedule (`pricing_schedule`) — campos no formulário de agendamento

| Flag/campo | Default | Efeito | Ref |
|---|---|---|---|
| `recalc` | `false` (= congela) | `true` recalcula na hora da execução; `false` congela o preço aprovado que o operador viu | §17-bis #9, §9.7 |
| `cronExpr` | — | Expressão cron → recorrência (re-arma na próxima ocorrência). Mutuamente exclusivo com `run_at` (CHECK no DB) | §17-bis #9, §6 |
| `run_at` | — | Disparo único; após rodar, `active=false`. Exclusivo com `cron` | §9.7, §6 |
| `max_items` | nullable | Teto de itens que um schedule move por execução (guarda-corpo) | §9.7 |
| `max_variation_pct` | nullable | Rejeita item cujo delta exceda o teto → reason `expirado` | §9.7 |

### Por ambiente (env) — não é controle de UI, mas a UI reage ao estado

| Flag (env) | Default | Efeito na UI | Ref |
|---|---|---|---|
| `PRICING_APPLY_REQUIRES_APPROVAL` | off | Quando on, o apply ad-hoc fica "aguardando aprovação" → UI precisa do estado pendente + ações approve/reject (admin) | §17-bis #3 |
| `PRICING_RUN_TTL_DAYS` | 90 | `PricingRetentionCron` soft-deleta runs encerrados além do TTL → afeta o que a tela de Histórico mostra | §17-bis #7 |

**Circuit breaker (não-configurável por UI, mas a UI mostra o resultado):** aborta o run com **422** se um lote grande (≥10 itens) tiver >50% rejeitado. Limites são constantes tunáveis no service, não expostos ao operador — mas a tela de Aplicar precisa tratar o 422 ("lote abortado por sanidade").

---

## Resumo executivo para o FE

1. **3 decisões travam o FE e nenhuma tem dono/prazo** (todas marcadas 🔴 impossível neste repo, ou seja, o backend não vai fechá-las): (1.1) shape do contrato — manter id/curve vs versionar vs back+front no mesmo PR; (1.2) N origens — colunas dinâmicas vs fixas + PBM/van por origem; (1.3) se existe `VIEWER_PRICING`. **Ação:** escalar para o dono de produto definir dono+prazo de cada uma.
2. **3 telas são portadas** (Regras, Clusters, Sugestões) mas mudam de shape; **6 fluxos são net-new** sem precedente (Aplicar em massa, Agendamentos com recorrência/recálculo, Auditoria, Aprovação, Histórico/Rollback, Dry-run) e precisam de design do zero.
3. **A UI deve expor:** `blockPbmInMargin` e `cascadeByPriority` por regra; `recalc`/`cronExpr`/`run_at`/`max_items`/`max_variation_pct` por schedule; e reagir aos estados de `PRICING_APPLY_REQUIRES_APPROVAL` e `PRICING_RUN_TTL_DAYS` (env).
