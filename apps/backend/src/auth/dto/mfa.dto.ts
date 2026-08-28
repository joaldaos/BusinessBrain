import {
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * El código: seis dígitos de la aplicación, o uno de papel.
 *
 * No se valida el formato aquí a propósito. Un `@Matches(/^\d{6}$/)` rechazaría los códigos de
 * recuperación, que llevan letras y un guion — y separarlos en dos campos obligaría a la
 * interfaz a preguntarle a la persona qué tipo de código está escribiendo, que es justo lo que
 * no sabe cuando está agobiada porque ha perdido el móvil. Un solo campo, y el servidor prueba
 * las dos cosas.
 *
 * Lo que sí se acota es la longitud: para que nadie mande un megabyte a la función de
 * comparación.
 */
export class MfaCodeDto {
  @IsString()
  @Length(4, 64)
  code!: string;
}

export class ConfirmMfaDto extends MfaCodeDto {}

/**
 * El segundo paso del inicio de sesión.
 *
 * El testigo NO es un token de acceso: demuestra que la contraseña era correcta y nada más.
 * Ver `AuthService.issueMfaChallenge`.
 */
export class LoginMfaDto extends MfaCodeDto {
  @IsString()
  @MaxLength(2048)
  mfaToken!: string;
}

/**
 * Reautenticarse: con el código si hay segundo factor, con la contraseña si no.
 *
 * Los dos campos son opcionales en el DTO y obligatorios en el servicio, según lo que tenga la
 * cuenta. No se puede decidir aquí: el DTO no sabe quién está llamando.
 */
export class ReauthenticateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;

  @IsOptional()
  @IsString()
  @Length(4, 64)
  code?: string;
}

/**
 * La contraseña nueva.
 *
 * Ocho caracteres mínimo, el mismo suelo que el registro: dos reglas distintas para la misma
 * contraseña serían una que alguien sube y otra que se queda atrás.
 *
 * No se pide la actual. La ruta ya exige reautenticación reciente, que para una cuenta con
 * segundo factor es una prueba MÁS fuerte que la contraseña, y para una sin él fue
 * precisamente la contraseña actual lo que abrió la ventana.
 */
export class ChangePasswordDto {
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(200)
  newPassword!: string;
}

/** Retirar el segundo factor de una cuenta ajena, desde la administración de plataforma. */
export class RemoveMfaDto {
  /**
   * Por qué.
   *
   * Diez caracteres mínimo, igual que el motivo de una concesión de acceso. "ok" no es un
   * motivo, y una traza que dice que se degradó la seguridad de una cuenta ajena por "ok" no
   * responde nada seis meses después.
   */
  @IsString()
  @MinLength(10, {
    message:
      'Explica por qué se retira la verificación en dos pasos (al menos 10 caracteres)',
  })
  @MaxLength(500)
  reason!: string;
}
