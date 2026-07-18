import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Usado solo en POST /auth/login: delega la validación de email/password en LocalStrategy. */
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {}
