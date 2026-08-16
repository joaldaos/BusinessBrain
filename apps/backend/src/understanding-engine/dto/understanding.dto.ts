import {
  BusinessObjectiveStatus,
  InsightFeedbackType,
  InsightType,
} from '@businessbrain/database';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * Forma EXTERNA de las peticiones del Understanding Engine — subfase 6.1.
 *
 * Dos ausencias son deliberadas y son lo más importante de este archivo:
 *
 * 1. **No existe `origin`.** `BusinessObjectiveService.declare` lo acepta porque el dominio
 *    distingue una declaración humana de un candidato inferido, pero aceptarlo por HTTP
 *    permitiría fabricar la procedencia: declarar un objetivo con apariencia de inferido por
 *    el sistema, o elegir `MANUAL_DECLARATION` para auto-confirmarse. El servidor lo fija.
 *    La inferencia automática no es, ni debe ser, una vía HTTP.
 *
 * 2. **No existe `historicalMode`.** `RetrieveInsights` lo admite e incluye estados
 *    terminales. No afecta a la autorización —el alcance se aplica igual—, pero expondría el
 *    historial de conclusiones ya colapsadas sin que nadie lo haya pedido. Menos superficie.
 *
 * Tampoco hay forma de indicar el alcance de colección: lo resuelve el servidor a partir de
 * quién pregunta. Si viajara en la petición, el cliente podría ampliarlo.
 */

// La paginación es compartida por toda la API (6.4): un tope por módulo acabaría siendo un
// módulo sin tope.
export {
  MAX_PAGE_SIZE,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';

export class DeclareBusinessObjectiveDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  statement!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class ListBusinessObjectivesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(BusinessObjectiveStatus)
  status?: BusinessObjectiveStatus;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeSuperseded?: boolean;
}

export class CreateObjectiveVersionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  statement!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class TriggerAnalysisRunDto {
  /**
   * Acota las señales a las observadas desde este instante. No es un filtro de seguridad:
   * el alcance de un análisis es siempre toda la organización, por diseño (§3.4) — es la
   * LECTURA la que se acota por persona, no el razonamiento.
   */
  @IsOptional()
  @IsString()
  since?: string;
}

export class ListInsightsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(InsightType)
  type?: InsightType;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(1)
  minimumConfidence?: number;

  @IsOptional()
  @IsString()
  businessObjectiveId?: string;
}

/**
 * Curación humana. `REVOCATION` NO se acepta aquí: revocar exige decir QUÉ entrada deja sin
 * efecto, y eso tiene su propia ruta.
 */
export class CurateInsightDto {
  @IsEnum(InsightFeedbackType)
  type!: InsightFeedbackType;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class RevokeCurationDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

/** Los seis puntos del Principio de Evolución Asistida. Ninguno es opcional (§3.2). */
export class EscalateInsightDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  detected!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  justification!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  estimatedImpact!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  advantages!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  drawbacks!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  affectedAreas!: string;

  /**
   * NUNCA se omite. Si el cambio no requiere migración se declara explícitamente como "no
   * aplica"; por eso exige contenido en vez de admitir cadena vacía.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  migrationPlan!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  priority?: number;
}
