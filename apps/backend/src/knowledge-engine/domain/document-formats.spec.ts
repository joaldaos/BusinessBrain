import {
  DocumentRejectedError,
  acceptedExtensions,
  acceptedMimeTypes,
  resolveDocumentFormat,
} from './document-formats';

const PDF = Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary');
const DOCX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

const resolve = (
  filename: string,
  declaredMimeType: string,
  content = Buffer.from('contenido de texto'),
) => resolveDocumentFormat({ filename, declaredMimeType, content });

describe('resolveDocumentFormat', () => {
  it('reconoce los formatos que una PYME sube de verdad', () => {
    expect(resolve('notas.txt', 'text/plain')).toBe('text/plain');
    expect(resolve('guia.md', 'text/markdown')).toBe('text/markdown');
    expect(resolve('pagina.html', 'text/html')).toBe('text/html');
    expect(resolve('contrato.pdf', 'application/pdf', PDF)).toBe(
      'application/pdf',
    );
    expect(
      resolve(
        'propuesta.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        DOCX,
      ),
    ).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('cae a la extensión cuando el navegador no declara tipo', () => {
    // Pasa a menudo con .md y .docx según el sistema operativo.
    expect(resolve('contrato.pdf', '', PDF)).toBe('application/pdf');
    expect(resolve('guia.md', 'application/octet-stream')).toBe(
      'text/markdown',
    );
  });

  describe('CRÍTICO: no se cree lo que dice el nombre', () => {
    it('RECHAZA un PDF cuyo contenido no es un PDF', () => {
      // Es la comprobación que impide que un fichero renombrado llegue a un intérprete
      // binario. La extensión la pone quien sube el archivo.
      expect(() =>
        resolve('malicioso.pdf', 'application/pdf', Buffer.from('MZ\x90\x00')),
      ).toThrow(DocumentRejectedError);
    });

    it('RECHAZA un Word que no es un Word', () => {
      expect(() =>
        resolve(
          'malicioso.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          Buffer.from('esto es texto plano'),
        ),
      ).toThrow(DocumentRejectedError);
    });

    it('RECHAZA un binario con extensión de texto', () => {
      // Un .txt que empieza por %PDF- es un fichero renombrado, no un texto.
      expect(() => resolve('disfrazado.txt', 'text/plain', PDF)).toThrow(
        /extensión cambiada/i,
      );
    });
  });

  describe('lo que NO se admite', () => {
    it.each([
      ['ejecutable', 'programa.exe', 'application/x-msdownload'],
      ['hoja de cálculo', 'datos.xlsx', 'application/vnd.ms-excel'],
      // `.docm` lleva macros: código ejecutable que no tenemos ninguna razón para abrir.
      [
        'Word con macros',
        'plantilla.docm',
        'application/vnd.ms-word.document.macroEnabled.12',
      ],
      // `.doc` binario es otro formato, no una variante del que soportamos.
      ['Word antiguo', 'viejo.doc', 'application/msword'],
    ])('%s', (_caso, filename, mime) => {
      expect(() => resolve(filename, mime, DOCX)).toThrow(
        DocumentRejectedError,
      );
    });

    it('el mensaje dice qué SÍ se admite, sin tecnicismos', () => {
      try {
        resolve('programa.exe', 'application/x-msdownload');
        throw new Error('debería haber fallado');
      } catch (error) {
        const mensaje = (error as Error).message;
        expect(mensaje).toMatch(/PDF/);
        expect(mensaje).toMatch(/Word/);
        // Ni tipos MIME, ni clases, ni extensiones sueltas sin contexto.
        expect(mensaje).not.toMatch(/application\/|Error|undefined/);
      }
    });
  });

  it('ignora parámetros del tipo declarado y mayúsculas de la extensión', () => {
    expect(resolve('NOTAS.TXT', 'text/plain; charset=utf-8')).toBe(
      'text/plain',
    );
    expect(resolve('CONTRATO.PDF', 'application/pdf', PDF)).toBe(
      'application/pdf',
    );
  });

  it('un fichero más corto que la firma no se cuela como válido', () => {
    // Fail-closed: sin bytes suficientes para comprobar, no se da por bueno.
    expect(() =>
      resolve('vacio.pdf', 'application/pdf', Buffer.from('%P')),
    ).toThrow(DocumentRejectedError);
  });
});

describe('catálogo publicado a la interfaz', () => {
  it('incluye PDF y Word: la pantalla los ofrece porque de verdad se admiten', () => {
    // El selector prometía .pdf y .docx cuando la normalización los rechazaba. Ahora la
    // lista sale de la misma fuente que la validación.
    expect(acceptedExtensions()).toEqual(
      expect.arrayContaining(['.txt', '.md', '.html', '.pdf', '.docx']),
    );
    expect(acceptedMimeTypes()).toEqual(
      expect.arrayContaining(['application/pdf']),
    );
  });
});
