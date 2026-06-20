# `GET /offer-campaigns` — cadernos de oferta vigentes do tenant

PR: [#25](https://github.com/cinegagliamarco/farmacore/pull/25) · Branch: `cinegagliamarco/endpoint-cadernos-por-loja`

Lista todos os cadernos de oferta **ativos, já iniciados e não vencidos** do tenant autenticado. Pensado para alimentar o seletor de cadernos no fluxo de oferta do FE: o `id` retornado é o mesmo valor que volta como `cadernoId` em `POST /products/:ean/offer`.

## Contrato

```
GET /offer-campaigns
Authorization: Bearer <jwt-do-tenant>
```

**Auth.** Herda o `JwtAuthGuard` global. Sem `@Roles` (consistente com as outras leituras da tenant-API: `classifications`, `settings`, `configurations/price-rounding`). Qualquer usuário autenticado do tenant lê. Se quiserem restringir a `OPERATOR/ADMIN`, é uma linha (`@Roles(UserRole.OPERATOR, UserRole.ADMIN)`).

**Tenant scoping.** Automático via `SearchPathInterceptor` — o `EntityManager` da request resolve `tenant_offer_campaign` no schema do tenant do JWT. Sem cross-tenant leak.

## Response

`200 OK` — `application/json`

```json
[
  { "id": 12, "name": "ETIQUETAS PRICY - LOJA 3" },
  { "id": 47, "name": "KIT PERFUMARIA" },
  { "id": 103, "name": "OFERTAS DA SEMANA" }
]
```

| Campo | Tipo | Origem |
|---|---|---|
| `id` | `number` | `tenant_offer_campaign.external_id` — é o `idCadernoOferta` da A7Pharma. |
| `name` | `string` | `tenant_offer_campaign.name` — é o `nome` do caderno no ERP. |

Ordenação: `name ASC`, depois `external_id ASC` (desempate determinístico quando nomes colidem).

## Filtros aplicados

Só entram cadernos que satisfazem **todos**:

```sql
active = true
AND deleted_at IS NULL
AND (start_date IS NULL OR start_date <= now())
AND (expiration_date IS NULL OR expiration_date >= now())
```

**Por quê cada filtro:**

| Filtro | Motivo |
|---|---|
| `active = true` | `cadernooferta.status = 'A'` no ERP. Cadernos inativos não devem aparecer no seletor. |
| `deleted_at IS NULL` | Defensivo. Hoje nada faz soft-delete em campaign, mas o repo já anota que cleanup é follow-up e `createQueryBuilder` (diferente de `find()`) não aplica esse filtro automaticamente. |
| `start_date <= now` | Cadernos futuros existem no banco (sync persiste `datahorainicial` exatamente pra isso). Sem esse filtro, o operador pegaria caderno não-iniciado e o A7Pharma rejeitaria/aplicaria fora da janela. |
| `expiration_date >= now` | Idem para vencimento. |

Cadernos com `start_date` ou `expiration_date` nulos passam — interpretação: "sem janela = sempre vigente".

## Como o FE consome

O fluxo completo de oferta usa dois endpoints:

```bash
TT="<jwt-do-tenant>"

# 1. Listar cadernos disponíveis
curl -sS http://localhost:3000/offer-campaigns \
  -H "Authorization: Bearer $TT" | jq
# → [{ "id": 47, "name": "KIT PERFUMARIA" }, ...]

# 2. Aplicar oferta usando o id escolhido
curl -sS -X POST http://localhost:3000/products/7891234567890/offer \
  -H "Authorization: Bearer $TT" \
  -H 'Content-Type: application/json' \
  -d '{ "targetPrice": 9.90, "cadernoId": 47 }'
# → { "ean": "7891234567890", "targetPrice": 9.90, "cadernoId": 47 }
```

O `id` do caderno é o **mesmo number** dos dois lados — sem normalização extra no FE. O `cadernoId` do `UpsertOfferDto` valida com `@IsNumber()`.

## Erros

Como qualquer rota da tenant-API:

- `401 Unauthorized` — JWT faltando, expirado ou inválido (`JwtAuthGuard`).
- `200 OK` com array vazio — sem caderno vigente. Não retorna 404.

Nenhum 4xx específico desse endpoint.

## Limitações conhecidas (e por que cada uma está OK)

| Item | Status | Comentário |
|---|---|---|
| Sem paginação / `LIMIT` | OK | Volume típico: ~100 cadernos por tenant (registro do sync). Se um tenant chegar perto disso, adicionar `.take(500)` é uma linha. |
| `id: number` (não `string`) para `bigint` | OK | A7Pharma `idCadernoOferta` é autoincrement do ERP (milhares). O contrato FE↔BE inteiro já é `cadernoId: number` (`UpsertOfferDto`). Mudar só esse endpoint pra `string` quebra o contrato em 3 lugares. Se algum dia o ERP emitir `id > 2^53`, dá pra trocar tudo de uma vez. |
| Sem dimensão de loja | OK | **Caderno de oferta na A7Pharma é do tenant inteiro.** Não existe coluna/tabela `filial` ligando caderno a loja — verifiquei o seed do ERP (`docker/erp-seed/a7pharma-sample.sql`): zero hits em `filial`, e a tabela `cadernooferta` não tem FK pra `filial`. A única pista de loja às vezes aparece como texto livre no `nome` (ex.: `"KIT PERFUMARIA LOJA 1"`). Filtrar por loja não é possível com os dados atuais. |
| Sem cache | OK | Query usa o índice `IX_TENANT_OFFER_CAMPAIGN_ACTIVE_EXPIRATION` (`[active, expiration_date]`). Resposta esperada < 5ms. |
| `expirationDate >= now` vs `>` | OK por consistência | Outras queries do projeto usam `>=` contra a mesma coluna raw (`item-caderno-oferta.repository.ts:62`). Manter o mesmo operador. Se um dia descobrirmos que A7 grava `datahorafinal` como 00:00 do último dia (em vez de 23:59), trocar em todo lugar de uma vez. |

## Arquivos

- `src/tenant-api/offer-campaigns/offer-campaigns.controller.ts` — controller (`@Get`).
- `src/tenant-api/offer-campaigns/offer-campaigns.service.ts` — query.
- `src/tenant-api/tenant-api.module.ts` — registro (controller + service).

Entidade já existia: `src/database/entities/tenant/tenant-offer-campaign.entity.ts`. População já existia: `src/pipeline/steps/sync-offer-books-info.step.ts` (upsert por `external_id`).

## Verificação

- `npm test` — 29 suites, 144 testes ✅
- `npm run build` — limpo ✅
- `npm run lint` — limpo ✅
- `/review` adversarial (3 passadas: workflow 9-agentes + Claude subagent + Codex gpt-5.5) → sem bugs.
- `/code-review xhigh` (70 agentes) → pegou um bug que as 3 passadas anteriores deixaram passar (filtro `start_date` faltando). Corrigido neste PR.
