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
          doc.fontSize(9).fillColor('#666').text(`  ${row.secondary}`);
          doc.moveDown(0.3);
        }
      }

      doc.end();
    });
  }
}
