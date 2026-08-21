import { crc32 } from 'node:zlib';

/**
 * Documentos REALES para las pruebas: un PDF y un Word de verdad, generados aquí.
 *
 * ## Por qué se generan y no se guardan como binarios en el repositorio
 *
 * Un fixture binario es opaco: nadie sabe qué contiene sin abrirlo, y cuando una prueba falla no
 * hay forma de saber si el problema es el código o el fichero. Generándolos, lo que se prueba
 * está escrito al lado, y cambiar el contenido de un caso es cambiar una cadena.
 *
 * Y son ficheros válidos de verdad —no cabeceras falsas— porque lo que se quiere demostrar es
 * que la extracción funciona sobre lo que una PYME sube realmente.
 */

/** PDF con el texto dado, una página por elemento. Se usa `pdfkit`, ya presente para informes. */
export async function makePdf(pages: string[]): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFDocument = require('pdfkit') as new (options?: unknown) => {
    on(event: 'data', listener: (chunk: Buffer) => void): void;
    on(event: 'end', listener: () => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
    addPage(): void;
    text(value: string): void;
    end(): void;
  };

  const document = new PDFDocument({ margin: 40 });
  const chunks: Buffer[] = [];

  return new Promise<Buffer>((resolve, reject) => {
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', (error) => reject(error));

    pages.forEach((text, index) => {
      if (index > 0) document.addPage();
      document.text(text);
    });
    document.end();
  });
}

/**
 * PDF sin capa de texto: lo que produce un escaneado.
 *
 * Se dibuja un rectángulo y nada más. Es un PDF perfectamente válido del que no se puede
 * extraer una sola palabra, que es exactamente el caso que el producto debe saber explicar.
 */
export async function makeScannedPdf(): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFDocument = require('pdfkit') as new (options?: unknown) => {
    on(event: 'data', listener: (chunk: Buffer) => void): void;
    on(event: 'end', listener: () => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
    rect(
      x: number,
      y: number,
      w: number,
      h: number,
    ): { fill(color: string): void };
    end(): void;
  };

  const document = new PDFDocument({ margin: 0 });
  const chunks: Buffer[] = [];

  return new Promise<Buffer>((resolve, reject) => {
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', (error) => reject(error));

    document.rect(50, 50, 400, 300).fill('#cccccc');
    document.end();
  });
}

/**
 * `.docx` mínimo pero VÁLIDO: un ZIP con las tres partes que exige el formato.
 *
 * Se construye a mano, con entradas sin comprimir, porque es la forma de tener un Word real sin
 * añadir una dependencia solo para las pruebas.
 */
export function makeDocx(paragraphs: string[]): Buffer {
  const body = paragraphs
    .map(
      (text) =>
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`,
    )
    .join('');

  return zip([
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: 'word/document.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}</w:body>
</w:document>`,
    },
  ]);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface ZipEntry {
  name: string;
  content: string;
}

/** ZIP con entradas ALMACENADAS (método 0). Suficiente y sin dependencias. */
function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.content, 'utf8');
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // firma
    localHeader.writeUInt16LE(20, 4); // versión necesaria
    localHeader.writeUInt16LE(0, 6); // banderas
    localHeader.writeUInt16LE(0, 8); // método: almacenado
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);

    const local = Buffer.concat([localHeader, name, data]);
    locals.push(local);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);

    central.push(Buffer.concat([centralHeader, name]));
    offset += local.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuffer, end]);
}
