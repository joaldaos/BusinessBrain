import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ConfigureAiDto {
  /** Debe estar en el catálogo; el servicio lo comprueba contra el dominio, no el enum. */
  @IsString({ message: 'Elige un proveedor de inteligencia artificial.' })
  provider!: string;

  /**
   * La clave del proveedor. Solo entra: ninguna respuesta la devuelve.
   *
   * El tope existe para que un pegado accidental de un fichero entero no llegue al proveedor
   * ni se guarde cifrado en la base de datos.
   */
  @IsString({ message: 'Escribe la clave de tu proveedor de IA.' })
  @MinLength(8, {
    // Lo lee una PYME: el mensaje por defecto nombra el campo y va en inglés.
    message: 'Esa clave es demasiado corta. Cópiala entera desde tu proveedor.',
  })
  @MaxLength(500, {
    message: 'Eso es demasiado largo para ser una clave. Pega solo la clave.',
  })
  apiKey!: string;

  /** Si no se indica, se usa el modelo por defecto del catálogo. */
  @IsOptional()
  @IsString({ message: 'El modelo debe ser un texto.' })
  @MaxLength(120, { message: 'El nombre del modelo es demasiado largo.' })
  modelName?: string;
}
