import { useEffect } from 'react';
import { useT, type TranslationKey } from '../i18n';

/**
 * El título de la pestaña.
 *
 * Todas las pantallas ponían "BusinessBrain", así que alguien con seis pestañas abiertas no
 * podía distinguirlas — y el historial del navegador quedaba inservible. Con esto, cada
 * pantalla dice qué es.
 *
 * Sale del catálogo de traducción, como todo lo que lee una persona: el título de una pestaña
 * en castellano dentro de una interfaz en inglés se nota inmediatamente.
 *
 * El nombre del producto va detrás y no delante: en una pestaña estrecha se recorta por la
 * derecha, y lo que tiene que sobrevivir es dónde estás, no cómo se llama la aplicación.
 */
export function usePageTitle(key: TranslationKey): void {
  const t = useT();
  const titulo = t(key);

  useEffect(() => {
    document.title = `${titulo} · BusinessBrain`;
  }, [titulo]);
}
