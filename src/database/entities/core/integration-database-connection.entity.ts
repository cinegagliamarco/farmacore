import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { TenantEntity } from './tenant.entity';
import { IntegrationOrigin } from '../../enums/integration-origin.enum';

type IntegrationDbType = 'postgres';
export type SslMode = 'disable' | 'require' | 'verify-full';
export type IntegrationStatus = 'active' | 'disabled' | 'error';

@Entity({ schema: 'core', name: 'integration_database_connection' })
@Index('UQ_INTEGRATION_DB_TENANT', ['tenantId'], { unique: true })
export class IntegrationDatabaseConnectionEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @ManyToOne(() => TenantEntity)
  @JoinColumn({ name: 'tenant_id' })
  public tenant?: TenantEntity;

  @Column({ type: 'text' })
  public origin!: IntegrationOrigin;

  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'text', default: 'postgres' })
  public type!: IntegrationDbType;

  @Column({ type: 'text' })
  public host!: string;

  @Column({ type: 'int' })
  public port!: number;

  @Column({ type: 'text' })
  public database!: string;

  @Column({ type: 'text' })
  public username!: string;

  @Column({ name: 'password_encrypted', type: 'bytea' })
  public passwordEncrypted!: Buffer;

  @Column({ name: 'ssl_mode', type: 'text', default: 'require' })
  public sslMode!: SslMode;

  @Column({ name: 'ssl_ca_cert', type: 'text', nullable: true })
  public sslCaCert?: string | null;

  @Column({ name: 'read_only', type: 'boolean', default: true })
  public readOnly!: boolean;

  @Column({ name: 'connection_options', type: 'jsonb', default: {} })
  public connectionOptions!: Record<string, unknown>;

  @Column({ type: 'text', default: 'active' })
  public status!: IntegrationStatus;

  @Column({ name: 'last_verified_at', type: 'timestamptz', nullable: true })
  public lastVerifiedAt?: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  public lastError?: string | null;

  // A7Pharma REST API write-back credentials (separate from the read DB).
  @Column({ name: 'api_base_url', type: 'text', nullable: true })
  public apiBaseUrl?: string | null;

  @Column({ name: 'api_key_encrypted', type: 'bytea', nullable: true })
  public apiKeyEncrypted?: Buffer | null;
}
