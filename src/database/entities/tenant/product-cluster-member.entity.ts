import { Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Membro de um cluster: par (cluster, ean). Tabela de junção — PK composta, sem
 * id/timestamps (não estende BaseEntity). Port do pricy-shelf
 * `product_cluster_members`.
 */
@Entity({ name: 'product_cluster_member' })
@Index('IX_PRODUCT_CLUSTER_MEMBER_EAN', ['ean'])
export class ProductClusterMemberEntity {
  @PrimaryColumn({ name: 'cluster_id', type: 'uuid' })
  public clusterId!: string;

  @PrimaryColumn({ type: 'text' })
  public ean!: string;
}
