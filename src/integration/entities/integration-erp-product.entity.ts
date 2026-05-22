import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'erp_product', synchronize: false })
export class IntegrationErpProductEntity {
  @PrimaryColumn({ type: 'text' })
  public id!: string;

  @Column({ type: 'text', nullable: true })
  public ean?: string | null;

  @Column({ type: 'text', nullable: true })
  public name?: string | null;
}
