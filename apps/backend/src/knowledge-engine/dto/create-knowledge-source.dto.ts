import {
  IsArray,
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

  /**
   * A qué colecciones va a parar el conocimiento que entre por esta fuente.
   *
   * Es el "alcance" que `KNOWLEDGE_ENGINE_DESIGN.md` §3.2 atribuye a una `KnowledgeSource`.
   * Sin declararlo, lo ingerido no pertenece a ninguna colección, su alcance efectivo es
   * vacío y —por la regla fail-closed— NADIE ve la comprensión derivada de él: el motor
   * funciona entero y el producto no sirve para nada.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  knowledgeCollectionIds?: string[];
}
