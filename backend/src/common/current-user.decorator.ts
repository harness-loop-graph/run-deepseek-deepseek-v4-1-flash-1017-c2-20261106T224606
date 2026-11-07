import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthContext } from './auth-context';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<{ auth?: AuthContext }>();
    if (!request.auth) {
      throw new Error('CurrentUser used on an unauthenticated route');
    }
    return request.auth;
  },
);
