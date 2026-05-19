import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseTypeormModel } from './base.typeorm-model';

@Entity('import_process')
export class ImportProcessTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'boolean', default: false })
  public finished: boolean;

  @Column({ name: 'process_name', type: 'text' })
  public processName: string;
}
