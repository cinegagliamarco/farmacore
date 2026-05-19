import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseTypeormModel } from './base.typeorm-model';
import { NumericColumn } from './numeric.decorator';

@Entity('status_settings')
export class StatusSettingsTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @NumericColumn({ name: 'suspect_below', nullable: false })
  public suspectBelow: number;

  @NumericColumn({ name: 'attention_below', nullable: false })
  public attentionBelow: number;

  @NumericColumn({ name: 'attention_above', nullable: false })
  public attentionAbove: number;

  @NumericColumn({ name: 'suspect_above', nullable: false })
  public suspectAbove: number;
}

