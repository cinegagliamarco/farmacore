# Offer Book Rules — migração do legado → farmacore (2026-06-21)

**Repo:** farmacore. **Objetivo:** trazer a **rotina** de cálculo de preços do
`legacy-app/src/services/offer-book-rules.service.ts` (e o código relacionado de
offer-book-rules) para o `src/` novo, **refatorada nas convenções do app atual**
(NestJS 11 multi-tenant, schema-per-tenant, TypeORM, `EntityManager` por request).

> Princípio (CLAUDE.md): **simplicidade dura**. Zero abstração prematura, validar só
> em fronteiras, zero dead code. O motor de cálculo é portado fielmente (mesma
> matemática), mas o acesso a dados é reescrito no padrão novo.

## 1. Context

O legado (`legacy-app/`) é um NestJS single-tenant, estrutura plana
(`controllers/` → `use-cases/` → `services/` + `database/{entities,repositories}`),
PK numérica. O `offer-book-rules` é um **motor de precificação**: dado um conjunto de
produtos + regras (descontos/acréscimos por classificação/faixa) + travas de margem
(`price locks`) + arredondamento, calcula o preço final de cada produto (preview) e,
numa fase posterior, executa/persiste o resultado com relatório de auditoria.

O farmacore novo (`src/`) é **multi-tenant por schema**: cada request roda com
`search_path` setado para o schema do tenant (+ `shared_catalog` + `public`) pelo
`SearchPathInterceptor`; o `EntityManager` tenant-scoped é injetado nos handlers via
`@TenantEm()`. As features ficam em módulos co-locados sob `src/tenant-api/`
(ex.: `catalog/`, `config/`, `offer-campaigns/`).

**Estado encontrado no `src/` novo (gap):** já existem *stubs* de entidade
(`src/database/entities/tenant/offer-book-rule*.entity.ts`) com schema **simplificado e
divergente** do legado (ex.: pricing rule = `expression`/`priority`; price lock =
`lockedPrice`/`lockedUntil`). **Não existe** service, controller, DTO, repositório,
enums de cálculo nem a lógica do motor. Logo, esta migração **cria** o módulo do zero
no padrão novo, e **não** reaproveita os stubs (que serão realinhados na Fase 2).

## 2. Alvo: convenções do farmacore que o módulo segue

- **Service recebe `em: EntityManager` por método** (não injeta no construtor). Acesso a
  dados via `em.getRepository(Entity).createQueryBuilder(...)` ou `em.query(...)` (SQL cru),
  como em `tenant-api/catalog/catalog.service.ts` e `config/price-rounding.service.ts`.
- **`resolveTenantId(em, slug)`** (`src/tenant/tenant-lookup.ts`) para tocar tabelas `core.*`
  por `tenant_id` (ex.: arredondamento mora em `core.price_rounding_range/_rule`).
- **Controller** `@Controller('offer-book-rules')`, `@TenantEm() em`, `@CurrentUser() user`,
  `@Roles(...)`. DTOs com `class-validator`/`class-transformer` (validação só na borda).
- **Exceptions** padrão NestJS (`BadRequestException`, `NotFoundException`).
- **Testes** unitários `*.spec.ts` (jest) instanciando o service direto (`new Service()`) e
  **mockando `em.query`** por fragmento de SQL — padrão de `price-rounding.service.spec.ts`.

## 3. Mapeamento de dados (legado → novo)

| Conceito (legado) | Origem nova | Observação |
|---|---|---|
| `BaseProduct.{price,cost,margin,name,externalId,ean}` | `product` (tenant) | preço/custo/margem moram no **product do tenant**, não no `shared_catalog.base_product` |
| `BaseProduct.classificationEntity.name` (path `"A > B > C"`) | `classification` (árvore `name`+`parent_id`) | o nome novo é só a **folha**; o path é reconstruído via **CTE recursiva** |
| `offerBooks[0].priceForOffer` (preço de oferta) | `offer_book.target_price` (join por `ean`) | base de cálculo `OFFER_PRICE` |
| preços de concorrentes por `Origin` | `shared_catalog.product` (`ean`,`origin`,`price`) | escrito pelo pipeline de scraping; `origin` ∈ `CompetitorOrigin` |
| `PriceRoundingRule` + `decimalRanges` | `core.price_rounding_range` + `core.price_rounding_rule` | schema novo já é o modelo equivalente; reusa `PriceRoundingService.list` |
| `Origin` enum | `CompetitorOrigin` (`src/database/enums`) | superset (inclui PACHECO/SAO_PAULO/VENANCIO/INDIANA) |

Enums de cálculo **não existem** no novo e são portados: `CalculationBaseType`
(`COMPETITIVE_PRICE`/`SALE_PRICE`/`OFFER_PRICE`), `PriceBaseSource`
(`OWN_PRICE`/`DROGAL`/`DROGASIL`/`PAGUE_MENOS`/`IKESAKI`/`MICHELASSI`),
`PricingActionType` (`DISCOUNT`/`INCREASE`).

## 4. A rotina (motor de cálculo) — comportamento preservado

Por produto (idêntico ao legado, só muda o acesso a campos):

1. **Preço-base** por `calculationBaseType`: `SALE_PRICE` → preço de venda;
   `OFFER_PRICE` → preço de oferta (ou venda); `COMPETITIVE_PRICE` → menor preço entre as
   `priceBaseSources` pedidas (`OWN_PRICE` = preço próprio; demais = preço do concorrente).
   Sem preço competitivo ⇒ resultado **pulado** (`skippedNoCompetitorPrice`).
2. **Regra de preço** correspondente (match por classificação normalizada a 2 níveis +
   faixa de preço e/ou margem, AND quando ambas) → aplica `DISCOUNT`/`INCREASE`.
3. **Limite**: se o preço final ultrapassa o preço de venda base ⇒ **pulado**
   (`skippedPriceExceedsLimit`).
4. **Trava de margem** (`price lock`): se margem atual ou nova < `minMargin`, sobe o preço
   para `cost / (1 - minMargin/100)` (`priceLockApplied`).
5. **Arredondamento** opcional por faixa de preço × bucket decimal (`priceRoundingApplied`).
6. **`appliedPercentageValue`** recalculado quando lock/arredondamento mudam o preço.

Validações de borda (mantidas): regras/locks **não podem se sobrepor** (mesma
classificação + faixas que se cruzam); lock "todas as classificações" não coexiste com outros.

## 5. Escopo

### Fase 1 — esta PR (implementada, testada, funcionando local)

A **rotina** (o que o usuário pediu), exposta como endpoint de **preview**, sem persistência:

- `src/database/enums/{calculation-base-type,price-base-source,pricing-action-type}.enum.ts`.
- `src/tenant-api/offer-book-rules/dto/preview-offer-book-rules.dto.ts` — DTOs de regra,
  lock e preview + interfaces de resultado.
- `src/tenant-api/offer-book-rules/offer-book-rules.service.ts` — **motor puro**
  (normalização, validação de sobreposição, cálculo) + `preview(em, slug, dto)` que busca
  produtos (`product` + path da `classification` via CTE + `offer_book`), preços de
  concorrentes (`shared_catalog.product`) e arredondamento (`PriceRoundingService`), e chama
  o motor com paginação.
- `src/tenant-api/offer-book-rules/offer-book-rules.controller.ts` —
  `POST /offer-book-rules/preview` (`@Roles(OPERATOR, ADMIN)`).
- Wiring em `src/tenant-api/tenant-api.module.ts`.
- `offer-book-rules.service.spec.ts` — cobertura unitária ampla do motor (o legado **não
  tinha** testes deste cálculo) + orquestração do preview com `em` mockado.

**Verificação local:** `npm run lint`, `npm run build`, `npm test` (specs novos sem DB).

### Fase 2 — persistência/CRUD + relatórios + CSV (IMPLEMENTADA)

Entregue e verificada com Postgres local (docker) ponta-a-ponta:

- **Entidades realinhadas** (6) ao modelo do legado, adaptadas ao app novo: a regra é
  **standalone e nomeada** (não 1:1 com `offer_book_info` como no legado — o `offer_book_info`
  novo tem outro shape); alvo por **EAN (`offer_book_rule_product`) XOR classificação
  (`target_classifications`)**; `pricing_rule`/`price_lock` com `classifications`, faixas,
  `action_type`, `percentage_value`, `min_margin`, `active`; report + item com auditoria
  completa. Sem `scheduling` (foi dropado do app — migration `drop-scheduling`).
- **Migration** `migrations/tenant/1700000000010-rebuild-offer-book-rules.ts` (drop dos stubs +
  recria com enums via `text + CHECK`). Validada rodando a cadeia inteira num tenant temporário.
- **`OfferBookRulesManagementService`** + `dto/offer-book-rule.dto.ts`: `create/list/get/update/
  delete`, `:id/preview` e `:id/products` (reusam o motor), CSV ad-hoc e salvo, e os 3 endpoints
  de `execution-reports`.
- **Controller** com todas as rotas (exceto execute); **e2e** `test/offer-book-rules.e2e-spec.ts`
  (12 casos) bootando o AppModule contra DB real — migration, search_path, guards de papel e
  cascade FK.

### Fase 3 — execução (`POST /offer-book-rules/:id/execute`) — pendente

Único endpoint que falta. Aplica os preços calculados como **preço de oferta no caderno do ERP**
(A7Pharma `upsertOffer`), em lote, e grava `execution_report(+items)` com contadores/outcome.
Efeito colateral **irreversível** (escreve preço real), então sai num passe dedicado com sua
própria verificação (mock do A7Pharma no e2e + validação manual contra ERP). Sem agendamento
(dropado do app); execução é **manual**.

## 6. Checklist

- [x] Doc do plano (este arquivo) — **mantido** no repo para histórico.
- [x] Enums de cálculo portados.
- [x] DTOs do preview + da regra salva.
- [x] Motor + orquestração `preview`.
- [x] Fase 2: entidades + migration + CRUD + relatórios + CSV.
- [x] Controller + wiring no módulo.
- [x] Testes verdes (`npm test` 278 unit) + e2e (12 casos, docker Postgres).
- [x] `lint` + `build` limpos.
- [x] PR aberta contra `main`.
- [ ] Fase 3: `POST /:id/execute` (write-back de preço no ERP).
