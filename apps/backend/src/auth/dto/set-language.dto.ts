import { IsIn, IsString } from 'class-validator';
import { SUPPORTED_LOCALES } from '../../common/i18n/locales';

export class SetLanguageDto {
  /**
   * El idioma elegido.
   *
   * Se valida contra la lista de idiomas que el producto habla, no contra cualquier código
   * ISO: guardar `fr` cuando todavía no hay traducciones al francés dejaría la interfaz medio
   * en un idioma y medio en otro, que es peor que no ofrecerlo.
   *
   * Cuando se añada un idioma, esta validación lo acepta sola: la lista es la misma.
   */
  @IsString()
  @IsIn(SUPPORTED_LOCALES, {
    message: 'Ese idioma todavía no está disponible.',
  })
  locale!: string;
}
