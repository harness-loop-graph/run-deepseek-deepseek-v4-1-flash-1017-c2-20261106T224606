import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';
import { unauthorized, forbidden } from './errors';
import { TokenService } from './token.service';
import type { RoleName } from '../config/config';
import type { AuthContext } from './auth-context';

type RequestWithAuth = Request & { auth?: AuthContext };

export const AUDIT_READ_KEY = 'auditClinicalRead';
export const AuditClinicalRead = (): MethodDecorator => SetMetadata(AUDIT_READ_KEY, true);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    const requiredRoles =
      this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, targets) ?? [];

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const header = request.headers.authorization;
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw || !raw.toLowerCase().startsWith('bearer ')) {
      throw unauthorized();
    }
    const token = raw.slice(7).trim();
    if (token.length === 0) {
      throw unauthorized();
    }

    const session = await this.tokenService.findByAccessToken(token);
    if (session === null) {
      throw unauthorized('Invalid or expired access token');
    }

    request.auth = {
      userId: session.userId,
      email: session.email,
      roles: session.roles as RoleName[],
    };

    if (requiredRoles.length > 0) {
      const allowed = requiredRoles.some((role) => request.auth!.roles.includes(role));
      if (!allowed) {
        throw forbidden();
      }
    }
    return true;
  }
}
