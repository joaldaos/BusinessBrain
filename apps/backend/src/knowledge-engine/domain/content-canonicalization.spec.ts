import {
  canonicalizeContent,
  computeContentHash,
} from './content-canonicalization';

describe('canonicalizeContent', () => {
  it('colapsa espacios, tabuladores y saltos de linea a un unico espacio', () => {
    const withExtraSpaces = 'La empresa  establece';
    const withTab = 'La empresa\testablece';
    const withNewline = 'La empresa\nestablece';
    const withBlankLines = 'La empresa\n\n\nestablece';

    const baseline = canonicalizeContent('La empresa establece');
    expect(canonicalizeContent(withExtraSpaces)).toBe(baseline);
    expect(canonicalizeContent(withTab)).toBe(baseline);
    expect(canonicalizeContent(withNewline)).toBe(baseline);
    expect(canonicalizeContent(withBlankLines)).toBe(baseline);
  });

  it('recorta espacio en blanco al principio y al final', () => {
    expect(canonicalizeContent('   hola mundo   ')).toBe('hola mundo');
  });

  it('normaliza CRLF y CR igual que LF', () => {
    const baseline = canonicalizeContent('linea uno\nlinea dos');
    expect(canonicalizeContent('linea uno\r\nlinea dos')).toBe(baseline);
    expect(canonicalizeContent('linea uno\rlinea dos')).toBe(baseline);
  });

  it('pliega mayusculas y minusculas', () => {
    expect(canonicalizeContent('Politica de VACACIONES')).toBe(
      canonicalizeContent('politica de vacaciones'),
    );
  });

  it('normaliza distintas codificaciones Unicode del mismo caracter acentuado (NFC vs NFD)', () => {
    const precomposed = 'café'; // e con tilde como un unico code point (forma NFC)
    const decomposed = precomposed.normalize('NFD'); // "e" + acento combinante por separado
    expect(decomposed).not.toBe(precomposed); // confirma que de verdad son bytes distintos
    expect(canonicalizeContent(precomposed)).toBe(
      canonicalizeContent(decomposed),
    );
  });

  it('elimina caracteres invisibles de formato (espacio de ancho cero, BOM)', () => {
    const zeroWidthSpace = String.fromCharCode(0x200b);
    const bom = String.fromCharCode(0xfeff);
    const withInvisibleChars = `hola${zeroWidthSpace}mundo${bom}`;
    expect(canonicalizeContent(withInvisibleChars)).toBe('holamundo');
  });

  it('NO elimina ni sustituye tildes reales - son contenido, no formato', () => {
    const conTilde = 'est' + String.fromCharCode(0x00e1); // "está"
    const sinTilde = 'esta';
    expect(canonicalizeContent(conTilde)).not.toBe(
      canonicalizeContent(sinTilde),
    );
  });

  it('NO altera numeros, puntuacion ni el orden de las palabras', () => {
    expect(canonicalizeContent('22 dias, no 25.')).toBe('22 dias, no 25.');
    expect(canonicalizeContent('el gato come pescado')).not.toBe(
      canonicalizeContent('el pescado come gato'),
    );
  });

  it('22 dias y 25 dias siguen siendo contenido distinto tras canonicalizar', () => {
    expect(canonicalizeContent('22 dias de vacaciones')).not.toBe(
      canonicalizeContent('25 dias de vacaciones'),
    );
  });
});

describe('computeContentHash', () => {
  it('es determinista', () => {
    expect(computeContentHash('mismo contenido')).toBe(
      computeContentHash('mismo contenido'),
    );
  });

  it('produce el mismo hash para diferencias puramente de formato (el defecto original)', () => {
    const original =
      'La politica de vacaciones establece 22 dias al año para toda la plantilla.';
    const reformatted =
      'La   politica de\tvacaciones establece 22 dias\nal año para toda la plantilla.';
    expect(computeContentHash(original)).toBe(computeContentHash(reformatted));
  });

  it('produce el mismo hash para diferencias de mayusculas/minusculas', () => {
    expect(computeContentHash('Politica de Vacaciones')).toBe(
      computeContentHash('politica de vacaciones'),
    );
  });

  it('produce hashes distintos para contenido realmente distinto', () => {
    expect(computeContentHash('22 dias de vacaciones')).not.toBe(
      computeContentHash('25 dias de vacaciones'),
    );
  });
});
