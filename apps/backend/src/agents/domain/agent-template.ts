import { AgentTemplateVisibility } from '@businessbrain/database';
import {
  parseAgentConfiguration,
  type AgentConfiguration,
} from './agent-configuration';

/**
 * Reglas de uso de un `AgentTemplate` — BUSINESSBRAIN_MIGRATION_PLAN.md §7.4, subfase 5.7.
 *
 * Una plantilla NO es documentación: instalarla crea un `Agent` con capacidades,
 * herramientas y permisos ya concedidos. Por eso "quién puede usar esta plantilla" es una
 * decisión de autorización, no una preferencia de presentación, y vive aquí como dominio
 * puro: sin base de datos, sin red, determinista y explicando siempre el motivo.
 *
 * **Fase 5 no distribuye plantillas.** El modelo soporta `PUBLIC` y `publisherOrgId = null`
 * como groundwork del marketplace (§1121), pero el marketplace no existe todavía: no hay
 * moderación, ni revisión de contenido, ni forma de que una organización responda por lo que
 * publica. Instalar una plantilla ajena sería aceptar un system prompt y una lista de
 * herramientas escritos por alguien de fuera del tenant. Mientras eso no tenga gobierno,
 * la respuesta es no — y es un "no" de código, no de configuración.
 */

export type TemplateUsageDenialReason =
  /** Pertenece a otra organización. Aplica también a `PUBLIC`: cross-org no existe en Fase 5. */
  | 'CROSS_ORG_TEMPLATE'
  /** Plantilla de plataforma (`publisherOrgId = null`): es distribución pública, aún sin gobierno. */
  | 'PLATFORM_TEMPLATE_NOT_DISTRIBUTED';

export type TemplateUsageDecision =
  | { allowed: true; visibility: AgentTemplateVisibility }
  | { allowed: false; reason: TemplateUsageDenialReason; explanation: string };

export interface TemplateUsageRequest {
  /** `null` = plantilla first-party de plataforma. */
  publisherOrgId: string | null;
  visibility: AgentTemplateVisibility;
  /** Organización activa que pretende ver o instalar la plantilla. */
  requestingOrganizationId: string;
}

/**
 * Decide si una organización puede ver e instalar una plantilla.
 *
 * Nunca lanza: quien llama necesita poder registrar POR QUÉ se denegó, no solo que se
 * denegó. La traducción a un código HTTP es responsabilidad de la capa de aplicación.
 *
 * Dentro de la propia organización las tres visibilidades se comportan igual, y eso es
 * deliberado: `PRIVATE` ya significa "solo dentro de esta organización", `ORGANIZATION`
 * significa lo mismo de forma explícita, y `PUBLIC` no añade ningún alcance en esta fase
 * porque no hay a dónde publicar. Lo que separa una visibilidad de otra en Fase 5 es la
 * intención declarada de cara al marketplace futuro, no el permiso efectivo de hoy.
 */
export function evaluateTemplateUsage(
  request: TemplateUsageRequest,
): TemplateUsageDecision {
  if (request.publisherOrgId === null) {
    return {
      allowed: false,
      reason: 'PLATFORM_TEMPLATE_NOT_DISTRIBUTED',
      explanation:
        'Las plantillas de plataforma no se distribuyen en la Fase 5: requieren el ' +
        'gobierno del marketplace (moderación y revisión de contenido), que no existe todavía',
    };
  }

  if (request.publisherOrgId !== request.requestingOrganizationId) {
    return {
      allowed: false,
      reason: 'CROSS_ORG_TEMPLATE',
      explanation:
        'La plantilla pertenece a otra organización. La distribución entre ' +
        'organizaciones (incluida la visibilidad PUBLIC) no está disponible en la Fase 5',
    };
  }

  return { allowed: true, visibility: request.visibility };
}

/**
 * Configuración que produciría instalar esta plantilla.
 *
 * **El JSON de la plantilla no se copia: se vuelve a validar.** Pasa por las MISMAS
 * invariantes de la subfase 5.1 que cualquier agente creado a mano. Una plantilla es un
 * `Json` libre que pudo escribirse con otra versión del catálogo de herramientas, o
 * directamente contra la base de datos; confiar en ella sería dejar que el `Agent`
 * resultante nazca con una herramienta inexistente o con `send_email` declarado `READ_ONLY`
 * — exactamente la mentira que el gate de políticas usaría para dejar pasar la llamada.
 *
 * `AgentTemplate` no declara memoria ni guardrails propios. La ausencia se resuelve con los
 * defaults de 5.1 (sin memoria, sin herramientas, tope de llamadas por turno), no
 * heredando nada implícito: lo que la plantilla no concede, el agente no lo tiene.
 */
export function templateDefaultsToConfiguration(template: {
  defaultCapabilities: unknown;
  defaultTools: unknown;
}): AgentConfiguration {
  return parseAgentConfiguration({
    capabilities: template.defaultCapabilities,
    tools: template.defaultTools,
  });
}
