import { PlatformAccessScope } from '@businessbrain/database';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class RequestAccessDto {
  @IsIn(Object.values(PlatformAccessScope))
  scope!: PlatformAccessScope;

  /**
   * Por qué se necesita.
   *
   * Obligatorio y con un mínimo real: "prueba" o "x" no explican nada, y un acceso sin motivo
   * no se puede auditar después — la traza diría que alguien miró y no por qué, que es la
   * mitad de la pregunta.
   */
  @IsString()
  @MinLength(10, {
    message: 'Explica en una frase por qué necesitas este acceso.',
  })
  reason!: string;

  /** Cuántas horas. Si no se dice, el valor por defecto del alcance; nunca más que su techo. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 7)
  hours?: number;
}

export class ApproveAccessDto {
  /** El propietario puede acortar el plazo que se le pide, nunca alargarlo por encima del tope. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(72)
  hours?: number;
}
