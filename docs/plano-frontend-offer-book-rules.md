# Frontend: conectar o preview de Offer Book Rules

PR do backend: [#30](https://github.com/cinegagliamarco/farmacore/pull/30) · Branch: `cinegagliamarco/migrate-offer-book-rules`
Collection: `postman/farmacore.postman_collection.json` → pasta **`Tenant — Offer Book Rules`**.

Plano para o FE plugar a tela de **simulação de regras de preço** no único endpoint que já existe nesta fase: `POST /offer-book-rules/preview`. Ele **calcula e devolve** o preço final por produto a partir de regras + travas de margem (+ arredondamento) — **não persiste nada**. É a tela de "ver antes de aplicar".

> O que ainda **não** existe (Fase 2/3, ver `docs/plano-offer-book-rules-migracao-2026-06-21.md`): salvar a regra, executar/aplicar preços, relatório de execução e export CSV. A tela do FE nesta fase é só o simulador (montar regras → ver o resultado).

## 1. Auth (igual ao resto da tenant-API)

```
POST /auth/login            → { accessToken, refreshToken }
POST /offer-book-rules/preview
Authorization: Bearer <accessToken>
```

O `JwtAuthGuard` é global; o tenant sai do JWT (sem mandar slug). O preview exige papel **OPERATOR** ou **ADMIN** (`@Roles`) — usuário `VIEWER` toma 403. Na collection, rode `POST /auth/login (tenant admin)` que o `accessToken` é salvo na variável e herdado pelas requests.

## 2. Contrato

### Request — `application/json`

```ts
type CalculationBaseType = 'SALE_PRICE' | 'OFFER_PRICE' | 'COMPETITIVE_PRICE';
type PriceBaseSource =
  | 'OWN_PRICE' | 'DROGAL' | 'DROGASIL' | 'PAGUE_MENOS' | 'IKESAKI' | 'MICHELASSI';
type PricingActionType = 'DISCOUNT' | 'INCREASE';

interface PricingRule {
  classifications?: string[];   // path(s) "A > B"; vazio = todas
  priceRangeMin?: number;
  priceRangeMax?: number;       // >= priceRangeMin
  marginRangeMin?: number;
  marginRangeMax?: number;      // >= marginRangeMin
  actionType: PricingActionType;
  percentageValue: number;      // 0–100
  active?: boolean;             // default true
}

interface PriceLock {
  classifications?: string[];   // vazio = todas (não coexiste com outros locks)
  minMargin: number;            // 0–99.99 (% mínimo de margem)
  active?: boolean;             // default true
}

interface PreviewRequest {
  calculationBaseType: CalculationBaseType;
  priceBaseSources?: PriceBaseSource[];   // OBRIGATÓRIO se COMPETITIVE_PRICE
  eans?: string[];                        // só dígitos; exclusivo com classifications
  classifications?: string[];             // exclusivo com eans
  pricingRules: PricingRule[];            // pode ser []
  priceLocks: PriceLock[];                // pode ser []
  applyPriceRounding?: boolean;           // default false
  page?: number;                          // default 1
  pageSize?: number;                      // default 1000, teto 1000
}
```

**Regra de ouro do request:** manda **`eans` OU `classifications`**, nunca os dois, nunca nenhum → senão `400`.

### Response — `200 OK`

```ts
interface PreviewRow {
  ean: string;
  name: string;
  externalId: string | null;
  classification: string;        // path normalizado a 2 níveis
  baseSalePrice: number;
  baseOfferPrice: number;
  currentPrice: number;          // o preço-base escolhido
  currentMargin: number;
  cost: number;
  actionType: PricingActionType | null;
  percentageValue: number;       // % nominal da regra
  appliedPercentageValue: number;// % efetivo aplicado (após lock/arredondamento)
  finalPrice: number;
  newMargin: number;
  priceLockApplied: boolean;
  discountSkipped: boolean;
  skippedNoCompetitorPrice: boolean;   // COMPETITIVE sem preço de concorrente
  skippedPriceExceedsLimit: boolean;   // aumento passaria do preço de venda
  priceRoundingApplied: boolean;
}

interface PreviewResponse {
  rows: PreviewRow[];
  total: number;        // total que casou (antes da paginação)
  page: number;
  pageSize: number;
  totalPages: number;
}
```

## 3. De onde o FE tira cada campo do formulário

| Campo | Origem no FE |
|---|---|
| `calculationBaseType` | select fixo (3 opções acima) |
| `priceBaseSources` | multi-select fixo (6 opções); **só aparece quando** base = `COMPETITIVE_PRICE` |
| `actionType` | toggle Desconto/Acréscimo (`DISCOUNT`/`INCREASE`) |
| `eans` | seleção de linhas na tabela de produtos — reusa `GET /products` (catálogo) |
| `classifications` | árvore de `GET /classifications/grouped`; manda o **path** ("A > B"). O match de regras/locks normaliza pra 2 níveis. |
| `priceRoundingRules` (efeito de `applyPriceRounding`) | já configurado em `GET /configurations/price-rounding`; a tela só liga o toggle |

## 4. Fluxo da tela

1. Operador escolhe o **alvo**: ou marca produtos (vira `eans`) ou escolhe classificações (vira `classifications`).
2. Escolhe a **base de cálculo**. Se `COMPETITIVE_PRICE`, mostra o multi-select de `priceBaseSources` (obrigatório ≥1).
3. Monta N **regras** (faixa de preço/margem + desconto/acréscimo) e M **travas de margem**.
4. (opcional) liga **arredondar preço final**.
5. `POST /offer-book-rules/preview` → renderiza a tabela com `rows`, paginando por `total`/`totalPages`.
6. Cada linha mostra `currentPrice → finalPrice`, `currentMargin → newMargin`, e **badges** das flags (ver abaixo).

## 5. Como exibir as flags (cada linha)

| Flag | Significado / badge |
|---|---|
| `priceLockApplied` | "Margem travada" — o preço subiu pra respeitar o `minMargin`. |
| `priceRoundingApplied` | "Arredondado" — o final passou pela regra de arredondamento. |
| `skippedNoCompetitorPrice` | "Sem preço concorrente" — `COMPETITIVE` sem fonte; linha fica no estado atual. |
| `skippedPriceExceedsLimit` | "Acima do preço de venda" — o acréscimo passaria do preço de venda; não aplicado. |

`appliedPercentageValue` ≠ `percentageValue` quando o lock/arredondamento mexeu no preço — mostre o **aplicado** como o número "de verdade".

## 6. Erros a tratar

| Código | Quando | Mensagem no FE |
|---|---|---|
| `400` | `eans` + `classifications` juntos (ou nenhum) | "Escolha produtos OU classificações." |
| `400` | `COMPETITIVE_PRICE` sem `priceBaseSources` | "Selecione ao menos uma fonte de preço." |
| `400` | `percentageValue` fora de 0–100 / `minMargin` fora de 0–99.99 / EAN não-numérico / regras-locks sobrepostos | a `message` do erro já é descritiva — exiba inline. |
| `403` | usuário `VIEWER` | esconda o botão "Simular" para `VIEWER`. |

> Sobreposição: o backend rejeita duas **regras** (ou dois **locks**) que possam mirar o mesmo produto (mesma classificação + faixas que se cruzam). Idealmente o FE valida no cliente antes de mandar, mas o `400` é a rede de segurança.

## 7. Exemplo (cURL)

```bash
curl -sX POST "$BASE/offer-book-rules/preview" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "calculationBaseType": "COMPETITIVE_PRICE",
    "priceBaseSources": ["OWN_PRICE","DROGAL","DROGASIL"],
    "classifications": ["GENERICO"],
    "pricingRules": [{ "actionType": "DISCOUNT", "percentageValue": 5 }],
    "priceLocks": [{ "minMargin": 20 }],
    "applyPriceRounding": true,
    "page": 1, "pageSize": 50
  }'
```

## 8. Checklist do FE

- [ ] Tela de simulação (alvo → base → regras → locks → arredondar → Simular).
- [ ] Multi-select de `priceBaseSources` condicional ao `COMPETITIVE_PRICE`.
- [ ] Tabela de resultado com `currentPrice→finalPrice`, `currentMargin→newMargin` e badges das flags.
- [ ] Paginação por `total`/`totalPages`.
- [ ] Validação cliente de exclusividade (eans XOR classifications) e dos ranges; tratar os `400`/`403`.
- [ ] Esconder a ação para papel `VIEWER`.
