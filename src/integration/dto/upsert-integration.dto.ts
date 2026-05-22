import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import type { SslMode } from '../../database/entities/core/integration-database-connection.entity';

export class UpsertIntegrationDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsString()
  @Length(1, 255)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsString()
  @Length(1, 128)
  database!: string;

  @IsString()
  @Length(1, 128)
  username!: string;

  @IsString()
  @Length(1, 1024)
  password!: string;

  @IsOptional()
  @IsIn(['disable', 'require', 'verify-full'])
  sslMode?: SslMode;

  @IsOptional()
  @IsString()
  sslCaCert?: string;

  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;

  @IsOptional()
  @IsObject()
  connectionOptions?: Record<string, unknown>;
}
