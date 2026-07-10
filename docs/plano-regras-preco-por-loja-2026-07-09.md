# Regras de preço e sugestão POR LOJA (fecha o B5)

**Branch:** `cinegagliamarco/regra-preco-por-loja`. Contrato para o frontend e
registro das decisões. Par dos docs [`plano-frontend-precos-multiloja-2026-07-06.md`](./plano-frontend-precos-multiloja-2026-07-06.md)
(cuja pendência **B5** este trabalho resolve) e
[`plano-lojas-clusters-2026-06-28.md`](./plano-lojas-clusters-2026-06-28.md)
(cuja afirmação "oferta é global" a §3 abaixo **supersede**).

## 1. Decisões

- **D1 — Regra declara lojas**: `storeIds` (uuids de `core.tenant_store`) na
  regra de sugestão. **Vazio = todas as lojas ativas** (toda regra existente
  continua valendo em tudo).
- **D2 — Entrega completa**: sugestão, aplicar, agendar e rollback por loja.
- **D3 — Oferta é POR LOJA via caderno**: o ERP tem
  `unidadenegocioparticipantecadernooferta` (caderno ↔ unidade de negócio).
  Caderno **sem** participantes vale para **todas** as lojas; **com**
  participantes, só para elas. O preço do item é do caderno, mas tipos
  percentuais/markup calculam sobre preço/custo **da loja** — o mesmo caderno
  produz ofertas diferentes por loja. Cada loja tem **um caderno vencedor por
  produto** (especificidade do item: embalagem > grupo remarcação > fabricante
  > classificação; desempate por menor preço final).
- **D4 — Filtro `PRC%`/origem da query do cliente**: convenção interna, NÃO
  portado. Valem os filtros de caderno ativo já usados pelo farmacore.
- **D5 — Escrita de oferta é POR CADERNO**: `POST /webapi/api/oferta/` não tem
  parâmetro de loja. Aplicar a oferta da loja X escreve no caderno vencedor
  dela; se o caderno cobre outras lojas, elas mudam juntas — o item do
  relatório anota `lojas=...` no `erpResult`.

## 2. Contrato novo/alterado (tudo aditivo, exceto onde marcado)

- **Regras** (`/pricing/suggestion-rules`): campo `storeIds: string[]` no
  create/update/list (vazio = todas). Loja de outro tenant → 400.
- **Sugestões** (`GET /pricing/suggestions` e `POST /pricing/suggestions/preview`):
  query param **`?store=`** (id EXTERNO numérico, como nas grades do catalog).
  - Com `store`: preço/custo/oferta/caderno da loja (fallback global quando a
    loja não tem linha em `product_item`), margem recalculada, e **só regras
    participantes** da loja. Loja desconhecida/inativa → **400** (diferente do
    catalog, que cai no global — sugestão alimenta o apply).
  - Sem `store`: visão base (globais) e **só regras sem escopo de loja**.
- **Apply** (`POST /pricing/apply`, `/preview`, `/rollback`): `storeId`
  opcional por item. Item com loja valida contra os valores da loja (piso,
  teto de variação) e o worker escreve venda via `idUnidadeNegocioPreco` /
  oferta no caderno vencedor DA LOJA. Item de loja SEM caderno conhecido
  (loja recém-ativada, pré-sync) é rejeitado `sem_caderno`; `cadernoId`
  explícito divergente do vencedor da loja rejeita `caderno_nao_cobre_loja`
  — nunca se escreve num caderno sem cobertura verificável. Itens de lojas
  diferentes que resolvem para o MESMO caderno: o último vence; os demais
  rejeitam `caderno_duplicado` (mesmo preço) ou `caderno_conflitante`
  (divergente) — essas duas rejeições estruturais NÃO contam para o circuit
  breaker. Rejeições sempre carregam `storeId` (null = item global).
  Escrita de oferta por loja NÃO reescreve o espelho global `offer_book`
  (só applies globais mantêm o espelho). Report expõe `storeId` por item e
  `lojas=` no `erpResult` de oferta (D5).
  ⚠️ Rollback de oferta por loja reaplica o valor antigo COMPUTADO da loja
  no caderno compartilhado — as demais lojas do caderno recebem esse valor,
  não o delas (mesma semântica D5 do apply; anotado em `lojas=`).
- **Agendamento** (`POST /pricing/schedules`): itens aceitam `storeId`;
  `recalc` recomputa com o motor **da loja** do item, escopado aos EANs
  agendados, e NÃO congela o caderno (o alvo é o vencedor atual da loja).
  Loja inválida/inativa no disparo: itens recalc são descartados (warn no
  log); falha do apply no disparo marca o agendamento como disparado com
  `applyRunId` null (warn no log) — não bloqueia os demais.
- **⚠️ Dois espaços de identificador de loja** (convenção herdada do catalog):
  `?store=` das LEITURAS usa o id EXTERNO numérico (`tenant_store.external_id`);
  `storeId` de regras/apply/agendamento usa o UUID de `core.tenant_store`.
  Nunca cruzar os dois (400 dos dois lados).
- **PATCH de regra é full-replace** (como todos os campos do upsert): body
  sem `storeIds` zera o escopo para `[]` (= todas as lojas ativas). O FE deve
  sempre reenviar o array atual ao editar qualquer campo.
- **`product_item`** ganhou `offer_external_id` (caderno vencedor da loja) e
  `offer_description`; `price_offer` passou a ser a oferta REAL da loja
  (NULL quando não subcota o preço de prateleira dela) — antes era espelho do
  `offer_book` global. Preenchido pelo sync noturno (`sync-product-items`).

## 3. Semântica de oferta (supersede "oferta é global")

A leitura por loja usa o caderno vencedor daquela loja. `offer_book` (global,
1 por EAN) continua existindo como visão base/legada e alvo do fluxo global.
Reativar loja zera também os campos de oferta congelados (repovoados no sync).

## 4. Follow-ups conhecidos

- **Checklist de deploy:** rodar `npm run migration:tenant:all` logo após o
  deploy — migrations de tenant aplicam um deploy atrasadas neste repo, e até
  a 1700000000024 aplicar o `SELECT r.store_ids` derruba todo o módulo de
  pricing do tenant (500 em regras/sugestões/apply/cron).
- Grades do catalog (`/products*` com `?store=`) ainda exibem `priceOffer` e
  margem sobre a oferta GLOBAL (`offer_book`) — migrar para
  `product_item.price_offer` é mudança de contrato FE-visível, fora deste
  escopo.
- `POST /products/:ean/price` com loja pré-sync cria linha `product_item` só
  com `price`: a loja lê "sem oferta" até o sync noturno (deliberado —
  materializar o caderno global seria pior; ver comentário no updatePrice).
- Postman: a collection não cobre `/pricing/suggestions`, `/suggestion-rules`
  nem o `storeId` nos exemplos de apply/schedule — atualizar junto com o FE.
- Agendamento que falha no disparo fica `fired` com `applyRunId` null (só
  warn no log) — um status `failed` exige alterar o CHECK `chk_psch_status`,
  e um branch paralelo já adiciona esse status; não duplicar aqui.
- A migração deste branch é a `1700000000024` — a `1700000000023` (add-failed-pricing-schedule-status) landou primeiro na main e esta foi renumerada.
- e2e locais de pricing falham por estado do banco dev compartilhado
  (módulos/seed do tenant), inclusive no baseline sem estas mudanças.
