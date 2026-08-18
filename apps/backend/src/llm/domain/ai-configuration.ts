import { LlmProviderName } from '@businessbrain/database';

/**
 * Qué puede configurar una empresa como proveedor de IA — dominio puro.
 *
 * ## Por qué el catálogo es CERRADO y hoy tiene un solo elemento
 *
 * `LlmProviderName` admite cinco proveedores y el código implementa dos: Anthropic conversa,
 * OpenAI conversa **y vectoriza**. Vectorizar no es opcional: sin vectores, lo que una empresa
 * sube no se puede preguntar, que es el producto entero.
 *
 * Ofrecer Anthropic obligaría a pedirle a una PYME dos claves de dos proveedores distintos en
 * sus primeros diez minutos, una para responder y otra para poder buscar, y a explicarle por
 * qué. Eso no es una limitación técnica que haya que exponer: es complejidad nuestra trasladada
 * al cliente. Mientras solo un proveedor cubra las dos capacidades, la elección no aporta nada.
 *
 * No se elimina ninguna capacidad: el registro sigue soportando Anthropic, un perfil de
 * plataforma puede usarlo y añadirlo aquí el día que haya embeddings equivalentes es una línea.
 */

export interface ConfigurableProvider {
  provider: LlmProviderName;
  /** Cómo se llama para una persona que no sabe qué es un proveedor de modelos. */
  label: string;
  /** Modelo que se usa si la empresa no dice otra cosa. */
  defaultModel: string;
  /** Dónde consigue su clave, para no dejarla buscando. */
  helpUrl: string;
  keyPrefixHint: string;
}

export const CONFIGURABLE_PROVIDERS: readonly ConfigurableProvider[] = [
  {
    provider: LlmProviderName.OPENAI,
    label: 'OpenAI',
    defaultModel: 'gpt-4.1-mini',
    helpUrl: 'https://platform.openai.com/api-keys',
    keyPrefixHint: 'sk-',
  },
] as const;

export function isConfigurableProvider(
  value: string,
): value is LlmProviderName {
  return CONFIGURABLE_PROVIDERS.some((entry) => entry.provider === value);
}

export function providerCatalogEntry(
  provider: LlmProviderName,
): ConfigurableProvider | undefined {
  return CONFIGURABLE_PROVIDERS.find((entry) => entry.provider === provider);
}

/**
 * De dónde sale la IA que está usando la organización AHORA.
 *
 * Se distingue explícitamente porque cambia quién paga y quién puede arreglar un fallo: con
 * `PROPIA`, la empresa; con `PLATAFORMA`, nosotros. Decir solo "configurada" dejaría a una PYME
 * sin saber si la factura del modelo es suya.
 */
export type AiConfigurationOrigin = 'PROPIA' | 'PLATAFORMA' | 'SIN_CONFIGURAR';

export interface AiConfigurationStatus {
  origin: AiConfigurationOrigin;
  /** `true` cuando BusinessBrain puede leer documentos y responder preguntas. */
  ready: boolean;
  provider: LlmProviderName | null;
  modelName: string | null;
  /** Nunca la clave: solo si existe una propia. */
  hasOwnKey: boolean;
  /** Qué significa el estado, en una frase, para quien no es técnico. */
  explanation: string;
}

export function describeConfiguration(params: {
  own: { provider: LlmProviderName; modelName: string; hasKey: boolean } | null;
  platformAvailable: boolean;
  platformProvider?: LlmProviderName | null;
  platformModel?: string | null;
}): AiConfigurationStatus {
  if (params.own) {
    return {
      origin: 'PROPIA',
      ready: true,
      provider: params.own.provider,
      modelName: params.own.modelName,
      hasOwnKey: params.own.hasKey,
      explanation: params.own.hasKey
        ? 'BusinessBrain usa la clave de tu empresa. El consumo se factura en tu cuenta del ' +
          'proveedor.'
        : 'Tu empresa tiene un modelo elegido, pero usa la clave incluida en el servicio.',
    };
  }

  if (params.platformAvailable) {
    return {
      origin: 'PLATAFORMA',
      ready: true,
      provider: params.platformProvider ?? null,
      modelName: params.platformModel ?? null,
      hasOwnKey: false,
      explanation:
        'BusinessBrain está usando la inteligencia artificial incluida en el servicio. ' +
        'Puedes poner la clave de tu empresa si prefieres usar tu propia cuenta.',
    };
  }

  return {
    origin: 'SIN_CONFIGURAR',
    ready: false,
    provider: null,
    modelName: null,
    hasOwnKey: false,
    explanation:
      'Falta configurar la inteligencia artificial. Sin ella BusinessBrain no puede leer tus ' +
      'documentos ni responder preguntas.',
  };
}
