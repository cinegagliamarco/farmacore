import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'classificacao', schema: 'public', synchronize: false })
export class ClassificacaoEntity {
  @PrimaryColumn({ type: 'bigint', name: 'id' })
  public id!: number;

  @Column({ type: 'varchar', length: 50, name: 'nome', nullable: false })
  public nome!: string;

  @Column({ type: 'boolean', name: 'folha', nullable: false })
  public folha!: boolean;

  @Column({ type: 'boolean', name: 'principal', nullable: false })
  public principal!: boolean;

  @Column({ type: 'int', name: 'profundidade', nullable: false })
  public profundidade!: number;

  @Column({ type: 'bigint', name: 'classificacaopaiid', nullable: true })
  public classificacaopaiid?: number;

  @Column({ type: 'varchar', length: 250, name: 'caminho', nullable: false })
  public caminho!: string;

  @Column({
    type: 'char',
    length: 1,
    name: 'plugpharmagrupoprincipal',
    nullable: false,
    default: '?',
  })
  public plugpharmagrupoprincipal!: string;

  @Column({
    type: 'varchar',
    length: 2,
    name: 'grupoafericaoindicadores',
    nullable: false,
    default: '?',
  })
  public grupoafericaoindicadores!: string;

  @Column({
    type: 'boolean',
    name: 'permiteempacotamento',
    nullable: false,
    default: false,
  })
  public permiteempacotamento!: boolean;

  @ManyToOne(() => ClassificacaoEntity, (c) => c.children, { nullable: true })
  @JoinColumn({ name: 'classificacaopaiid', referencedColumnName: 'id' })
  public classificacaoPai?: ClassificacaoEntity;

  @OneToMany(() => ClassificacaoEntity, (c) => c.classificacaoPai)
  public children!: ClassificacaoEntity[];
}
