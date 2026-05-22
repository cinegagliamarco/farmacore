import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'active_ingredient' })
@Index('UQ_ACTIVE_INGREDIENT_NAME', ['name'], { unique: true })
export class ActiveIngredientEntity extends BaseEntity {
  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  public mat?: string | null;

  @Column({ name: 'mat_updated_at', type: 'timestamptz', nullable: true })
  public matUpdatedAt?: Date | null;
}
