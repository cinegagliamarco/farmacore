import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { UserRole } from '../../enums/user-role.enum';

export type UserStatus = 'active' | 'disabled';

@Entity({ schema: 'core', name: 'user' })
@Index('UQ_USER_TENANT_EMAIL', ['tenantId', 'email'], { unique: true })
export class UserEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'text' })
  public tenantId!: string;

  @Column({ type: 'text' })
  public email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  public passwordHash!: string;

  @Column({ type: 'text', default: 'viewer' })
  public role!: UserRole;

  @Column({ type: 'text', default: 'active' })
  public status!: UserStatus;
}
