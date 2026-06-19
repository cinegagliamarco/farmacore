import {
  IsBoolean,
  IsEnum,
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
import { IntegrationOrigin } from '../../database/enums/integration-origin.enum';

export class UpsertIntegrationDto {
  @IsEnum(IntegrationOrigin)
  origin!: IntegrationOrigin;

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

  // A7Pharma REST API write-back (price/offer edits). Optional; reads use
  // the DB connection above. apiKey is encrypted at rest.
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  apiBaseUrl?: string;

  @IsOptional()
  @IsString()
  @Length(1, 1024)
  apiKey?: string;
}
