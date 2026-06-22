import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../base.entity';

/**
 * Cluster de produto — conjunto de EANs escolhidos a dedo para mirar regras de
 * preço, atravessando as classificações do ERP. Membership estática (preenchida
 * à mão / CSV) em `product_cluster_member`. Port do pricy-shelf `product_clusters`.
 */
@Entity({ name: 'product_cluster' })
export class ProductClusterEntity extends BaseEntity {
  @Column({ type: 'text' })
  public name!: string;
}
