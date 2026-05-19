import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutIntegrationSchema1742252420968 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS out_integration;`);

    await queryRunner.query(`CREATE DOMAIN datetime AS TIMESTAMP;`);

    await queryRunner.query(`CREATE TABLE out_integration.out_embalagem (
        o_ID bigint primary key, -- Representa o ID da embalagem no A7pharma
        do_ID datetime,
        o_etiqueta varchar(16), -- Representa a etiqueta da embalagem no A7Pharma
        do_etiqueta datetime,
        i_codigoIntegracao varchar(100), -- Representa o ID da embalagem no integrador
        di_codigoIntegracao datetime,
        io_integracaoConcluida boolean, -- Flag que indica que o A7 enviou dados para a tabela, e que não foram processados.
        do_integracaoConcluida datetime,
        di_integracaoConcluida datetime,
        o_descricao varchar(100), -- Descricão da embalagem.
        do_descricao datetime,
        o_codigobarras varchar(14), -- Código de barras da embalagem.
        do_codigobarras datetime,
        o_precovenda numeric(15,4), -- Preço de venda da embalagem.
        do_precovenda datetime,
        o_precopromocional numeric(15,4), -- Preço promocional da embalagem.
        do_precopromocional datetime,
        o_inicioprecopromocional datetime, -- Data de inicio do preço promocional da embalagem.
        do_inicioprecopromocional datetime,
        o_fimprecopromocional datetime, -- Data de término do preço promocional da embalagem.
        do_fimprecopromocional datetime,
        o_idfabricante bigint, -- Representa o ID do cadastro de pessoa do fabricante da embalagem.
        do_idfabricante datetime,
        o_nomefabricante varchar(70), -- Nome do fabricante da embalagem.
        do_nomefabricante datetime,
        o_estoque numeric(15,4), -- Estoque da embalagem.
        do_estoque datetime,
        o_altura numeric(15,4), -- Altura da embalagem.
        do_altura datetime,
        o_largura numeric(15,4), -- Largura da embalagem.
        do_largura datetime,
        o_comprimento numeric(15,4), -- Comprimento da embalagem.
        do_comprimento datetime,
        o_peso numeric(15,4), -- Peso da embalagem.
        do_peso datetime,
        o_idclassificacao bigint, -- ID da classifição final do produto.
        do_idclassificacao datetime,
        o_caminhoclassificacao varchar(250), -- Caminho da classificação do produto.
        do_caminhoclassificacao datetime,
        o_idclassificacaoprimeironivel bigint, -- ID da classifição de Nível 1 do produto.
        do_idclassificacaoprimeironivel datetime,
        o_nomeclassificacaoprimeironivel varchar(50), -- Nome da Classificação de Nível 1 do produto.
        do_nomeclassificacaoprimeironivel datetime,
        o_idclassificacaosegundonivel bigint, -- ID da classifição de Nível 2 do produto.
        do_idclassificacaosegundonivel datetime,
        o_nomeclassificacaosegundonivel varchar(50), -- Nome da Classificação de Nível 2 do produto.
        do_nomeclassificacaosegundonivel datetime,
        o_idclassificacaoterceironivel bigint, -- ID da classifição de Nível 3 do produto.
        do_idclassificacaoterceironivel datetime,
        o_nomeclassificacaoterceironivel varchar(50), -- Nome da Classificação de Nível 3 do produto.
        do_nomeclassificacaoterceironivel datetime
    );`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE out_integration.out_embalagem;`);
    await queryRunner.query(`DROP DOMAIN datetime;`);
    await queryRunner.query(`DROP SCHEMA out_integration;`);
  }
}
