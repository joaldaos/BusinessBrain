import { IsString, MinLength } from 'class-validator';

export class EraseOrganizationDataDto {
  /**
   * El nombre de la empresa, tecleado por quien borra.
   *
   * Es lo que convierte un clic en un acto deliberado. El borrado es irreversible y no hay
   * papelera detrás.
   */
  @IsString()
  @MinLength(1)
  confirmationName!: string;
}
