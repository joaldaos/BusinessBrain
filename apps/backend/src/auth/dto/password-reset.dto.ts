import { IsEmail, IsString, MinLength } from 'class-validator';

export class RequestPasswordResetDto {
  @IsEmail()
  email!: string;
}

export class ConfirmPasswordResetDto {
  @IsString()
  @MinLength(1)
  token!: string;

  // El mismo mínimo que al registrarse. Si aquí fuera más laxo, recuperar la contraseña sería
  // la forma de saltarse la regla.
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  password!: string;
}
