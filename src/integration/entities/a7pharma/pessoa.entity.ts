import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'pessoa', schema: 'public', synchronize: false })
@Index('idx_pessoa_nome', ['nome'])
export class PessoaEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id!: number;

  @Column({ type: 'varchar', length: 70, name: 'nome', nullable: false })
  public nome!: string;

  @Column({
    type: 'char',
    length: 1,
    name: 'tipo',
    nullable: false,
    default: 'F',
  })
  public tipo!: string;

  @Column({ type: 'varchar', length: 11, name: 'cpf', nullable: true })
  public cpf?: string;

  @Column({
    type: 'timestamp',
    precision: 0,
    name: 'datanascimento',
    nullable: true,
  })
  public datanascimento?: Date;

  @Column({ type: 'varchar', length: 15, name: 'identidade', nullable: true })
  public identidade?: string;

  @Column({
    type: 'varchar',
    length: 10,
    name: 'siglaorgaoidentidade',
    nullable: true,
  })
  public siglaorgaoidentidade?: string;

  @Column({
    type: 'char',
    length: 1,
    name: 'sexo',
    nullable: false,
    default: 'N',
  })
  public sexo!: string;

  @Column({ type: 'varchar', length: 70, name: 'profissao', nullable: true })
  public profissao?: string;

  @Column({ type: 'varchar', length: 70, name: 'conjuge', nullable: true })
  public conjuge?: string;

  @Column({ type: 'varchar', length: 70, name: 'filiacaopai', nullable: true })
  public filiacaopai?: string;

  @Column({ type: 'varchar', length: 70, name: 'filiacaomae', nullable: true })
  public filiacaomae?: string;

  @Column({
    type: 'char',
    length: 1,
    name: 'estadocivil',
    nullable: false,
    default: 'N',
  })
  public estadocivil!: string;

  @Column({ type: 'bigint', name: 'cidadenatalid', nullable: true })
  public cidadenatalid?: number;

  @Column({ type: 'bigint', name: 'estadoidentidadeid', nullable: true })
  public estadoidentidadeid?: number;

  @Column({ type: 'varchar', length: 70, name: 'razaosocial', nullable: true })
  public razaosocial?: string;

  @Column({ type: 'text', name: 'observacao', nullable: true })
  public observacao?: string;

  @Column({ type: 'varchar', length: 18, name: 'cnpj', nullable: true })
  public cnpj?: string;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'inscricaoestadual',
    nullable: true,
  })
  public inscricaoestadual?: string;

  @Column({
    type: 'varchar',
    length: 70,
    name: 'ramoatividade',
    nullable: true,
  })
  public ramoatividade?: string;

  @Column({ type: 'bigint', name: 'estadoinscricaoestadualid', nullable: true })
  public estadoinscricaoestadualid?: number;

  @Column({
    type: 'boolean',
    name: 'isentoinscricaoestadual',
    nullable: false,
    default: false,
  })
  public isentoinscricaoestadual!: boolean;

  @Column({ type: 'bigint', name: 'restricaochequeid', nullable: true })
  public restricaochequeid?: number;

  @Column({
    type: 'boolean',
    name: 'suspendercobranca',
    nullable: false,
    default: false,
  })
  public suspendercobranca!: boolean;

  @Column({
    type: 'char',
    length: 1,
    name: 'status',
    nullable: false,
    default: 'A',
  })
  public status!: string;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'codigoexportacao',
    nullable: true,
  })
  public codigoexportacao?: string;

  @Column({ type: 'varchar', length: 20, name: 'passaporte', nullable: true })
  public passaporte?: string;

  @Column({
    type: 'char',
    length: 1,
    name: 'crmrecebernotificacao',
    nullable: false,
    default: '?',
  })
  public crmrecebernotificacao!: string;

  @Column({
    type: 'boolean',
    name: 'crmrecebersms',
    nullable: false,
    default: false,
  })
  public crmrecebersms!: boolean;

  @Column({
    type: 'boolean',
    name: 'crmreceberemail',
    nullable: false,
    default: false,
  })
  public crmreceberemail!: boolean;

  @Column({
    type: 'boolean',
    name: 'crmreceberligacao',
    nullable: false,
    default: false,
  })
  public crmreceberligacao!: boolean;

  @Column({ type: 'varchar', length: 12, name: 'matriculacei', nullable: true })
  public matriculacei?: string;

  @Column({ type: 'bigint', name: 'transportadoraid', nullable: true })
  public transportadoraid?: number;

  @Column({
    type: 'timestamp',
    precision: 0,
    name: 'datahorainclusao',
    nullable: true,
  })
  public datahorainclusao?: Date;

  @Column({ type: 'bigint', name: 'usuarioinclusao', nullable: true })
  public usuarioinclusao?: number;

  @Column({
    type: 'varchar',
    length: 14,
    name: 'inscricaomunicipal',
    nullable: true,
  })
  public inscricaomunicipal?: string;

  @Column({
    type: 'boolean',
    name: 'orgaopublico',
    nullable: false,
    default: false,
  })
  public orgaopublico!: boolean;

  @Column({
    type: 'timestamp',
    precision: 0,
    name: 'datahoraalteracao',
    nullable: true,
  })
  public datahoraalteracao?: Date;

  @Column({ type: 'bigint', name: 'usuarioalteracaoid', nullable: true })
  public usuarioalteracaoid?: number;

  @Column({
    type: 'char',
    length: 1,
    name: 'atuacao',
    nullable: false,
    default: '?',
  })
  public atuacao!: string;

  @Column({
    type: 'varchar',
    length: 9,
    name: 'inscricaosuframa',
    nullable: true,
  })
  public inscricaosuframa?: string;
}
