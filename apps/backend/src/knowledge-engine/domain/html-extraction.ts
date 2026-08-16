/**
 * Extrae texto legible y título de un documento HTML.
 *
 * ## Por qué no se guarda el HTML crudo
 *
 * Lo que el sistema indexa, clasifica y trocea es TEXTO. Guardar el marcado metería etiquetas,
 * scripts y hojas de estilo en los embeddings y en el cálculo de similitud estructural, con
 * dos consecuencias concretas: la deduplicación de nivel 2 compararía plantillas en vez de
 * contenido —dos páginas distintas del mismo sitio parecerían el mismo documento— y el
 * Retriever devolvería fragmentos de menú y pie de página como si fueran conocimiento.
 *
 * ## Deliberadamente sin librería
 *
 * No se usa un parser de HTML completo. La ingesta ya normaliza y trocea después; aquí basta
 * con quedarse con el texto y descartar lo que nunca es contenido. Añadir una dependencia de
 * análisis de HTML para esto sería superficie nueva a cambio de poco.
 *
 * Dominio puro: sin red, determinista.
 */

/** Elementos cuyo contenido NUNCA es texto de la página. */
const NON_CONTENT_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'head',
  'nav',
  'footer',
] as const;

export interface ExtractedPage {
  title: string | null;
  text: string;
}

export function extractFromHtml(html: string): ExtractedPage {
  return {
    title: extractTitle(html),
    text: extractText(html),
  };
}

function extractTitle(html: string): string | null {
  const fromTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (fromTitle) {
    const title = decodeEntities(stripTags(fromTitle[1])).trim();
    if (title.length > 0) return title;
  }

  // Sin `<title>`, el primer encabezado suele ser el nombre real del documento.
  const fromHeading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (fromHeading) {
    const heading = decodeEntities(stripTags(fromHeading[1])).trim();
    if (heading.length > 0) return heading;
  }

  return null;
}

function extractText(html: string): string {
  let text = html;

  for (const element of NON_CONTENT_ELEMENTS) {
    text = text.replace(
      new RegExp(`<${element}[^>]*>[\\s\\S]*?<\\/${element}>`, 'gi'),
      ' ',
    );
  }
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');

  // Los saltos de bloque se conservan como saltos de línea: el troceado posterior se apoya en
  // la estructura del texto, y aplanarlo todo a una línea la destruiría.
  text = text
    .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  return normalizeWhitespace(decodeEntities(stripTags(text)));
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ');
}

/** Las entidades más frecuentes. El resto llega como texto y no estorba. */
function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    );
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** ¿Es un tipo de contenido del que se puede sacar texto? */
export function isTextualContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const type = contentType.split(';')[0].trim().toLowerCase();

  return (
    type.startsWith('text/') ||
    type === 'application/xhtml+xml' ||
    type === 'application/json' ||
    type === 'application/xml'
  );
}
