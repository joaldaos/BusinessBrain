import {
  externalAlertText,
  internalAlertText,
  type OperationalAlert,
} from './operational-alert';

describe('avisos operativos', () => {
  const alerta: OperationalAlert = {
    kind: 'sync-failed',
    organizationId: 'org-123',
    targetId: 'fuente-456',
    // Un error de ingesta cita el título del documento que falló. Es exactamente el caso que
    // no puede salir del despliegue.
    detail: 'Fallo al procesar "Contrato con Distribuciones Ruiz": timeout',
  };

  describe('lo que sale a un canal externo', () => {
    it('CRÍTICO: no lleva el mensaje de error', () => {
      const texto = externalAlertText(alerta);

      expect(texto).not.toContain('Distribuciones Ruiz');
      expect(texto).not.toContain('timeout');
    });

    it('lleva los identificadores para poder ir a mirar', () => {
      const texto = externalAlertText(alerta);

      expect(texto).toContain('org-123');
      expect(texto).toContain('fuente-456');
      expect(texto).toMatch(/sincronizaci/i);
    });

    it('dice cuántas veces seguidas cuando son varias', () => {
      expect(
        externalAlertText({
          ...alerta,
          kind: 'source-failing-repeatedly',
          consecutiveFailures: 3,
        }),
      ).toContain('3 veces seguidas');
    });

    it('no dice "1 vez seguida"', () => {
      expect(
        externalAlertText({ ...alerta, consecutiveFailures: 1 }),
      ).not.toMatch(/veces seguidas/);
    });
  });

  describe('lo que se queda en el registro del servidor', () => {
    it('sí lleva el detalle: es lo que se va a mirar', () => {
      expect(internalAlertText(alerta)).toContain('Distribuciones Ruiz');
    });
  });
});
