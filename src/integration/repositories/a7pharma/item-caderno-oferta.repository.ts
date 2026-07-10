import { Repository } from 'typeorm';
import { ItemCadernoOfertaEntity } from '../../entities/a7pharma/item-caderno-oferta.entity';

export type ItemCadernoOfertaWithPrice = ItemCadernoOfertaEntity & {
  effective_price?: number;
};

/** Winning caderno offer for one (embalagem × store). `precoFinalOferta` is
 *  NULL for non-priceable offer types (S/M/B/F) — the product still belongs
 *  to the caderno at that store. */
export interface StoreOfferRow {
  embalagemid: number;
  unidadenegocioid: number;
  cadernoofertaid: number;
  cadernoNome: string | null;
  precoFinalOferta: number | null;
  precoCadastro: number | null;
}

/**
 * Best active offer per embalagem, including a computed `effective_price`:
 *   - precooferta when set
 *   - else embalagem.precovenda * (1 - descontooferta/100)
 *   - else null (excluded by the WHERE clause)
 *
 * Filters down to truly active offers — status='A', non-promo flags off,
 * no day-of-week restriction, no expiration, payment form 'A'. Matches
 * the legacy filter set verbatim so behavior is preserved.
 */
export class ItemCadernoOfertaRepository {
  constructor(
    private readonly repository: Repository<ItemCadernoOfertaEntity>,
  ) {}

  public async findBestOffersWithDealsByEmbalagemIds(
    embalagemIds: number[],
  ): Promise<ItemCadernoOfertaWithPrice[]> {
    if (embalagemIds.length === 0) return [];

    const query = this.repository
      .createQueryBuilder('ico')
      .distinctOn(['ico.embalagemid'])
      .innerJoinAndSelect('ico.cadernooferta', 'co')
      .innerJoin('ico.embalagem', 'emb')
      .addSelect(
        `CASE
           WHEN ico.precooferta IS NOT NULL THEN ico.precooferta
           WHEN ico.descontooferta IS NOT NULL THEN emb.precovenda * (1 - ico.descontooferta / 100)
           ELSE NULL
         END`,
        'effective_price',
      )
      .where('ico.embalagemid IN (:...embalagemIds)', { embalagemIds })
      .andWhere('ico.comboofertaid IS NULL')
      .andWhere(
        `(
          (ico.precooferta IS NOT NULL AND ico.precooferta > 0)
          OR (ico.descontooferta IS NOT NULL AND ico.descontooferta > 0)
          OR EXISTS (SELECT 1 FROM itemcadernoofertaquantidade q WHERE q.itemcadernoofertaid = ico.id)
        )`,
      )
      .andWhere('co.status = :status', { status: 'A' })
      .andWhere('co.crmapenasgrupoconsumidor = false')
      .andWhere('co.validoapenascupomdesconto = false')
      .andWhere('co.validoapenasprevencido = false')
      .andWhere('co.formapagamentoaceita = :form', { form: 'A' })
      .andWhere('co.diasemanasegunda = false')
      .andWhere('co.diasemanaterca = false')
      .andWhere('co.diasemanaquarta = false')
      .andWhere('co.diasemanaquinta = false')
      .andWhere('co.diasemanasexta = false')
      .andWhere('co.diasemanasabado = false')
      .andWhere('co.diasemanadomingo = false')
      .andWhere('(co.datahorafinal >= NOW() OR co.datahorafinal IS NULL)')
      .orderBy('ico.embalagemid', 'ASC')
      .addOrderBy('effective_price', 'ASC', 'NULLS LAST');

    const { entities, raw } = await query.getRawAndEntities<{
      effective_price?: number | string | null;
    }>();
    return entities.map((entity, i) => {
      const ep = raw[i]?.effective_price;
      return {
        ...entity,
        effective_price: ep != null ? Number(ep) : undefined,
      };
    });
  }

  /**
   * Per-store winning offer for each (embalagem × unidade). Which caderno
   * applies at which store comes from `unidadenegocioparticipantecadernooferta`
   * — a caderno with NO participant rows covers every store. Offer items reach
   * an embalagem four ways (`tipoitem`): direct (A), grupo de remarcação (B),
   * fabricante (C), classificação (D). The unit offer price is resolved per
   * `tipooferta` over the STORE's shelf price/cost (percentage and markup
   * offers vary per store even in a chain-wide caderno); types without a unit
   * price (S/M/B/F) resolve to NULL but still mark caderno membership. Winner
   * per (store, embalagem): most specific tipoitem, then lowest effective
   * sell price — mirroring the ERP's own resolution (client-verified query).
   *
   * The caderno "active" filters mirror findBestOffersWithDealsByEmbalagemIds
   * (keep the two lists in sync) with two deliberate divergences: cadernos
   * with a future `datahorainicial` are excluded (a not-yet-started caderno
   * must not become a store's current offer/write target), and the legacy
   * `> 0` positivity guard is applied to the COMPUTED price (`precificado`:
   * junk items like tipo P with precooferta=0 become membership-only instead
   * of winning the ranking at price 0). The `ativos` pre-filter also bounds
   * the four `itens` scans to items of active cadernos — itemcadernooferta
   * has no index on the B/C/D join columns, only on cadernoofertaid.
   */
  public async findStoreOffers(
    embalagemIds: number[],
    unidadeIds: number[],
  ): Promise<StoreOfferRow[]> {
    if (embalagemIds.length === 0 || unidadeIds.length === 0) return [];
    const rows: Array<Record<string, unknown>> =
      await this.repository.manager.query(
        `WITH ativos AS (
           SELECT co.id, co.nome
             FROM cadernooferta co
            WHERE co.status = 'A'
              AND co.crmapenasgrupoconsumidor = false
              AND co.validoapenascupomdesconto = false
              AND co.validoapenasprevencido = false
              AND co.formapagamentoaceita = 'A'
              AND co.diasemanasegunda = false
              AND co.diasemanaterca = false
              AND co.diasemanaquarta = false
              AND co.diasemanaquinta = false
              AND co.diasemanasexta = false
              AND co.diasemanasabado = false
              AND co.diasemanadomingo = false
              AND (co.datahorafinal >= NOW() OR co.datahorafinal IS NULL)
              AND (co.datahorainicial <= NOW() OR co.datahorainicial IS NULL)
         ),
         alvo AS (
           SELECT emb.id AS embalagemid, emb.produtoid, emb.gruporemarcacaoid,
                  emb.precovenda, emb.precoreferencial
             FROM embalagem emb
            WHERE emb.id = ANY($1::bigint[])
         ),
         itens AS (
           SELECT ico.id AS itemid, a.embalagemid, ico.tipoitem
             FROM itemcadernooferta ico
             JOIN alvo a ON a.embalagemid = ico.embalagemid
            WHERE ico.tipoitem = 'A'
              AND ico.cadernoofertaid IN (SELECT id FROM ativos)
           UNION ALL
           SELECT ico.id, a.embalagemid, ico.tipoitem
             FROM itemcadernooferta ico
             JOIN alvo a ON a.gruporemarcacaoid = ico.gruporemarcacaoid
            WHERE ico.tipoitem = 'B'
              AND ico.cadernoofertaid IN (SELECT id FROM ativos)
           UNION ALL
           SELECT ico.id, a.embalagemid, ico.tipoitem
             FROM itemcadernooferta ico
             JOIN produto p ON p.fabricanteid = ico.fabricanteid
             JOIN alvo a ON a.produtoid = p.id
            WHERE ico.tipoitem = 'C'
              AND ico.cadernoofertaid IN (SELECT id FROM ativos)
           UNION ALL
           SELECT ico.id, a.embalagemid, ico.tipoitem
             FROM itemcadernooferta ico
             JOIN classificacaoproduto cp
               ON cp.classificacaoid = ico.classificacaoid
             JOIN alvo a ON a.produtoid = cp.produtoid
            WHERE ico.tipoitem = 'D'
              AND ico.cadernoofertaid IN (SELECT id FROM ativos)
         ),
         ofertas AS (
           SELECT i.embalagemid, l.unidadenegocioid, i.itemid, i.tipoitem,
                  ico.tipooferta, ico.precooferta, ico.descontooferta,
                  ico.markup, ico.descontoporqtdtipo,
                  co.id AS cadernoofertaid, co.nome AS caderno_nome
             FROM itens i
             JOIN itemcadernooferta ico ON ico.id = i.itemid
             JOIN ativos co ON co.id = ico.cadernoofertaid
             LEFT JOIN unidadenegocioparticipantecadernooferta upc
               ON upc.cadernoofertaid = co.id
             JOIN unnest($2::bigint[]) AS l(unidadenegocioid)
               ON upc.unidadenegocioid IS NULL
               OR upc.unidadenegocioid = l.unidadenegocioid
            WHERE ico.comboofertaid IS NULL
         ),
         com_preco AS (
           SELECT o.embalagemid, o.unidadenegocioid, o.tipoitem,
                  o.cadernoofertaid, o.caderno_nome,
                  COALESCE(peu.precovenda, a.precovenda) AS preco_cadastro,
                  CASE o.tipooferta
                    WHEN 'P' THEN o.precooferta
                    WHEN 'D' THEN COALESCE(peu.precovenda, a.precovenda)
                                  * (1 - COALESCE(o.descontooferta / 100, 0))
                    WHEN 'L' THEN COALESCE(peu.precovenda, a.precovenda)
                    WHEN 'R' THEN COALESCE(peu.precoreferencial, a.precoreferencial)
                                  * (1 + COALESCE(o.markup / 100, 0))
                    WHEN 'C' THEN cpt.custo * (1 + COALESCE(o.markup / 100, 0))
                    WHEN 'E' THEN cpt.customedio * (1 + COALESCE(o.markup / 100, 0))
                    WHEN 'Q' THEN CASE o.descontoporqtdtipo
                      WHEN 'A' THEN COALESCE(peu.precovenda, a.precovenda)
                                    * (1 - COALESCE(q1.desconto / 100, 0))
                      WHEN 'B' THEN q1.preco
                      WHEN 'C' THEN q1.precototal
                      WHEN 'D' THEN cpt.custo * (1 + COALESCE(q1.markup / 100, 0))
                      WHEN 'E' THEN cpt.customedio * (1 + COALESCE(q1.markup / 100, 0))
                      WHEN 'F' THEN COALESCE(peu.precoreferencial, a.precoreferencial)
                                    * (1 + COALESCE(q1.markup / 100, 0))
                      ELSE NULL END
                    ELSE NULL
                  END AS preco_calc
             FROM ofertas o
             JOIN alvo a ON a.embalagemid = o.embalagemid
             LEFT JOIN precoembalagemunidadenegocio peu
               ON peu.embalagemid = o.embalagemid
              AND peu.unidadenegocioid = o.unidadenegocioid
             LEFT JOIN custoproduto cpt
               ON cpt.produtoid = a.produtoid
              AND cpt.unidadenegocioid = o.unidadenegocioid
             LEFT JOIN LATERAL (
               SELECT q.desconto, q.preco, q.precototal, q.markup
                 FROM itemcadernoofertaquantidade q
                WHERE q.itemcadernoofertaid = o.itemid AND q.quantidade = 1
                ORDER BY q.id DESC LIMIT 1
             ) q1 ON true
         ),
         precificado AS (
           SELECT embalagemid, unidadenegocioid, tipoitem, cadernoofertaid,
                  caderno_nome, preco_cadastro,
                  CASE WHEN preco_calc > 0 THEN preco_calc END AS preco_final_oferta
             FROM com_preco
         )
         SELECT embalagemid, unidadenegocioid, cadernoofertaid,
                caderno_nome AS "cadernoNome",
                preco_final_oferta AS "precoFinalOferta",
                preco_cadastro AS "precoCadastro"
           FROM (
             SELECT p.*, ROW_NUMBER() OVER (
                      PARTITION BY p.unidadenegocioid, p.embalagemid
                      ORDER BY p.tipoitem,
                               LEAST(COALESCE(p.preco_final_oferta, p.preco_cadastro),
                                     p.preco_cadastro)
                    ) AS rn
               FROM precificado p
           ) ranked
          WHERE rn = 1`,
        [embalagemIds, unidadeIds],
      );
    return rows.map((r) => ({
      embalagemid: Number(r.embalagemid),
      unidadenegocioid: Number(r.unidadenegocioid),
      cadernoofertaid: Number(r.cadernoofertaid),
      cadernoNome: (r.cadernoNome as string) ?? null,
      precoFinalOferta:
        r.precoFinalOferta == null ? null : Number(r.precoFinalOferta),
      precoCadastro: r.precoCadastro == null ? null : Number(r.precoCadastro),
    }));
  }
}
