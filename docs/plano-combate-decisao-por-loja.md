# Plano backend — Combate + decisão por princípio ativo (POR LOJA)

**Repo:** `farmacore` (NestJS, tenant-api). **Para:** agente Claude no backend.
**Objetivo:** dar à tela frontend "Análise por princípio ativo" uma **decisão por (princípio ativo × loja)**, derivada dos dados, **filtrável server-side** e com **contadores**. Sem campo manual: a decisão é 100% computada de preço/custo/estoque vs concorrente → calcular na consulta (sempre fresca, sem migração).

> **Granularidade = por LOJA (filial).** Estoque é por `product_stock (ean, subsidiary_external_id)`. Como o "combate" exige estoque, o combate e a decisão **mudam por loja**. Toda a feature é escopada a uma loja selecionada.

---

## 1. Definições de domínio (sempre dentro de uma loja `subsidiary`)

Dentro de um **princípio ativo** (`product.active_ingredient`), para uma **loja** (`subsidiary_external_id`):

- **Combate (meu)** = variante do tenant com **menor `price`** **entre as que têm estoque > 0 NAQUELA LOJA** (`product_stock.quantity > 0` para `(ean, subsidiary)`). Se nenhuma tem estoque na loja → **sem combate**.
- **Menor custo do grupo** = variante do tenant com menor `cost` (do grupo; independe de estoque/preço).
- **Combate do concorrente** = entre os concorrentes (DROGAL/DROGASIL/PAGUE_MENOS/IKESAKI/MICHELASSI) dos EANs do grupo, o de **menor preço**. (Definição do Marco: "concorrente com menor preço".) Se nenhum concorrente tem preço → sem combate de concorrente (raro; ver §2).

## 2. Decisão por (princípio ativo × loja)

`decision ∈ { 'subir', 'abaixar', 'ok', 'mix', 'sem-estoque' }`.

Ordem de avaliação (**precedência**):
1. **`sem-estoque`**: nenhuma variante com estoque na loja → não há combate.
2. **`mix`**: o **combate não é a variante de menor custo** do grupo (`combate.cost > min(cost do grupo)`). Combatendo com produto que custa mais → dinheiro na mesa. **Tem precedência sobre subir/abaixar/ok** (arrumar o mix muda o preço do combate; resolve-se o mix primeiro).
3. comparação com o concorrente (só se há `competitorCombate`):
   - **`subir`**: `combate.price < competitorCombate.price * (1 - tol)`.
   - **`abaixar`**: `combate.price > competitorCombate.price * (1 + tol)`.
   - **`ok`**: dentro da tolerância.
4. **sem `competitorCombate`** (concorrente sem preço — "quase impossível"): **ignorar a comparação** → cai em `ok` (depois do check de `mix`).

### Tolerância `tol` — definida pelo USUÁRIO
Não é fixa nem do `variation-status`. É um **campo na tela** onde o usuário digita **até quantos % de diferença vs concorrente quer ignorar** (zona "ok"). Ex.: `tol = 2%` → diferenças de até ±2% contam como `ok`. Enviado como **query param `tolerance`** (percentual; default `0`) — assim a decisão recalcula ao vivo quando o usuário muda o valor.

## 3. Mudanças na API

### 3.1 Listar lojas (NOVO — a UI precisa de um seletor)
**`GET /products/subsidiaries`** →
```json
[{ "subsidiaryExternalId": "101", "label": "Loja Centro" }, ...]
```
Fonte: `DISTINCT subsidiary_external_id` de `product_stock` (+ label de `tenant_subsidiary` se existir; senão devolver o id como label).

### 3.2 `GET /products/active-ingredients/crossed` (estender)
Params: **`subsidiary` (obrigatório)**, **`tolerance`** (percent, default 0), + `page/perPage/activeIngredient`. Por grupo, acrescentar:
```jsonc
{
  "activeIngredient": "DIPIRONA SODICA",
  "decision": "subir",                                  // novo (loja + tolerância)
  "combate": { "ean": "...", "name": "...", "price": 8.49, "cost": 4.10 },  // ou null
  "lowestCost": { "ean": "...", "cost": 3.20 },
  "competitorCombate": { "origin": "DROGAL", "price": 7.99 },  // ou null
  "variants": [
    { "ean": "...", "name": "...", "price": ..., "cost": ..., "margin": ...,
      "drogalPrice": ..., "drogasilPrice": ...,
      "stockInSubsidiary": 12,   // novo — estoque NA loja escolhida
      "isCombate": true }        // novo
  ]
}
```

### 3.3 Filtro server-side
Param **`decision=subir|abaixar|ok|mix|sem-estoque`** (junto com `subsidiary`+`tolerance`) → só os grupos com aquela decisão (paginação sobre o filtrado).

### 3.4 Contadores (chips do filtro)
**`GET /products/active-ingredients/decision-counts?subsidiary=...&tolerance=...`** →
```json
{ "subir": 42, "abaixar": 17, "ok": 389, "mix": 9, "sem-estoque": 64, "total": 521 }
```
(Honrar `activeIngredient` se vier.)

## 4. Onde computar (recomendado: na consulta, sem persistir)

Derivável de `product` (price/cost/active_ingredient) + `product_stock` (estoque por loja) + `shared_catalog.product` (preço concorrente). CTE em `CatalogService.activeIngredientsCrossed`, por `active_ingredient`, parametrizado por `subsidiary` e `tolerance`:

1. variantes do grupo + `JOIN product_stock ps ON ps.ean = p.ean AND ps.subsidiary_external_id = :subsidiary`.
2. `combate` = `argmin(price) WHERE ps.quantity > 0`.
3. `lowestCost` = `argmin(cost)` do grupo.
4. `competitorCombate` = `argmin(price)` entre concorrentes do grupo.
5. derivar `decision` (§2), aplicando `tolerance`.
6. `WHERE decision = :decision` quando vier; `COUNT ... GROUP BY decision` pro endpoint de contadores.

Sem migração, sempre fresco. (Override/congelamento manual no futuro → aí cria coluna; não agora.)

## 5. Estoque
- **Tenant (por loja):** `product_stock (ean, subsidiary_external_id, quantity)`. "Com estoque na loja" = `quantity > 0`.
- **Concorrente:** sem estoque (não coletamos estoque de concorrente). Combate do concorrente = **menor preço**.

## 6. Decisões (RESOLVIDAS pelo Marco)
1. **Tolerância**: campo do usuário (% que ele quer ignorar vs concorrente) → query param `tolerance`, default 0.
2. **Precedência**: `mix` **antes** de subir/abaixar/ok (arrumar o mix muda o preço do combate).
3. **Combate do concorrente**: concorrente **com menor preço**.
4. **Sem preço de concorrente**: **ignorar** a comparação (cai em `ok` após o check de `mix`) — estado raro.
5. `sem-estoque` no lugar de "pendente"; granularidade por loja.

## 7. Critérios de aceite
- `GET /products/subsidiaries` lista as lojas.
- `active-ingredients/crossed?subsidiary=X&tolerance=T` retorna `decision`/`combate`/`lowestCost`/`competitorCombate` + `stockInSubsidiary`/`isCombate` por variante, **para a loja X e tolerância T**.
- `?decision=...` filtra; `decision-counts?subsidiary=X&tolerance=T` bate.
- Testes (por loja): sem estoque na loja → `sem-estoque`; combate≠menor custo → `mix` (mesmo se preço alinhado); combate < concorrente além da tol → `subir`; > → `abaixar`; dentro da tol → `ok`; trocar loja ou tolerância muda a decisão.
- Campos novos aditivos (sem regressão no shape atual).

---

**Contrato pro frontend:** seletor de **loja** (`GET /products/subsidiaries`) + **campo de tolerância (%)** no topo; a tela manda `subsidiary` e `tolerance` em tudo; por grupo consome `decision`/`combate`/`competitorCombate`/`lowestCost`; chips usam `decision-counts`. Campos antigos (`targetPrice`, `variants[]`) seguem.
