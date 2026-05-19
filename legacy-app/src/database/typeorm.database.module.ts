import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ActiveIngredientTypeormEntity } from './entities/active-ingredient.entity';
import { BaseProductStockTypeormEntity } from './entities/base-product-stock.entity';
import { BaseProductTypeormEntity } from './entities/base-product.entity';
import { ClassificationTypeormEntity } from './entities/classification.entity';
import { ImportProcessTypeormEntity } from './entities/import-process.entity';
import { OfferBookInfoTypeormEntity } from './entities/offer-book-info.entity';
import { OfferBookRulesExecutionReportTypeormEntity } from './entities/offer-book-rules-execution-report.entity';
import { OfferBookRulesTypeormEntity } from './entities/offer-book-rules.entity';
import { OfferBookTypeormEntity } from './entities/offer-book.entity';
import { PriceRoundingRuleTypeormEntity } from './entities/price-rounding-rule.entity';
import { ProductImageTypeormEntity } from './entities/product-image.entity';
import { ProductTypeormEntity } from './entities/product.entity';
import { SchedulingTypeormEntity } from './entities/scheduling.entity';
import { StatusSettingsTypeormEntity } from './entities/status-settings.entity';
import { CadernoOfertaTypeormEntity } from './integration-entities/caderno-oferta.entity';
import { ClassificacaoProdutoTypeormEntity } from './integration-entities/classificacao-produto.entity';
import { ClassificacaoTypeormEntity } from './integration-entities/classificacao.entity';
import { CustoProdutoTypeormEntity } from './integration-entities/custo-produto.entity';
import { EmbalagemTypeormEntity } from './integration-entities/embalagem.entity';
import { EstoqueTypeormEntity } from './integration-entities/estoque.entity';
import { FabricanteTypeormEntity } from './integration-entities/fabricante.entity';
import { ItemCadernoOfertaQuantidadeTypeormEntity } from './integration-entities/item-caderno-oferta-quantidade.entity';
import { ItemCadernoOfertaTypeormEntity } from './integration-entities/item-caderno-oferta.entity';
import { ItemRecebimentoFisicoTypeormEntity } from './integration-entities/item-recebimento-fisico.entity';
import { PessoaTypeormEntity } from './integration-entities/pessoa.entity';
import { PrincipioAtivoTypeormEntity } from './integration-entities/principio-ativo.entity';
import { ProdutoTypeormEntity } from './integration-entities/produto.entity';
import { CadernoOfertaRepository } from './integration-repositories/caderno-oferta.repository';
import { ClassificacaoProdutoRepository } from './integration-repositories/classificacao-produto.repository';
import { ClassificacaoRepository } from './integration-repositories/classificacao.repository';
import { CustoProdutoRepository } from './integration-repositories/custo-produto.repository';
import { EmbalagemRepository } from './integration-repositories/embalagem.repository';
import { EstoqueRepository } from './integration-repositories/estoque.repository';
import { FabricanteRepository } from './integration-repositories/fabricante.repository';
import { ItemCadernoOfertaQuantidadeRepository } from './integration-repositories/item-caderno-oferta-quantidade.repository';
import { ItemCadernoOfertaRepository } from './integration-repositories/item-caderno-oferta.repository';
import { ItemRecebimentoFisicoRepository } from './integration-repositories/item-recebimento-fisico.repository';
import { PessoaRepository } from './integration-repositories/pessoa.repository';
import { PrincipioAtivoRepository } from './integration-repositories/principio-ativo.repository';
import { ProdutoRepository } from './integration-repositories/produto.repository';
import { IntegrationTypeOrmDataSource } from './integration.typeorm.data-source';
import { ActiveIngredientsRepository } from './repositories/active-ingredients.repository';
import { BaseProductStockRepository } from './repositories/base-product-stock.repository';
import { BaseProductRepository } from './repositories/base-product.repository';
import { ClassificationRepository } from './repositories/classification.repository';
import { ImportProcessRepository } from './repositories/import-process.repository';
import { OfferBookInfoRepository } from './repositories/offer-book-info.repository';
import { OfferBookRulesExecutionReportRepository } from './repositories/offer-book-rules-execution-report.repository';
import { OfferBookRulesRepository } from './repositories/offer-book-rules.repository';
import { OfferBookRepository } from './repositories/offer-book.repository';
import { PriceRoundingRuleRepository } from './repositories/price-rounding-rule.repository';
import { ProductImageRepository } from './repositories/product-image.repository';
import { ProductRepository } from './repositories/product.repository';
import { SchedulingRepository } from './repositories/scheduling.repository';
import { StatusSettingsRepository } from './repositories/status-settings.repository';
import { TypeOrmDataSource } from './typeorm.data-source';
import { DATABASE_CONNECTION_TOKEN, INTEGRATION_DATABASE_CONNECTION_TOKEN } from './typeorm.database.tokens';

@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION_TOKEN,
      useFactory: async (): Promise<DataSource> => {
        const connection = await TypeOrmDataSource.initialize().catch((e) => {
          throw new Error(`DB Connection Error: ${e}`);
        });
        return connection;
      }
    },
    {
      provide: INTEGRATION_DATABASE_CONNECTION_TOKEN,
      useFactory: async (): Promise<DataSource | null> => {
        const connection = await IntegrationTypeOrmDataSource.initialize().catch((e) => {
          console.error(`Integration DB Connection Error: ${e}. The app will continue without integration database.`);
          return null;
        });
        return connection;
      }
    },
    {
      provide: ClassificationRepository,
      inject: [DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource): ClassificationRepository => {
        return new ClassificationRepository(dataSource.getRepository(ClassificationTypeormEntity));
      }
    },
    {
      provide: BaseProductRepository,
      inject: [DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource): BaseProductRepository => {
        return new BaseProductRepository(dataSource.getRepository(BaseProductTypeormEntity), dataSource.getRepository(ClassificationTypeormEntity));
      }
    },
    {
      provide: ProductRepository,
      inject: [DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource): ProductRepository => {
        return new ProductRepository(dataSource.getRepository(ProductTypeormEntity));
      }
    },
    {
      provide: ImportProcessRepository,
      inject: [DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource): ImportProcessRepository => {
        return new ImportProcessRepository(dataSource.getRepository(ImportProcessTypeormEntity));
      }
    },
    {
      provide: ProductImageRepository,
      inject: [DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource): ProductImageRepository => {
        return new ProductImageRepository(dataSource.getRepository(ProductImageTypeormEntity));
      }
    },
    {
      provide: ActiveIngredientsRepository,
      inject: [DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource): ActiveIngredientsRepository => {
        return new ActiveIngredientsRepository(dataSource.getRepository(ActiveIngredientTypeormEntity));
      }
    },
    {
      provide: BaseProductStockRepository,
      inject: [DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource): BaseProductStockRepository => {
        return new BaseProductStockRepository(dataSource.getRepository(BaseProductStockTypeormEntity));
      }
    },
    {
      provide: OfferBookRepository,
      inject: [DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource): OfferBookRepository => {
        return new OfferBookRepository(dataSource.getRepository(OfferBookTypeormEntity));
      }
    },
    {
      provide: OfferBookInfoRepository,
      inject: [DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource): OfferBookInfoRepository => {
        return new OfferBookInfoRepository(dataSource.getRepository(OfferBookInfoTypeormEntity));
      }
    },
    {
      provide: OfferBookRulesRepository,
      inject: [DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource): OfferBookRulesRepository => {
        return new OfferBookRulesRepository(dataSource.getRepository(OfferBookRulesTypeormEntity), dataSource);
      }
    },
    {
      provide: OfferBookRulesExecutionReportRepository,
      inject: [DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource): OfferBookRulesExecutionReportRepository => {
        return new OfferBookRulesExecutionReportRepository(dataSource.getRepository(OfferBookRulesExecutionReportTypeormEntity), dataSource);
      }
    },
    {
      provide: SchedulingRepository,
      inject: [DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource): SchedulingRepository => {
        return new SchedulingRepository(dataSource.getRepository(SchedulingTypeormEntity));
      }
    },
    {
      provide: PriceRoundingRuleRepository,
      inject: [DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource): PriceRoundingRuleRepository => {
        return new PriceRoundingRuleRepository(dataSource.getRepository(PriceRoundingRuleTypeormEntity));
      }
    },
    {
      provide: StatusSettingsRepository,
      inject: [DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource): StatusSettingsRepository => {
        return new StatusSettingsRepository(dataSource.getRepository(StatusSettingsTypeormEntity));
      }
    },
    {
      provide: EmbalagemRepository,
      inject: [INTEGRATION_DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource | null): EmbalagemRepository | null => {
        if (!dataSource) return null;
        return new EmbalagemRepository(dataSource.getRepository(EmbalagemTypeormEntity));
      }
    },
    {
      provide: EstoqueRepository,
      inject: [INTEGRATION_DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource | null): EstoqueRepository | null => {
        if (!dataSource) return null;
        return new EstoqueRepository(dataSource.getRepository(EstoqueTypeormEntity));
      }
    },
    {
      provide: ClassificacaoRepository,
      inject: [INTEGRATION_DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource | null): ClassificacaoRepository | null => {
        if (!dataSource) return null;
        return new ClassificacaoRepository(dataSource.getRepository(ClassificacaoTypeormEntity));
      }
    },
    {
      provide: ClassificacaoProdutoRepository,
      inject: [INTEGRATION_DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource | null): ClassificacaoProdutoRepository | null => {
        if (!dataSource) return null;
        return new ClassificacaoProdutoRepository(dataSource.getRepository(ClassificacaoProdutoTypeormEntity));
      }
    },
    {
      provide: CustoProdutoRepository,
      inject: [INTEGRATION_DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource | null): CustoProdutoRepository | null => {
        if (!dataSource) return null;
        return new CustoProdutoRepository(dataSource.getRepository(CustoProdutoTypeormEntity));
      }
    },
    {
      provide: FabricanteRepository,
      inject: [INTEGRATION_DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource | null): FabricanteRepository | null => {
        if (!dataSource) return null;
        return new FabricanteRepository(dataSource.getRepository(FabricanteTypeormEntity));
      }
    },
    {
      provide: ItemCadernoOfertaRepository,
      inject: [INTEGRATION_DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource | null): ItemCadernoOfertaRepository | null => {
        if (!dataSource) return null;
        return new ItemCadernoOfertaRepository(dataSource.getRepository(ItemCadernoOfertaTypeormEntity));
      }
    },
    {
      provide: ItemCadernoOfertaQuantidadeRepository,
      inject: [INTEGRATION_DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource | null): ItemCadernoOfertaQuantidadeRepository | null => {
        if (!dataSource) return null;
        return new ItemCadernoOfertaQuantidadeRepository(dataSource.getRepository(ItemCadernoOfertaQuantidadeTypeormEntity));
      }
    },
    {
      provide: PessoaRepository,
      inject: [INTEGRATION_DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource | null): PessoaRepository | null => {
        if (!dataSource) return null;
        return new PessoaRepository(dataSource.getRepository(PessoaTypeormEntity));
      }
    },
    {
      provide: ProdutoRepository,
      inject: [INTEGRATION_DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource | null): ProdutoRepository | null => {
        if (!dataSource) return null;
        return new ProdutoRepository(dataSource.getRepository(ProdutoTypeormEntity));
      }
    },
    {
      provide: PrincipioAtivoRepository,
      inject: [INTEGRATION_DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource | null): PrincipioAtivoRepository | null => {
        if (!dataSource) return null;
        return new PrincipioAtivoRepository(dataSource.getRepository(PrincipioAtivoTypeormEntity));
      }
    },
    {
      provide: CadernoOfertaRepository,
      inject: [INTEGRATION_DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource | null): CadernoOfertaRepository | null => {
        if (!dataSource) return null;
        return new CadernoOfertaRepository(dataSource.getRepository(CadernoOfertaTypeormEntity));
      }
    },
    {
      provide: ItemRecebimentoFisicoRepository,
      inject: [INTEGRATION_DATABASE_CONNECTION_TOKEN],
      useFactory: (dataSource: DataSource | null): ItemRecebimentoFisicoRepository | null => {
        if (!dataSource) return null;
        return new ItemRecebimentoFisicoRepository(dataSource.getRepository(ItemRecebimentoFisicoTypeormEntity));
      }
    }
  ],
  exports: [
    BaseProductRepository,
    ClassificationRepository,
    ProductRepository,
    ImportProcessRepository,
    ProductImageRepository,
    BaseProductStockRepository,
    OfferBookRepository,
    OfferBookInfoRepository,
    OfferBookRulesRepository,
    OfferBookRulesExecutionReportRepository,
    EmbalagemRepository,
    EstoqueRepository,
    ClassificacaoRepository,
    ClassificacaoProdutoRepository,
    CustoProdutoRepository,
    FabricanteRepository,
    ItemCadernoOfertaRepository,
    ItemCadernoOfertaQuantidadeRepository,
    PessoaRepository,
    ProdutoRepository,
    CadernoOfertaRepository,
    PrincipioAtivoRepository,
    ActiveIngredientsRepository,
    ItemRecebimentoFisicoRepository,
    SchedulingRepository,
    PriceRoundingRuleRepository,
    StatusSettingsRepository
  ]
})
export class TypeormDatabaseModule {}
