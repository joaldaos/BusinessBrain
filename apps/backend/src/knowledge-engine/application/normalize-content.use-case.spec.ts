import {
  normalizeContent,
  EmptyNormalizedContentError,
} from './normalize-content.use-case';
import { DocumentRejectedError } from '../domain/document-formats';

describe('normalizeContent', () => {
  it('normaliza texto plano y calcula un hash determinista', async () => {
    const result = await normalizeContent(
      Buffer.from('Política de vacaciones: 22 días al año.'),
      'text/plain',
    );

    expect(result.text).toBe('Política de vacaciones: 22 días al año.');
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el mismo contenido normalizado produce siempre el mismo hash', async () => {
    const a = await normalizeContent(
      Buffer.from('mismo contenido'),
      'text/plain',
    );
    const b = await normalizeContent(
      Buffer.from('mismo contenido'),
      'text/plain',
    );

    expect(a.contentHash).toBe(b.contentHash);
  });

  it('contenido distinto produce hashes distintos', async () => {
    const a = await normalizeContent(Buffer.from('contenido A'), 'text/plain');
    const b = await normalizeContent(Buffer.from('contenido B'), 'text/plain');

    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('recorta espacios/saltos de línea sobrantes antes de calcular el hash', async () => {
    const withPadding = await normalizeContent(
      Buffer.from('  \r\n  hola mundo  \r\n  '),
      'text/plain',
    );
    const clean = await normalizeContent(
      Buffer.from('hola mundo'),
      'text/plain',
    );

    expect(withPadding.text).toBe('hola mundo');
    expect(withPadding.contentHash).toBe(clean.contentHash);
  });

  it('acepta Markdown y lo conserva tal cual (sin renderizar)', async () => {
    const result = await normalizeContent(
      Buffer.from('# Título\n\n- item uno\n- item dos'),
      'text/markdown',
    );

    expect(result.text).toBe('# Título\n\n- item uno\n- item dos');
  });

  it('elimina etiquetas HTML (incluido el contenido de <script>/<style>)', async () => {
    const result = await normalizeContent(
      Buffer.from(
        '<html><head><style>body{color:red}</style></head>' +
          '<body><h1>Hola</h1><script>alert(1)</script><p>Mundo</p></body></html>',
      ),
      'text/html',
    );

    expect(result.text).toBe('Hola Mundo');
  });

  it('ignora parámetros del Content-Type (p. ej. charset)', async () => {
    const result = await normalizeContent(
      Buffer.from('hola'),
      'text/plain; charset=utf-8',
    );

    expect(result.text).toBe('hola');
  });

  it('rechaza un tipo de archivo que no sabemos leer', async () => {
    await expect(
      normalizeContent(
        Buffer.from('MZ...'),
        'application/x-msdownload',
        'a.exe',
      ),
    ).rejects.toBeInstanceOf(DocumentRejectedError);
  });

  it('rechaza contenido que queda vacío tras normalizar', async () => {
    await expect(
      normalizeContent(Buffer.from('   \n\n  '), 'text/plain'),
    ).rejects.toBeInstanceOf(EmptyNormalizedContentError);
  });

  it('un HTML sin texto visible (solo etiquetas) también se rechaza como vacío', async () => {
    await expect(
      normalizeContent(Buffer.from('<div></div><br/>'), 'text/html'),
    ).rejects.toBeInstanceOf(EmptyNormalizedContentError);
  });
});
