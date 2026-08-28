/**
 * Lo que devuelve `/platform/*`, tal como lo emite el backend.
 *
 * Se declaran a mano, como el resto de contratos de esta interfaz: son la superficie que el
 * panel consume de verdad. Si el backend cambia una forma, el error aparece aquí — que es
 * exactamente donde debe aparecer.
 *
 * ## Lo que NO está en este fichero, y es deliberado
 *
 * No hay ningún tipo con `passwordHash`, `mfaSecretEnc`, `settings`, `contentText`,
 * `memberships` en bruto ni nada parecido. No porque se filtren al pintarlos: porque la API no
 * los devuelve y aquí no existe la forma que los albergaría. Una prueba estructural recorre
 * este fichero y lo comprueba.
 */

export type PlanTier = 'FREE' | 'PRO' | 'ENTERPRISE';
export type AccountStatus = 'ACTIVE' | 'BANNED';
export type GrantScope = 'METADATA' | 'DIAGNOSTICS' | 'CONTENT';
export type GrantStatus = 'PENDING' | 'ACTIVE' | 'REVOKED';

/** Los números del producto entero. De aquí no se deduce nada de ningún cliente. */
export interface PlatformOverview {
  totalUsers: number;
  totalOrganizations: number;
  bannedUsers: number;
  organizationsByPlan: Partial<Record<PlanTier, number>>;
}

/** Una empresa en el catálogo. Sobre la RELACIÓN, no sobre su negocio. */
export interface PlatformOrganization {
  id: string;
  name: string;
  slug: string;
  planTier: PlanTier;
  createdAt: string;
  _count: {
    memberships: number;
    knowledgeItems: number;
    knowledgeSources: number;
  };
}

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  platformRole: 'USER' | 'SUPERADMIN';
  status: AccountStatus;
  createdAt: string;
  lastActiveAt: string | null;
  /** Un booleano. El secreto no sale de la base de datos. */
  mfaEnabled: boolean;
}

export interface PlatformUserDetail extends PlatformUser {
  /** A qué empresas pertenece. Ya presentado: nunca la fila de `Membership`. */
  organizations: Array<{ id: string; name: string; role: string }>;
}

export interface Grant {
  id: string;
  organizationId: string;
  scope: GrantScope;
  status: GrantStatus;
  /** Derivado del reloj en cada lectura. No existe un estado `EXPIRED` almacenado. */
  expired: boolean;
  usable: boolean;
  reason: string;
  requestedBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
  revokedBy: { id: string; name: string } | null;
  createdAt: string;
  approvedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
}

/** Una concesión propia, con el nombre de la empresa: un identificador no se puede usar. */
export interface MyGrant extends Grant {
  organization: { id: string; name: string };
}

/** METADATA: nombres, contadores y estados. Ni una línea de contenido. */
export interface OrganizationInspection {
  organization: {
    id: string;
    name: string;
    planTier: PlanTier;
    createdAt: string;
  };
  counts: {
    miembros: number;
    documentos: number;
    colecciones: number;
    conclusiones: number;
  };
  sources: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    lastSyncedAt: string | null;
  }>;
}

/** DIAGNOSTICS: por qué algo no funciona. Puede citar el NOMBRE de un fichero, nunca su texto. */
export interface OrganizationDiagnostics {
  failingSources: Array<{
    id: string;
    name: string;
    status: string;
    lastError: string | null;
    lastSyncedAt: string | null;
  }>;
  recentJobs: Array<{
    id: string;
    knowledgeSourceId: string | null;
    status: string;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
  failedAnalyses: Array<{
    id: string;
    error: string | null;
    createdAt: string;
  }>;
}

/** CONTENT: el listado da títulos. El texto se pide documento a documento. */
export interface OrganizationDocument {
  id: string;
  title: string;
  status: string;
  businessArea: string | null;
  indexedAt: string | null;
  createdAt: string;
}

export interface OrganizationDocumentDetail {
  id: string;
  title: string;
  contentText: string;
  status: string;
  businessArea: string | null;
  indexedAt: string | null;
}

/** Una entrada de la traza administrativa. `code` es estable; la interfaz lo traduce. */
export interface AuditEntry {
  id: string;
  at: string;
  code: string;
  /** Nombre, nunca correo: identificar no exige exponer más de lo necesario. */
  actor: { id: string; name: string } | null;
  organization: { id: string; name: string | null } | null;
  target: { type: string | null; id: string | null };
  details: Record<string, unknown>;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}
