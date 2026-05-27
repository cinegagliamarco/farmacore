import { DataSource } from 'typeorm';
import { ClassificacaoProdutoEntity } from '../../entities/a7pharma/classificacao-produto.entity';
import { CustoProdutoEntity } from '../../entities/a7pharma/custo-produto.entity';
import { EmbalagemEntity } from '../../entities/a7pharma/embalagem.entity';
import { ItemCadernoOfertaEntity } from '../../entities/a7pharma/item-caderno-oferta.entity';
import { ItemCadernoOfertaQuantidadeEntity } from '../../entities/a7pharma/item-caderno-oferta-quantidade.entity';
import { ItemRecebimentoFisicoEntity } from '../../entities/a7pharma/item-recebimento-fisico.entity';

import { ClassificacaoProdutoRepository } from './classificacao-produto.repository';
import { CustoProdutoRepository } from './custo-produto.repository';
import { EmbalagemRepository } from './embalagem.repository';
import { ItemCadernoOfertaRepository } from './item-caderno-oferta.repository';
import { ItemCadernoOfertaQuantidadeRepository } from './item-caderno-oferta-quantidade.repository';
import { ItemRecebimentoFisicoRepository } from './item-recebimento-fisico.repository';

export {
  ClassificacaoProdutoRepository,
  CustoProdutoRepository,
  EmbalagemRepository,
  ItemCadernoOfertaRepository,
  ItemCadernoOfertaQuantidadeRepository,
  ItemRecebimentoFisicoRepository,
};
export type { ItemCadernoOfertaWithPrice } from './item-caderno-oferta.repository';
export type { LatestReceiptDate } from './item-recebimento-fisico.repository';

/**
 * Per-call bundle of A7Pharma read repositories bound to the tenant's
 * integration DataSource. Pipeline steps instantiate this in handle()
 * after IntegrationDataSourceFactory.forTenantSlug returns the DS.
 */
export class A7PharmaRepositories {
  public readonly embalagem: EmbalagemRepository;
  public readonly classificacaoProduto: ClassificacaoProdutoRepository;
  public readonly custoProduto: CustoProdutoRepository;
  public readonly itemCadernoOferta: ItemCadernoOfertaRepository;
  public readonly itemCadernoOfertaQuantidade: ItemCadernoOfertaQuantidadeRepository;
  public readonly itemRecebimentoFisico: ItemRecebimentoFisicoRepository;

  constructor(ds: DataSource) {
    this.embalagem = new EmbalagemRepository(ds.getRepository(EmbalagemEntity));
    this.classificacaoProduto = new ClassificacaoProdutoRepository(
      ds.getRepository(ClassificacaoProdutoEntity),
    );
    this.custoProduto = new CustoProdutoRepository(
      ds.getRepository(CustoProdutoEntity),
    );
    this.itemCadernoOferta = new ItemCadernoOfertaRepository(
      ds.getRepository(ItemCadernoOfertaEntity),
    );
    this.itemCadernoOfertaQuantidade =
      new ItemCadernoOfertaQuantidadeRepository(
        ds.getRepository(ItemCadernoOfertaQuantidadeEntity),
      );
    this.itemRecebimentoFisico = new ItemRecebimentoFisicoRepository(
      ds.getRepository(ItemRecebimentoFisicoEntity),
    );
  }
}
