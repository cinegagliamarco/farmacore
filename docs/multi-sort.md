# Multi-sort em endpoints com `?sortBy` / `?sortDirection`

PR: [#27](https://github.com/cinegagliamarco/farmacore/pull/27) · Branch: `cinegagliamarco/apply-multisort-endpoints`

Todos os endpoints que aceitam ordenação por query agora aceitam **lista de chaves** casadas por posição com a direção. Backward compat: o jeito antigo (uma chave só) continua funcionando, sem mudança no FE.

## Contrato

```
GET /products?sortBy=status,margin&sortDirection=desc,asc
```

- `sortBy` — lista de colunas separadas por vírgula. Ordem importa (primeira chave é `ORDER BY` principal, demais entram como `addOrderBy`).
- `sortDirection` — lista de `asc` ou `desc` (case-insensitive), casada por posição com `sortBy`.

Equivalente a:

```sql
ORDER BY status DESC, margin ASC
```

### Variantes aceitas (parsing)

| Forma | Resultado |
|---|---|
| `?sortBy=status,margin` | `['status', 'margin']` |
| `?sortBy=status&sortBy=margin` | `['status', 'margin']` (query string com chave repetida) |
| `?sortBy=status,margin&sortBy=cost` | `['status', 'margin', 'cost']` (mistura dos dois) |
| `?sortBy=status` (single, antigo) | `['status']` ✅ continua funcionando |
| `?sortDirection=DESC,asc,Asc` | `['DESC', 'ASC', 'ASC']` (case-insensitive, uppercased) |
| omitido | sem `ORDER BY` (cai no default do endpoint) |

### Regras de pareamento

| Cenário | Comportamento |
|---|---|
| `sortBy=a,b` + `sortDirection=desc,asc` | `a DESC, b ASC` ✅ casamento perfeito |
| `sortBy=a,b,c` + `sortDirection=desc` | `a DESC, b ASC, c ASC` — direções faltantes caem para `ASC` |
| `sortBy=a` + `sortDirection=` (vazio) | `a ASC` — default |
| `sortBy=` (vazio) + `sortDirection=desc` | fallback do endpoint (sem `ORDER BY` aplicado pelo sort) |

## Erros

Validação acontece no DTO via `class-validator` antes de chegar no service.

### 400 — coluna inválida

```bash
curl -i 'http://localhost:3000/products?sortBy=hacker_col'
```

```json
{
  "statusCode": 400,
  "message": [
    "each sortBy value must be one of: ean, name, supplier, classification, cost, price, margin, averageVariation, status, targetPrice, receiptDate"
  ],
  "error": "Bad Request"
}
```

### 400 — direção inválida

```bash
curl -i 'http://localhost:3000/products?sortBy=ean&sortDirection=foo'
```

```json
{
  "statusCode": 400,
  "message": ["each sortDirection value must be one of: ASC, DESC"],
  "error": "Bad Request"
}
```

**Mudança de comportamento que vale comunicar:** antes, `?sortDirection=foo` era silenciosamente coagido a `ASC` (200 OK). Agora retorna 400. Clientes que mandavam só `asc`/`desc` (independente do case) não veem diferença.

## Colunas disponíveis por endpoint

### tenant-api — todos compartilham o mesmo whitelist (`ListProductsQueryDto`)

`GET /products`, `/products/crossed`, `/products/strategic-price`, `/products/stock`:

| `sortBy` | Coluna SQL |
|---|---|
| `ean` | `p.ean` |
| `name` | `p.name` |
| `supplier` | `p.supplier` |
| `classification` | `c.name` |
| `cost` | `p.cost` |
| `price` | `p.price` |
| `margin` | `p.margin` |
| `averageVariation` | `p.average_variation` |
| `status` | `p.status` |
| `targetPrice` | `ob.target_price` |
| `receiptDate` | `p.receipt_date` |

**Default quando sortBy é omitido:** `p.ean ASC`.

> Os outros endpoints que aceitam `ListProductsQueryDto` (`/products/stock-metrics`, `/products/active-ingredients/crossed`, `/products/active-ingredients/decision-counts`, `/products/generic-missing-active-ingredients`, `/products/export`) **ignoram** sort. Mesmo comportamento de antes — eles fazem agregação/agrupamento e o sort não se aplica.

## Como o FE aplica

### Caso simples (single sort) — nenhuma mudança

Continua igual. Só não passe array onde antes era string:

```ts
// ✅ continua funcionando
const params = new URLSearchParams({ sortBy: 'status', sortDirection: 'desc' });
fetch(`/products?${params}`);
```

### Caso novo (multi-sort)

Duas formas, escolha o que casar melhor com o teu state de tabela:

**Forma 1 — CSV (recomendada, mais compacta na URL):**

```ts
const sortBy = ['status', 'margin'].join(',');         // 'status,margin'
const sortDirection = ['desc', 'asc'].join(',');       // 'desc,asc'
const params = new URLSearchParams({ sortBy, sortDirection });
fetch(`/products?${params}`);
// → /products?sortBy=status%2Cmargin&sortDirection=desc%2Casc
```

**Forma 2 — chaves repetidas (algumas libs HTTP fazem isso automático):**

```ts
const params = new URLSearchParams();
['status', 'margin'].forEach((c) => params.append('sortBy', c));
['desc', 'asc'].forEach((d) => params.append('sortDirection', d));
fetch(`/products?${params}`);
// → /products?sortBy=status&sortBy=margin&sortDirection=desc&sortDirection=asc
```

Ambas chegam no backend como `['status', 'margin']` / `['desc', 'asc']`. Mistura também funciona (`?sortBy=status,margin&sortBy=cost` → `['status', 'margin', 'cost']`).

### Sugestão de UX (tabela com sort multi-coluna)

Padrão comum: shift+clique numa coluna adiciona ao sort em vez de substituir.

```ts
type SortKey = { column: string; direction: 'asc' | 'desc' };

function buildSortParams(sorts: SortKey[]) {
  if (sorts.length === 0) return {};
  return {
    sortBy: sorts.map((s) => s.column).join(','),
    sortDirection: sorts.map((s) => s.direction).join(','),
  };
}

// click normal: substitui
function onColumnClick(column: string, current: SortKey[]): SortKey[] {
  const existing = current.find((s) => s.column === column);
  const direction = existing?.direction === 'asc' ? 'desc' : 'asc';
  return [{ column, direction }];
}

// shift+click: adiciona/togglea sem mexer nos outros
function onColumnShiftClick(column: string, current: SortKey[]): SortKey[] {
  const idx = current.findIndex((s) => s.column === column);
  if (idx === -1) return [...current, { column, direction: 'asc' }];
  const next = [...current];
  if (next[idx].direction === 'asc') next[idx] = { ...next[idx], direction: 'desc' };
  else next.splice(idx, 1);  // segundo shift+click remove
  return next;
}
```

## Smoke test (cURL)

```bash
TT="<jwt-do-tenant>"
BASE="http://localhost:3000"

# 1. Multi-sort
curl -sS "$BASE/products?sortBy=status,margin&sortDirection=desc,asc" \
  -H "Authorization: Bearer $TT" | jq '.rows | .[0:3]'

# 2. Single-sort (compat)
curl -sS "$BASE/products?sortBy=ean&sortDirection=desc" \
  -H "Authorization: Bearer $TT" | jq '.rows | .[0:3]'

# 3. Direção case-insensitive
curl -sS "$BASE/products?sortBy=margin&sortDirection=DeSc" \
  -H "Authorization: Bearer $TT" | jq '.rows | .[0:3]'

# 4. Coluna inválida → 400
curl -i "$BASE/products?sortBy=hacker_col" \
  -H "Authorization: Bearer $TT"

# 5. Direção inválida → 400
curl -i "$BASE/products?sortDirection=foo" \
  -H "Authorization: Bearer $TT"
```

## Arquivos

- `src/common/multi-sort.ts` — helper compartilhado (`parseSortList`, `parseSortDirectionList`, `applyMultiSort`, `buildMultiSortClause`).
- `src/common/multi-sort.spec.ts` — 17 testes cobrindo parsing, whitelist, fallbacks, mismatch de tamanho.
- `src/tenant-api/catalog/dto/list-products.query.ts` — DTO compartilhado; exporta `SORTABLE_COLUMNS as const` + tipo `SortableColumn`.
- `src/tenant-api/catalog/catalog.service.ts:617-624` — `orderBy()` agora delega ao helper; `SORTABLE` tipado como `Record<SortableColumn, string>` para forçar sincronia com o DTO em compile-time.
