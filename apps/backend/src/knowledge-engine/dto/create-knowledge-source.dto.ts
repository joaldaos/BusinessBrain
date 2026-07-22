import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { KnowledgeSourceType } from '@businessbrain/database';

export class CreateKnowledgeSourceDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEnum(KnowledgeSourceType)
  type!: KnowledgeSourceType;

  /** Identifica el conector concreto, p.ej. "file_upload_v1" (único soportado en esta subfase). */
  @IsString()
  connectorKey!: string;

  /** Config específica del conector (para file_upload, normalmente vacía) — se cifra al guardar. */
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
