import { Column, Entity, Index, OneToMany, PrimaryColumn } from 'typeorm';
import { ItemCadernoOfertaEntity } from './item-caderno-oferta.entity';

@Entity({ name: 'cadernooferta', schema: 'public', synchronize: false })
@Index('idx_cadernooferta_datahorainicial_datahorafinal_status', [
  'datahorainicial',
  'datahorafinal',
  'status',
])
export class CadernoOfertaEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id!: number;

  @Column({
    type: 'char',
    length: 1,
    name: 'status',
    nullable: false,
    default: 'A',
  })
  public status!: string;

  @Column({ type: 'varchar', length: 70, name: 'nome', nullable: false })
  public nome!: string;

  @Column({
    type: 'timestamp',
    precision: 0,
    name: 'datahorainicial',
    nullable: true,
  })
  public datahorainicial?: Date;

  @Column({
    type: 'timestamp',
    precision: 0,
    name: 'datahorafinal',
    nullable: true,
  })
  public datahorafinal?: Date;

  @Column({
    type: 'char',
    length: 1,
    name: 'origem',
    nullable: false,
    default: 'A',
  })
  public origem!: string;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'codigointegracao',
    nullable: true,
  })
  public codigointegracao?: string;

  @Column({
    type: 'char',
    length: 1,
    name: 'intervalotempo',
    nullable: false,
    default: 'A',
  })
  public intervalotempo!: string;

  @Column({
    type: 'boolean',
    name: 'diasemanasegunda',
    nullable: false,
    default: false,
  })
  public diasemanasegunda!: boolean;

  @Column({
    type: 'boolean',
    name: 'diasemanaterca',
    nullable: false,
    default: false,
  })
  public diasemanaterca!: boolean;

  @Column({
    type: 'boolean',
    name: 'diasemanaquarta',
    nullable: false,
    default: false,
  })
  public diasemanaquarta!: boolean;

  @Column({
    type: 'boolean',
    name: 'diasemanaquinta',
    nullable: false,
    default: false,
  })
  public diasemanaquinta!: boolean;

  @Column({
    type: 'boolean',
    name: 'diasemanasexta',
    nullable: false,
    default: false,
  })
  public diasemanasexta!: boolean;

  @Column({
    type: 'boolean',
    name: 'diasemanasabado',
    nullable: false,
    default: false,
  })
  public diasemanasabado!: boolean;

  @Column({
    type: 'boolean',
    name: 'diasemanadomingo',
    nullable: false,
    default: false,
  })
  public diasemanadomingo!: boolean;

  @Column({
    type: 'char',
    length: 1,
    name: 'diasemanaordinalnumero',
    nullable: false,
    default: '?',
  })
  public diasemanaordinalnumero!: string;

  @Column({
    type: 'char',
    length: 1,
    name: 'diasemanaordinaldiasemana',
    nullable: false,
    default: '?',
  })
  public diasemanaordinaldiasemana!: string;

  @Column({ type: 'varchar', length: 255, name: 'diasmes', nullable: true })
  public diasmes?: string;

  @Column({
    type: 'boolean',
    name: 'crmrequerpessoavenda',
    nullable: false,
    default: false,
  })
  public crmrequerpessoavenda!: boolean;

  @Column({
    type: 'boolean',
    name: 'crmrequercpfcnpj',
    nullable: false,
    default: false,
  })
  public crmrequercpfcnpj!: boolean;

  @Column({
    type: 'boolean',
    name: 'crmrequercelular',
    nullable: false,
    default: false,
  })
  public crmrequercelular!: boolean;

  @Column({
    type: 'boolean',
    name: 'crmrequeremail',
    nullable: false,
    default: false,
  })
  public crmrequeremail!: boolean;

  @Column({
    type: 'boolean',
    name: 'crmrequercelulartelefone',
    nullable: false,
    default: false,
  })
  public crmrequercelulartelefone!: boolean;

  @Column({
    type: 'boolean',
    name: 'crmrequerdatanascimento',
    nullable: false,
    default: false,
  })
  public crmrequerdatanascimento!: boolean;

  @Column({
    type: 'boolean',
    name: 'crmrequerendereco',
    nullable: false,
    default: false,
  })
  public crmrequerendereco!: boolean;

  @Column({
    type: 'char',
    length: 1,
    name: 'crmapenasprimeiravendapessoa',
    nullable: false,
    default: 'N',
  })
  public crmapenasprimeiravendapessoa!: string;

  @Column({
    type: 'boolean',
    name: 'crmapenasentrega',
    nullable: false,
    default: false,
  })
  public crmapenasentrega!: boolean;

  @Column({
    type: 'char',
    length: 1,
    name: 'formapagamentoaceita',
    nullable: false,
    default: '?',
  })
  public formapagamentoaceita!: string;

  @Column({
    type: 'boolean',
    name: 'restringedescontomanual',
    nullable: false,
    default: false,
  })
  public restringedescontomanual!: boolean;

  @Column({
    type: 'boolean',
    name: 'restringedemaisofertas',
    nullable: false,
    default: false,
  })
  public restringedemaisofertas!: boolean;

  @Column({
    type: 'boolean',
    name: 'crmapenasgrupoconsumidor',
    nullable: false,
    default: false,
  })
  public crmapenasgrupoconsumidor!: boolean;

  @Column({
    type: 'boolean',
    name: 'validoapenasprevencido',
    nullable: false,
    default: false,
  })
  public validoapenasprevencido!: boolean;

  @Column({ type: 'int', name: 'diasparavencimento', nullable: true })
  public diasparavencimento?: number;

  @Column({
    type: 'boolean',
    name: 'validoapenascupomdesconto',
    nullable: false,
    default: false,
  })
  public validoapenascupomdesconto!: boolean;

  @OneToMany(() => ItemCadernoOfertaEntity, (item) => item.cadernooferta)
  public itens?: ItemCadernoOfertaEntity[];
}
