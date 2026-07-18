import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/** Inyecta req.organization (adjuntado por OrgRoleGuard) en el handler del controller. */
export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.organization;
  },
);
