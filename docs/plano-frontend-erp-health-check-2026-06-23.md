# Plano de Frontend — Saúde da Conexão ao ERP (Farmacore)

> **Data:** 2026-06-23 · **Backend de referência:** branch `cinegagliamarco/db-health-check` (endpoints de health do ERP por tenant). · **Repositório do FE:** separado deste repo (o farmacore é só backend). · **Stack assumida:** React + TypeScript · react-router-dom v7 · TanStack Query · shadcn/ui sobre Radix + Tailwind · sonner · `fetch` nativo (sem axios). Mesma stack dos demais `plano-frontend-*`.

---

## 1. Resumo executivo

O backend ganhou dois endpoints que respondem a uma pergunta operacional simples: **"a conexão ao banco do ERP (A7Pharma) está funcionando?"**. Hoje só dá pra responder via `curl` autenticado. O FE entrega duas superfícies, com públicos e contratos diferentes:

1. **Painel do system-admin (visão de frota):** uma tabela que mostra, de uma vez, a saúde do ERP de **todos** os tenants ativos — quem está conectado, quem caiu, há quanto tempo foi confirmado, e o erro cru do driver pra debug. É a tela que a operação da Farmacore usa pra triagem.
2. **Card do admin do tenant (status do próprio ERP):** um cartão "Conexão com o ERP" na área de configuração do tenant, mostrando só **conectado / offline / não configurado** + última verificação. Sem detalhe de infra (host/credencial são geridos pela Farmacore, não pelo tenant).

**Critério de sucesso:** (a) um operador da Farmacore abre o painel e vê em segundos qual tenant está com o ERP fora, com o erro pra agir; (b) um admin de farmácia abre suas configurações e sabe se a integração está no ar, sem precisar abrir chamado às cegas.

**Princípio guia (CLAUDE.md):** simplicidade. É uma feature pequena — duas telas read-only consumindo dois endpoints. Sem abstração prematura. Não há configuração de conexão no FE (isso é onboarding do system-admin, fora de escopo).

---

## 2. Contrato de API (a fonte da verdade)

Sem prefixo global. Auth por JWT Bearer (`Authorization: Bearer <token>`) via guards globais: `JwtAuthGuard` (401 sem/with token inválido) + `RolesGuard` (403 `Insufficient role`). O painel de frota tem ainda o `SystemAdminGuard` (403 `System admin required`).

### 2.1 `GET /admin/integrations/health` — frota (system-admin)

- **Quem:** JWT com `tenantId === 'system'` **e** `role === 'admin'`. Senão **403**.
- **200 →** `IntegrationHealthReport`:

```ts
type IntegrationOrigin = 'a7pharma';
type IntegrationStatus = 'active' | 'disabled' | 'error';

interface IntegrationHealthEntry {
  tenantSlug: string;
  origin: IntegrationOrigin;
  status: IntegrationStatus;       // na frota é sempre 'active' (ver nota)
  ok: boolean;                     // a verdade da saúde — NÃO é o HTTP status
  lastVerifiedAt: string | null;   // ISO; última vez confirmada FUNCIONANDO
  error: string | null;            // mensagem CRUA do driver (só admin) ou null
}

interface IntegrationHealthReport {
  checkedAt: string;   // ISO — quando a frota foi consultada
  total: number;
  healthy: number;
  unhealthy: number;
  connections: IntegrationHealthEntry[];
}
```

- **Nota importante:** a frota só inclui conexões `status: 'active'`. Conexões **desabilitadas não aparecem** no relatório. Logo `total` = número de integrações ativas, não de tenants. Um tenant sem integração configurada simplesmente não tem linha aqui.

### 2.2 `GET /integration/health` — próprio tenant (tenant-admin)

- **Quem:** JWT com `role === 'admin'` (qualquer `tenantId`). Operator/Viewer recebem **403**. O tenant vem do JWT — **não** há slug na URL, não dá pra consultar outro tenant.
- **200 →** `{ ok: boolean; lastVerifiedAt: string | null }` (resposta **sanitizada**, sem `error`).
- **404 →** `{ statusCode: 404, message: "No integration connection configured", error: "Not Found" }` quando o tenant não tem integração cadastrada.
- **Desabilitada:** se a integração existe mas está `disabled`, retorna **200 `{ ok: false }`** sem pingar (não dá pra distinguir de "offline" — é proposital).

```ts
interface TenantIntegrationHealth {
  ok: boolean;
  lastVerifiedAt: string | null;
}
```

### 2.3 `POST /admin/tenants/:slug/integration/test` — "testar agora" por tenant (system-admin)

- Já existia. É o botão **"Testar agora"** na linha do painel de frota.
- Diferente do `GET .../health`, **ignora o cache** (tentativa fresca de conexão).
- **200 →** `{ ok: true } | { ok: false; error: string }`. **404** se tenant/integração não existem.

### 2.4 Quatro regras que o FE precisa interiorizar

1. **Saúde está no corpo, não no HTTP.** Os endpoints retornam **200 com `ok: false`** quando o ERP está fora. NUNCA trate não-2xx como "ERP caído". `401/403/404` são auth/config, não saúde. Faça `select`/render em cima de `ok` do corpo.
2. **O backend já tem cache de 10s por conexão** (single-flight). Polling mais rápido que isso devolve o mesmo resultado e **não** abre conexão nova ao ERP — pode pollar à vontade que não martela. Recomendação: `refetchInterval` de **30s** (não precisa ser mais rápido). O `POST .../test` é a exceção que sempre tenta fresco.
3. **`lastVerifiedAt` = última vez que confirmou FUNCIONANDO**, não "última checagem". Pode estar no passado mesmo com `ok: false`. Renderize os dois: status atual (`ok`) **e** "última vez OK há X". Ex.: *"Offline · última conexão OK há 2 h"*.
4. **`error` (só frota) é mensagem crua do driver** (ex.: `password authentication failed for user "x"`, `connection error (ECONNREFUSED)`). É pra **debug do system-admin**. Nunca exiba no card do tenant.

---

## 3. Tela A — Painel de Saúde das Integrações (system-admin)

**Rota:** `/admin/integracoes/saude` (ajustar ao padrão de rotas admin do FE). Guard: só system-admin; senão redirect/403.

**Layout:**

- **Cabeçalho-resumo:** três contadores grandes — **Total**, **Saudáveis** (verde), **Com problema** (vermelho) — + timestamp *"Atualizado há Xs"* (`checkedAt`) + botão **Atualizar** (refetch manual) com spinner.
- **Tabela** (uma linha por `connection`), ordenada **`ok: false` primeiro** (problemas no topo):

| Coluna | Conteúdo |
|---|---|
| Tenant | `tenantSlug` |
| Origem | `origin` (badge "A7Pharma") |
| Status | **pill** — ✓ Conectado (verde) / ✕ Offline (vermelho). Texto + ícone, **não só cor** (acessibilidade) |
| Última verificação | `lastVerifiedAt` relativo ("há 2 min"), `—` se `null`; tooltip com data absoluta |
| Erro | se `ok:false`: trecho de `error` truncado + expand pra ver completo (monospace). Se `ok:true`: vazio |
| Ações | botão **Testar agora** → `POST /admin/tenants/:slug/integration/test`; mostra resultado fresco via toast e revalida a linha |

**Estados:**
- **Loading:** skeleton de 5 linhas + contadores em placeholder.
- **Vazio** (`connections.length === 0`): *"Nenhuma integração ativa no momento."* (lembrar: desabilitadas não aparecem).
- **403:** *"Acesso restrito ao admin do sistema."* (não deveria acontecer se o guard de rota já bloqueia).
- **Erro de rede/5xx:** banner *"Não foi possível carregar"* + botão tentar de novo (TanStack já faz retry de 5xx).

**Polling:** `refetchInterval: 30_000`, `refetchIntervalInBackground: false` (pausa com a aba oculta), `refetchOnWindowFocus: true`.

**"Testar agora":** `useMutation`; `onSuccess` → `toast.success`/`toast.error` com base em `{ ok }` (em erro, mostrar `error`); depois `queryClient.invalidateQueries` da frota pra a linha refletir. Desabilita o botão ~10s após o clique (lembrete visual de que o `GET` ainda devolverá cache nesse intervalo; o `POST` em si é fresco).

---

## 4. Tela B — Card "Conexão com o ERP" (tenant-admin)

**Onde:** na página de Configurações/Integração do tenant (mesma área onde hoje se veria a integração). Visível **só para `role === 'admin'`** do tenant; para operator/viewer, esconder o card (ou render desabilitado). Como o backend retorna 403 pra não-admin, o FE deve gatear pelo role **antes** de chamar, pra não disparar 403 desnecessário.

**Conteúdo (compacto):**

- Título: **"Conexão com o ERP"**.
- **Pill de status:**
  - `ok: true` → **Conectado** (verde, ícone ✓).
  - `ok: false` (200) → **Offline** (vermelho/âmbar, ícone ⚠) + microcopy *"Não foi possível conectar ao seu ERP. Fale com o suporte da Farmacore."*
  - **404** → **Não configurado** (cinza) + *"Integração com o ERP ainda não configurada."*
- **Última verificação:** `lastVerifiedAt` relativo ("confirmada há 5 min"), oculto se `null`.
- Botão **Verificar agora** (refetch). Microcopy/disable de ~10s lembrando do cache.

**Importante (segurança/UX):** o card **nunca** mostra `error`, host, usuário ou qualquer detalhe de infra — o contrato do tenant já vem sanitizado. "Offline" e "desabilitado" são indistinguíveis aqui de propósito; em ambos a ação é a mesma (falar com o suporte).

**Estados:** loading (skeleton do pill), 404 (não configurado), erro de rede (texto neutro "não foi possível verificar agora" + retry). Sem polling agressivo: refetch on mount + on focus + botão manual bastam (não precisa `refetchInterval` num card de config).

---

## 5. Camada técnica (transversal)

### 5.1 Tipos — `src/types/integration-health.ts`
Espelhar os contratos da §2 (`IntegrationOrigin`, `IntegrationStatus`, `IntegrationHealthEntry`, `IntegrationHealthReport`, `TenantIntegrationHealth`). Validar com zod no boundary (degradar campos desconhecidos, **não** quebrar a tela).

### 5.2 Hooks (TanStack Query)
- `useFleetHealth()` → `queryKey: ['integrations','health','fleet']`, `queryFn: GET /admin/integrations/health`, `refetchInterval: 30_000`, `staleTime: 10_000` (alinhado ao cache do backend), `refetchIntervalInBackground: false`.
- `useTenantIntegrationHealth({ enabled })` → `queryKey: ['integration','health','me']`, `queryFn: GET /integration/health`. `enabled` = usuário é admin do tenant. Tratar 404 como estado "não configurado" (não como erro fatal): no `queryFn`, capturar 404 e retornar `{ configured: false }` em vez de lançar — ou usar `throwOnError` seletivo.
- `useTestConnection(slug)` → `useMutation` sobre `POST /admin/tenants/:slug/integration/test`.

### 5.3 API client (`lib/apiClient.ts`) — tratamento de status
- **401** → token expirado: disparar refresh; se falhar, logout/redirect a `/login`.
- **403** → sem permissão: não retentar; deixar a query refletir "acesso negado".
- **404** (tenant health) → mapear pra estado "não configurado", não pra toast de erro.
- **5xx** → retry com backoff (TanStack default) + banner.
- Erros do Nest vêm no envelope `{ statusCode, message, error }` — extrair `message` para exibição quando útil (no painel admin; nunca no card do tenant).

### 5.4 Formatação
- Tempo relativo pt-BR ("há 2 min", "há 1 h") com tooltip de data absoluta. Reaproveitar o helper de datas dos outros planos (`lib/format.ts`).

---

## 6. Acessibilidade & i18n
- Status **nunca só por cor**: pill com ícone + rótulo textual. `aria-live="polite"` na região de status pra leitor de tela anunciar mudança após refetch.
- Strings em pt-BR, centralizadas. Mensagens de "offline"/"não configurado" orientadas a ação ("fale com o suporte").

---

## 7. Testes (FE)
- **Componentes (RTL + MSW):** para cada tela, cobrir os estados — loading, `ok:true`, `ok:false` com `error` (frota) / sem `error` (tenant), 404 não-configurado, 403, vazio.
- **Contrato:** garantir que o card do tenant **não renderiza** `error`/host em nenhum estado (teste anti-vazamento, espelha o teste do backend).
- **Polling:** painel pausa refetch com aba oculta; não dispara `POST` no `GET`.

---

## 8. Fora de escopo / futuro
- **Configurar a conexão** (host/credenciais): é onboarding do system-admin (`PUT /admin/tenants/:slug/integration`), não entra nestas telas.
- **Mostrar conexões desabilitadas** no painel: a frota filtra `status:'active'`; se a operação quiser ver desabilitadas, precisa de um endpoint de listagem (não existe hoje). Sinalizar como follow-up se a operação pedir.
- **Histórico de uptime / gráfico:** `lastVerifiedAt` é pontual; série temporal exigiria persistência de histórico no backend (não existe). Follow-up se virar requisito.

---

## 9. Checklist de entrega
- [ ] Tipos do contrato (§5.1) + validação no boundary.
- [ ] `useFleetHealth`, `useTenantIntegrationHealth`, `useTestConnection`.
- [ ] Tratamento 401/403/404/5xx no apiClient.
- [ ] Tela A: cabeçalho-resumo + tabela (ordenada por `ok`) + "Testar agora" + estados.
- [ ] Tela B: card de status + 404 não-configurado + "Verificar agora" + gating por role.
- [ ] Acessibilidade (ícone+texto, aria-live) e strings pt-BR.
- [ ] Testes de estados + teste anti-vazamento no card do tenant.
