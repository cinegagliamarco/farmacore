# Plano frontend — Filtros de princípio ativo (subir / abaixar / ajuste de mix)

**Repo:** frontend React (pricy-shelf / app do tenant). **Para:** agente Claude no frontend.
**Objetivo:** dar à tela **"Análise por princípio ativo"** a capacidade de **filtrar e agir
por decisão** (`subir`, `abaixar`, `mix`, `ok`, `sem-estoque`) **por loja**, consumindo o
contrato que o backend já entregou (PR `combate-decisao-por-loja`).

> Par deste doc: [`plano-combate-decisao-por-loja.md`](./plano-combate-decisao-por-loja.md)
> (lado backend, já mergeado). Aqui é só o consumo: **nenhuma decisão é calculada no FE** —
> tudo vem pronto do servidor, recalculado ao vivo quando muda `subsidiary` ou `tolerance`.

---

## 1. O que o backend já entrega (contrato — não muda)

Tudo autenticado com `Authorization: Bearer <token>` (login em `POST /auth/login`); o tenant
sai do próprio token (sem header de tenant). Leituras abertas a qualquer usuário do tenant;
**mutações exigem papel `OPERATOR`/`ADMIN`**.

| Método | Rota | Uso na tela |
|---|---|---|
| GET | `/products/subsidiaries` | seletor de loja |
| GET | `/products/active-ingredients` | autocomplete do campo de princípio ativo |
| GET | `/products/active-ingredients/crossed` | lista de grupos (paginada) |
| GET | `/products/active-ingredients/decision-counts` | contadores dos chips |
| POST | `/products/:ean/price` | aplicar **subir/abaixar** (repreça e empurra pro ERP) |
| POST/DELETE | `/products/:ean/offer` | aplicar via **oferta** (caderno), opcional |

**`GET /products/subsidiaries`** → `[{ "subsidiaryExternalId": "101", "label": "Loja Centro" }, ...]`

**`GET /products/active-ingredients`** → `{ "activeIngredients": ["DIPIRONA SODICA", ...] }`

**`GET /products/active-ingredients/crossed`** — query params:

- `subsidiary` **(obrigatório)** — id externo da loja, numérico (1–18 dígitos). Sem ele → 400.
- `tolerance` — % (0–100, default `0`) que o usuário aceita ignorar vs concorrente (a zona `ok`).
- `decision` — `subir|abaixar|ok|mix|sem-estoque` (filtra os grupos server-side; opcional).
- `activeIngredient` — texto, faz `ILIKE %x%` (filtra os grupos).
- `page` (≥1), `perPage` (1–200, default 50).

Resposta `Paginated<IngredientGroup>`:
```jsonc
{
  "rows": [{
    "activeIngredient": "DIPIRONA SODICA",
    "decision": "subir",                                  // já calculado (loja + tolerância)
    "targetPrice": 8.49,                                  // menor preço > 0 do grupo (legado)
    "combate": { "ean": "789...", "name": "...", "price": 8.49, "cost": 4.10 }, // ou null
    "lowestCost": { "ean": "789...", "cost": 3.20 },                            // ou null
    "competitorCombate": { "origin": "DROGAL", "price": 7.99 },                 // ou null
    "variants": [{
      "ean": "789...", "name": "...", "price": 8.49, "cost": 4.10, "margin": 0.51,
      "drogalPrice": 7.99, "drogasilPrice": 8.20,
      "stockInSubsidiary": 12,    // estoque NA loja escolhida
      "isCombate": true           // esta variante é o combate do grupo
    }]
  }],
  "count": 521, "page": 1, "perPage": 50
}
```
Preços/custos vêm como `number | null`. **`price` ou `cost` ausentes = não carregados do ERP**
(o backend trata `price <= 0` como "não carregado": nunca vira combate). Renderizar como `—`.

**`GET /products/active-ingredients/decision-counts`** — params `subsidiary` (obrigatório),
`tolerance`, `activeIngredient` (mesmos do crossed; **sem** `decision`/`page`). →
```json
{ "subir": 42, "abaixar": 17, "ok": 389, "mix": 9, "sem-estoque": 64, "total": 521 }
```

## 2. Semântica das decisões (o FE só rotula/explica; não recalcula)

Dentro de um princípio ativo, **na loja escolhida**:
- **combate** = variante do tenant **com menor preço entre as que têm estoque > 0 na loja**.
- **lowestCost** = variante de menor custo do grupo (independe de preço/estoque).
- **competitorCombate** = concorrente de **menor preço** (DROGAL/DROGASIL/PAGUE_MENOS/IKESAKI/MICHELASSI).

Precedência (igual ao servidor — útil pros textos/tooltips):
1. **`sem-estoque`** — nenhuma variante com estoque na loja → não há combate. Não dá pra agir no preço.
2. **`mix`** ("ajuste de mix") — o combate **não é** a variante de menor custo (`combate.cost > lowestCost.cost`).
   Você está combatendo com um produto que custa mais → dinheiro na mesa. **Tem precedência** sobre subir/abaixar/ok.
3. **`subir`** — `combate.price < competitorCombate.price × (1 − tol)` → está barato demais, dá pra subir.
4. **`abaixar`** — `combate.price > competitorCombate.price × (1 + tol)` → está caro demais, precisa abaixar.
5. **`ok`** — dentro da tolerância, ou sem concorrente (comparação ignorada).

## 3. Estado da tela (fonte única → URL)

Três controles globais no topo guiam **as três** chamadas. Guardar na **URL (query string)** pra
ser compartilhável e sobreviver a refresh; persistir a última loja escolhida (localStorage):

- `subsidiary` — **bloqueia a tela enquanto não escolhida** (todas as rotas exigem). Default = última usada.
- `tolerance` — campo `%` (0–100). Debounce ~300ms; ao mudar, **refaz crossed + decision-counts** (decisão recalcula).
- `decision` — chip ativo (ou nenhum = todos).
- `activeIngredient` — busca (autocomplete via `/products/active-ingredients`).
- `page` — reseta pra 1 ao mudar qualquer filtro acima.

Mudou `subsidiary`/`tolerance`/`activeIngredient` → refaz **crossed** (com `decision` atual) **e**
**decision-counts**. Mudou só `decision` ou `page` → refaz **só crossed** (counts não dependem deles).

## 4. Chips de decisão (filtro principal)

Linha de chips a partir de `decision-counts`, na ordem de ação: **`subir` · `abaixar` · `mix` · `ok` · `sem-estoque`**,
mais um **"Todos"** (`total`). Cada chip mostra o rótulo + a contagem; clicar seta `decision=` (toggle).
Cores sugeridas: subir = verde (oportunidade de subir preço/margem), abaixar = âmbar/vermelho
(precisa baixar pra competir), mix = roxo (arrumar curva), ok = neutro, sem-estoque = cinza.
Os três que o usuário pediu — **subir, abaixar, ajuste de mix** — são os acionáveis; destacá-los.

## 5. Render de cada grupo

Card/linha por `IngredientGroup`:
- **Cabeçalho**: `activeIngredient` + badge da `decision` (com tooltip explicando, §2).
- **Combate** (`combate`): nome + EAN + `price` + `cost`/`margin`. Se `null` (sem-estoque) → "Sem combate nesta loja".
- **vs Concorrente** (`competitorCombate`): `origin` + `price`, e o **delta** vs `combate.price`
  (ex.: "+6,3% acima do DROGAL"). Se `null` → "Nenhum concorrente".
- **Menor custo** (`lowestCost`): EAN + `cost`. Em `mix`, destacar que **o combate ≠ menor custo**
  (mostrar `combate.cost` vs `lowestCost.cost` e a diferença — o "dinheiro na mesa").
- **Variantes** (`variants`, expandível): tabela EAN · nome · preço · custo · margem ·
  `drogalPrice`/`drogasilPrice` · **estoque na loja** (`stockInSubsidiary`) · marcar a linha `isCombate`.

## 6. Aplicar a ação (write-back) — opcional no v1, mas é o "agir" do pedido

Depois de filtrar, o operador aplica a correção. **Gate por papel**: só `OPERATOR`/`ADMIN`
(do JWT / `/auth/me`) veem o botão **Aplicar**; demais ficam read-only.

- **subir / abaixar** → repreçar **o combate** em direção ao concorrente. Pré-preencher o input com
  o alvo na borda da tolerância (`competitorCombate.price × (1 ∓ tol)`), deixar o operador editar, e
  `POST /products/:ean/price` com `{ "newPrice": <valor> }` no `combate.ean` (empurra pro ERP).
  Alternativa via oferta/caderno: `POST /products/:ean/offer { targetPrice, cadernoId }`.
- **ajuste de mix** → a ação é **passar a combater com a variante de menor custo** (`lowestCost.ean`):
  repreçar essa variante pra ≤ preço do combate atual (vira o novo combate) via `POST /products/:ean/price`.
  ⚠️ **Não há endpoint dedicado de "trocar combate"** — é repreço de variante. Confirmar com o Marco a
  mecânica exata do "ajuste de mix" (só sinalizar vs. repreçar a de menor custo vs. tirar a cara do mix).
- **sem-estoque / ok** → sem ação de preço (em `sem-estoque` não há combate pra repreçar).

**`POST /products/:ean/price` falha com `409` (não é só `403` de papel)** — três casos que o FE
**tem que tratar** como erro não-recuperável, com mensagem clara (não um toast genérico):
produto **`monitored`** ("preço travado"), produto **sem `externalId` de ERP**, ou **tenant sem
API A7Pharma configurada** (esse último mata o "agir" do tenant inteiro). `POST /products/:ean/offer`
também dá `409` por falta de ERP id / API. O contrato de `combate`/`variants` **não traz a flag
`monitored`**, então não dá pra desabilitar o botão antes — só reagir ao 409 (ou pedir o campo no contrato).

Após aplicar com sucesso → invalidar/refetch **crossed + decision-counts** (a decisão e os chips mudam).

## 7. Regras de borda

- **Loja obrigatória**: nada de crossed/counts sem `subsidiary`. Estado vazio guiando "escolha uma loja".
- **`tolerance`**: clamp 0–100; valor inválido não dispara request. Lembrar que `tol` é %, não fração.
- **`price`/`cost` nulos ou `price ≤ 0`**: "não carregado" → `—`; nunca tratar como combate/concorrente.
- **`competitorCombate: null`**: comparação ignorada (cai em `ok` após o check de `mix`) — texto claro, sem delta.
- **`perPage` ≤ 200**; paginar sobre `count` (total já filtrado por `decision`). `total` dos chips ≠ `count` do crossed filtrado.
- **Erros da mutação**: `403` = papel insuficiente (esconder/desabilitar Aplicar, não depender só do erro);
  `409` = `monitored`/sem ERP id/sem API A7Pharma (mensagem específica, sem retry — ver §6); `404` = EAN sumiu.
- **EAN numérico**: as rotas `:ean` validam `^\d+$`; o `ean` vem string da API — passar como veio.

## 8. Estados de tela

Loading (skeleton dos chips + lista), erro (com retry; 400 = loja faltando/ inválida), vazio
("nenhum grupo nesta decisão/loja"). Debounce em `tolerance` e na busca pra não enxurrar de requests.

## 9. Critérios de aceite

- Seletor de loja popula de `/products/subsidiaries`; trocar a loja refaz tudo e muda decisões/contagens.
- Campo de tolerância (%) refaz crossed + counts; mudar `tol` move grupos entre `subir`/`ok`/`abaixar` ao vivo.
- Chips batem com `decision-counts`; clicar um chip filtra a lista server-side (`?decision=`).
- Cada grupo mostra `decision`, `combate`, `competitorCombate` (+ delta), `lowestCost`, e variantes com
  `stockInSubsidiary`/`isCombate`.
- Busca por princípio ativo filtra grupos e contadores juntos.
- (Se a §6 entrar no v1) Aplicar subir/abaixar chama `POST /products/:ean/price` no combate, gateado por papel,
  refaz crossed + counts ao concluir, e mostra mensagem específica em `409` (monitored/sem ERP/sem API A7Pharma).
- Sem cálculo de decisão no cliente — só consumo do que o servidor manda.

---

**Contrato consumido (resumo):** seletor de **loja** + campo **tolerância (%)** no topo guiam
`crossed`, `decision-counts` e (na ação) as mutações; **chips** = `decision-counts`; **filtro** =
`?decision=`; cada grupo lê `decision`/`combate`/`competitorCombate`/`lowestCost`/`variants`. A
decisão é 100% do servidor — o FE só rotula, filtra e (opcional) aplica via `POST /products/:ean/price`.
</content>
</invoke>
