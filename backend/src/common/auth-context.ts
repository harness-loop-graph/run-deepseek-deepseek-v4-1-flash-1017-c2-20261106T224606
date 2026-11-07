import type { RoleName } from '../config/config';

export interface AuthContext {
  userId: number;
  email: string;
  roles: RoleName[];
}

export interface RequestWithAuth {
  auth?: AuthContext;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  path: string;
}
