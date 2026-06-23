import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Entrada da trilha de auditoria (append-only). Não estende BaseEntity (sem
 * update/soft-delete — auditoria não muda).
 */
@Entity({ name: 'audit_log' })
@Index('IX_AUDIT_LOG_ENTITY', ['entity', 'entityId'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @Column({ type: 'uuid', nullable: true })
  public actor!: string | null;

  @Column({ type: 'text' })
  public action!: string;

  @Column({ type: 'text' })
  public entity!: string;

  @Column({ name: 'entity_id', type: 'text', nullable: true })
  public entityId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  public changes!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}
