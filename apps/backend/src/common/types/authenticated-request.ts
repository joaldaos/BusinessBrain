import type { Request } from 'express';
import type { MembershipRole, PlatformRole } from '@businessbrain/database';

/** Lo que JwtStrategy.validate() adjunta a req.user tras verificar el access token. */
export interface RequestUser {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole;
  memberships: Array<{ organizationId: string; role: MembershipRole }>;
}

/** Lo que OrgRoleGuard adjunta a req.organization tras resolver la organización activa. */
export interface RequestOrganization {
  id: string;
  slug: string;
  role: MembershipRole;
}

export interface AuthenticatedRequest extends Request {
  user: RequestUser;
  organization?: RequestOrganization;
}
