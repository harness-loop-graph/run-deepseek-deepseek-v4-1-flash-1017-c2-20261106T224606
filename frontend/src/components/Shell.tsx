import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { homePathFor, useAuth } from '../auth/session';
import type { RoleName } from '../api/types';

interface NavItem {
  to: string;
  label: string;
  testId: string;
  roles: RoleName[];
}

/**
 * RF-20 navigation contract: each role sees exactly the declared items and no
 * other `nav-*` item. Items are filtered by the active session's roles, and
 * the server re-checks every operation regardless of what is rendered.
 */
const NAV_ITEMS: NavItem[] = [
  { to: '/bookings', label: 'My appointments', testId: 'nav-bookings', roles: ['patient'] },
  { to: '/search', label: 'Find availability', testId: 'nav-search', roles: ['patient', 'staff'] },
  { to: '/agenda', label: 'Agenda', testId: 'nav-agenda', roles: ['professional', 'staff'] },
  {
    to: '/history',
    label: 'Clinical history',
    testId: 'nav-history',
    roles: ['patient', 'professional'],
  },
  { to: '/admin', label: 'Administration', testId: 'nav-admin', roles: ['admin'] },
  { to: '/audit', label: 'Audit log', testId: 'nav-audit', roles: ['admin'] },
];

function visibleItems(roles: RoleName[]): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.some((role) => roles.includes(role)));
}

export function Shell({ children }: { children?: ReactNode }): JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = user === null ? [] : visibleItems(user.roles);

  const onLogout = async (): Promise<void> => {
    await logout();
    navigate('/', { replace: true });
  };

  return (
    <div className="app">
      <header className="topbar">
        <Link to={homePathFor(user)} className="brand">
          MedApp
        </Link>
        {user !== null ? (
          <nav aria-label="Main navigation" className="nav">
            {items.map((item) => (
              <NavLink
                key={item.testId}
                to={item.to}
                data-testid={item.testId}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
        {user !== null ? (
          <div className="session">
            <span className="session-email" data-testid="session-email">
              {user.email}
            </span>
            <button type="button" className="link-button" onClick={onLogout} data-testid="logout">
              Sign out
            </button>
          </div>
        ) : null}
      </header>
      <main className="content">{children ?? <Outlet />}</main>
    </div>
  );
}
