# Farmacore — Pending / deferred

Items consciously deferred while building the tenant presentation API (Plan 10).

## Deferred from Plan 10 (revisit when needed)
- [ ] **`curve` / `book` / `mat` on `tenant.product`** — legacy `base_product` had these (sales curve A–D, catalog "book" label, marketing-analysis target). The new `tenant.product` does **not**. Proceeding without them (those filters/sorts/columns are omitted from the v1 tenant catalog API). **If we decide to add them:** new columns on `src/database/entities/tenant/product.entity.ts` (`curve text`, `book text`, `mat numeric(10,2)`) + a tenant migration (`migrations/tenant/`) + populate them in the `sync-base-product` step (`src/pipeline/...`) from the A7Pharma ERP fields, then re-add the filters in the catalog query/DTOs.
- [ ] **Per-ingredient `mat`** — legacy had an `active_ingredient` table carrying `mat`. New model only has `shared_catalog.base_product.active_ingredient` (text, curated via `/admin/catalog/base-products`). The active-ingredient grouping endpoint ships without per-ingredient `mat` (group by the text column). Add a `mat` column to `base_product` (or a shared `active_ingredient` table) if this is needed.
- [ ] **Customer product images** — legacy `base_product_image`. Not modelled (shared_catalog only has *competitor* images). Add `tenant.product_image` if the UI needs the customer's own images.
- [ ] **`GET /offer-books/info`** — not ported; response shape undefined in the legacy controller. Revisit if the FE needs offer-book summary info. (Offer write-back `POST`/`DELETE /products/:ean/offer` is done — caderno id stored as `offer_book.external_id`.)
- [ ] **Legacy `/scheduling` surface** — not ported. `core.scheduling` was dropped (dead code, #52); price scheduling now lives in `pricing_schedule` + `PricingScheduleCron` (`/pricing/schedules`). Revisit only if the FE needs the legacy generic-action shape.

## Deferred from code review (2026-07-10)
- [ ] **Purge de `core.refresh_token`** — a tabela só cresce (todo login/refresh insere; logout apenas revoga). Um job periódico deletando linhas com `expires_at < now()` mantém a tabela e o índice `UQ_REFRESH_TOKEN_HASH` pequenos.
- [ ] **`importProduct` segura a transação durante uploads de imagem** — `products.service.ts` roda `images.project` (download + sharp + R2, até 9 origens) dentro de `dataSource.transaction`. Separar o upload (fora da tx) do insert (dentro) libera a conexão do pool.
- [ ] **Assimetria PAUSED** — login/refresh só bloqueiam `SUSPENDED`; o `ModulesGuard` 403a qualquer não-ACTIVE. Um tenant pausado loga e vê 403 em tudo. Decidir se pausado deve logar.
- [ ] **Token DI para os 9 scrapers** — `ProductsService` e `ImportCompetitorProductsStep` duplicam a lista de 9 scrapers concretos no construtor; um multi-provider `PRODUCT_SCRAPERS: ProductScraper[]` elimina a dupla manutenção e o cast de tupla no spec.
- [ ] **FE: label para `pricing_schedule.status = 'failed'`** — o status novo chega ao FE (zod tolera), mas a tela de agendamentos não tem badge/ação de retry para ele.

## Operational (your side)
- [ ] Confirm Fly secrets `R2_PUBLIC_DOMAIN` + `SEED_ADMIN_PASSWORD` are set on `farmacore-api` and `farmacore-worker` (`fly secrets list`).
- [ ] **Rotacionar a senha do usuário ERP `leitura_053401619_101224`** — a connection string hardcoded foi removida de `scripts/dump-a7pharma-sample.ts` (revisão 2026-07-10), mas continua no histórico do git.
- [ ] **Deploy do fix de DLX**: parar o worker → `npm run queues:recreate` → subir o worker novo → `npm run migration:tenant:all` (args de fila são imutáveis; ver header de `scripts/recreate-queues.ts`).
- [ ] **Auditoria do cadastro interno** — as escritas system-admin em `shared_catalog.base_product` (PATCH por EAN, rename em massa) não têm trilha de quem/quando/o quê; um rename A→B onde B já existe funde grupos sem registro de quais EANs eram A. Deferido na revisão do PR #68 (2026-07-07): avaliar um `audit_log` do shared catalog se a curadoria ganhar mais operadores.

## Completed

- [x] **Offer-book rule engine** — delivered the complete `/offer-book-rules` surface for rules, pricing rules, price locks, execution reports, and money-safe asynchronous execution. **Completed:** v0.1.0.0 (2026-07-11)
