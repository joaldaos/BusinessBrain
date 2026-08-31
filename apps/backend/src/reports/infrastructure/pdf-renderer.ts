import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { ComposedReport } from '../application/compose-report.use-case';

/**
 * Renderizado a PDF — `pdfkit`, ya previsto por el plan de migración (§2, §5).
 *
 * Toda la dependencia de la librería vive aquí. El compositor produce estructura; esta capa
 * la convierte en bytes y no decide nada sobre el contenido.
 *
 * **No escribe en disco ni en ningún almacén.** El fichero se entrega en la respuesta y se
 * descarta: no hay almacenamiento de objetos en el proyecto todavía, y un PDF con comprensión
 * confidencial reposando en una ruta sin política de retención ni control de acceso sería
 * peor que no tenerlo. `ReportRun` conserva qué se generó y con qué evidencia, que es lo que
 * hace el informe reproducible y auditable.
 */
@Injectable()
export class PdfRenderer {
  render(params: {
    reportName: string;
    organizationName: string;
    composed: ComposedReport;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).text(params.reportName, { align: 'left' });
      doc
        .moveDown(0.3)
        .fontSize(10)
        .fillColor('#555')
        .text(params.organizationName)
        .text(
          `Generado el ${params.composed.generatedAt.toLocaleString('es-ES')}`,
        );

      for (const section of params.composed.sections) {
        doc.moveDown(1.2).fillColor('#000').fontSize(14).text(section.title);
        doc.moveDown(0.4);

        if (section.empty) {
          // Se dice que no hay nada. Una sección en blanco es indistinguible de un fallo de
          // generación, y no son lo mismo.
          doc
            .fontSize(10)
            .fillColor('#777')
            .text('Sin resultados dentro de tu alcance de conocimiento.');
          continue;
        }

        for (const row of section.rows) {
          doc.fontSize(11).fillColor('#000').text(`• ${row.primary}`);

          // Qué se detectó, por qué importa y qué hacer. Sangrados bajo el hallazgo, en el
          // orden en que los necesita quien recibe el informe.
          for (const linea of [row.detected, row.matters]) {
            if (linea) doc.fontSize(10).fillColor('#333').text(`   ${linea}`);
          }
          if (row.whatToDo) {
            /*
             * "Qué hacer:" y no una flecha.
             *
             * La fuente por defecto de PDFKit es Helvetica en WinAnsi, que no tiene `→`: en
             * el PDF salía `!’`. Se ve al abrir el fichero y no lo detecta ninguna prueba que
             * mire el buffer, porque los bytes son perfectamente válidos.
             */
            doc
              .fontSize(10)
              .fillColor('#333')
              .text(`   Qué hacer: ${row.whatToDo}`);
          }
          if (row.source) {
            doc.fontSize(9).fillColor('#666').text(`   ${row.source}`);
          }

          doc.moveDown(0.5);
        }
      }

      this.renderAnexo(doc, params.composed);

      doc.end();
    });
  }

  /**
   * El anexo: lo que hace falta para comprobar el informe.
   *
   * Aquí va lo que antes se leía debajo de cada punto —el resumen literal del motor con sus
   * números, y la ficha con el tipo, la confianza y la frescura—. No se ha quitado nada: se
   * ha movido al final, que es donde lo busca quien lo necesita y donde no estorba a quien
   * solo quiere leer el informe.
   *
   * Empieza en página nueva porque es un documento distinto dentro del mismo fichero: quien
   * lo lleva a una reunión reparte las primeras páginas y se guarda esta.
   */
  private renderAnexo(doc: PDFKit.PDFDocument, composed: ComposedReport): void {
    const conDetalle = composed.sections.filter(
      (section) => !section.empty && section.rows.some((row) => row.technical),
    );
    if (conDetalle.length === 0) return;

    doc.addPage();
    doc.fillColor('#000').fontSize(14).text('Anexo · detalle técnico');
    doc
      .moveDown(0.3)
      .fontSize(9)
      .fillColor('#666')
      .text(
        'Lo que registró el sistema al producir este informe, tal cual. Sirve para ' +
          'comprobarlo o para contárselo a quien lleve vuestros sistemas.',
      );

    for (const section of conDetalle) {
      doc.moveDown(0.9).fillColor('#000').fontSize(11).text(section.title);
      doc.moveDown(0.3);

      for (const row of section.rows) {
        doc.fontSize(9).fillColor('#333').text(`• ${row.primary}`);
        if (row.verbatim && row.verbatim !== row.primary) {
          doc.fontSize(9).fillColor('#666').text(`   ${row.verbatim}`);
        }
        doc.fontSize(9).fillColor('#888').text(`   ${row.technical}`);
        doc.moveDown(0.25);
      }
    }
  }
}
