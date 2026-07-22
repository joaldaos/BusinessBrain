import {
  normalizeContent,
  UnsupportedContentTypeError,
  EmptyNormalizedContentError,
} from './normalize-content.use-case';

describe('normalizeContent', () => {
  it('normaliza texto plano y calcula un hash determinista', () => {
    const result = normalizeContent(
      Buffer.from('Política de vacaciones: 22 días al año.'),
      'text/plain',
    );

    expect(result.text).toBe('Política de vacaciones: 22 días al año.');
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el mismo contenido normalizado produce siempre el mismo hash', () => {
    const a = normalizeContent(Buffer.from('mismo contenido'), 'text/plain');
    const b = normalizeContent(Buffer.from('mismo contenido'), 'text/plain');

    expect(a.contentHash).toBe(b.contentHash);
  });

  it('contenido distinto produce hashes distintos', () => {
    const a = normalizeContent(Buffer.from('contenido A'), 'text/plain');
    const b = normalizeContent(Buffer.from('contenido B'), 'text/plain');

    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('recorta espacios/saltos de línea sobrantes antes de calcular el hash', () => {
    const withPadding = normalizeContent(
      Buffer.from('  \r\n  hola mundo  \r\n  '),
      'text/plain',
    );
    const clean = normalizeContent(Buffer.from('hola mundo'), 'text/plain');

    expect(withPadding.text).toBe('hola mundo');
    expect(withPadding.contentHash).toBe(clean.contentHash);
  });

  it('acepta Markdown y lo conserva tal cual (sin renderizar)', () => {
    const result = normalizeContent(
      Buffer.from('# Título\n\n- item uno\n- item dos'),
      'text/markdown',
    );

    expect(result.text).toBe('# Título\n\n- item uno\n- item dos');
  });

  it('elimina etiquetas HTML (incluido el contenido de <script>/<style>)', () => {
    const result = normalizeContent(
      Buffer.from(
        '<html><head><style>body{color:red}</style></head>' +
          '<body><h1>Hola</h1><script>alert(1)</script><p>Mundo</p></body></html>',
      ),
      'text/html',
    );

    expect(result.text).toBe('Hola Mundo');
  });

  it('ignora parámetros del Content-Type (p. ej. charset)', () => {
    const result = normalizeContent(
      Buffer.from('hola'),
      'text/plain; charset=utf-8',
    );

    expect(result.text).toBe('hola');
  });

  it('rechaza un tipo MIME no soportado todavía (p. ej. PDF binario)', () => {
    expect(() =>
      normalizeContent(Buffer.from('%PDF-1.4 ...'), 'application/pdf'),
    ).toThrow(UnsupportedContentTypeError);
  });

  it('rechaza contenido que queda vacío tras normalizar', () => {
    expect(() =>
      normalizeContent(Buffer.from('   \n\n  '), 'text/plain'),
    ).toThrow(EmptyNormalizedContentError);
  });

  it('un HTML sin texto visible (solo etiquetas) también se rechaza como vacío', () => {
    expect(() =>
      normalizeContent(Buffer.from('<div></div><br/>'), 'text/html'),
    ).toThrow(EmptyNormalizedContentError);
  });
});
