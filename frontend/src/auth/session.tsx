import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { tokenManager } from './token-manager';
import type { RoleName, SessionUser } from '../api/types';

/**
 * Session context (RF-20 / RF-23).
 *
 * The active session is the single source of truth for protected routing and
 * for the navigation composition of each role. It mirrors the token manager,
 * which owns storage, proactive refresh and revocation on logout.
 */

export interface AuthState {
  user: SessionUser | null;
  roles: RoleName[];
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  roles: [],
  logout: async () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<SessionUser | null>(() => tokenManager.getUser());

  useEffect(() => {
    setUser(tokenManager.getUser());
    return tokenManager.subscribe((session) => setUser(session?.user ?? null));
  }, []);

  const logout = useCallback(async () => {
    await tokenManager.logout();
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, roles: user?.roles ?? [], logout }),
    [user, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/** Landing route of the active session, used by protected routing (RF-20). */
export function homePathFor(user: SessionUser | null): string {
  if (user === null) {
    return '/';
  }
  if (user.roles.includes('patient')) {
    return '/bookings';
  }
  if (user.roles.includes('professional') || user.roles.includes('staff')) {
    return '/agenda';
  }
  if (user.roles.includes('admin')) {
    return '/admin';
  }
  return '/';
}
