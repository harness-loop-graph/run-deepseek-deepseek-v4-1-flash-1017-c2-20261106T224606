import { Navigate, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import { homePathFor, useAuth } from '../auth/session';
import type { RoleName } from '../api/types';

/**
 * RF-20: unauthenticated access to any SCR-02..08 redirects to SCR-01, and a
 * route that is not allowed for the active role redirects to that role's home
 * screen instead of rendering a hidden-but-mounted composition.
 */
export function RequireAuth({ children }: { children?: ReactNode }): JSX.Element {
  const { user } = useAuth();
  if (user === null) {
    return <Navigate to="/" replace />;
  }
  return <>{children ?? <Outlet />}</>;
}

export function RequireRole({
  roles,
  children,
}: {
  roles: RoleName[];
  children?: ReactNode;
}): JSX.Element {
  const { user } = useAuth();
  if (user === null) {
    return <Navigate to="/" replace />;
  }
  const allowed = roles.some((role) => user.roles.includes(role));
  if (!allowed) {
    return <Navigate to={homePathFor(user)} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}
