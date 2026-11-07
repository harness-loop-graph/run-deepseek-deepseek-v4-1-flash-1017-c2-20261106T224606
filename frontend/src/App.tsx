import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { RequireAuth, RequireRole } from './routes/guards';
import { LoginScreen } from './screens/LoginScreen';
import { AuthCallbackScreen } from './screens/AuthCallbackScreen';
import { BookingsScreen } from './screens/BookingsScreen';
import { SearchScreen } from './screens/SearchScreen';
import { AgendaScreen } from './screens/AgendaScreen';
import { AppointmentDetailScreen } from './screens/AppointmentDetailScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { AdminScreen } from './screens/AdminScreen';
import { AuditScreen } from './screens/AuditScreen';
import { NotFoundScreen } from './screens/NotFoundScreen';

/**
 * Route table of the eight screens (RF-19) with protected routing (RF-20).
 * Unauthenticated visitors only reach SCR-01; every other route is guarded by
 * session and role.
 */
export function App(): JSX.Element {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Shell>
            <LoginScreen />
          </Shell>
        }
      />
      <Route
        path="/auth/callback"
        element={
          <Shell>
            <AuthCallbackScreen />
          </Shell>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route
          path="/bookings"
          element={
            <RequireRole roles={['patient']}>
              <BookingsScreen />
            </RequireRole>
          }
        />
        <Route
          path="/search"
          element={
            <RequireRole roles={['patient', 'staff']}>
              <SearchScreen />
            </RequireRole>
          }
        />
        <Route
          path="/agenda"
          element={
            <RequireRole roles={['professional', 'staff']}>
              <AgendaScreen />
            </RequireRole>
          }
        />
        <Route
          path="/appointments/:id"
          element={
            <RequireRole roles={['patient', 'professional', 'staff']}>
              <AppointmentDetailScreen />
            </RequireRole>
          }
        />
        <Route
          path="/history"
          element={
            <RequireRole roles={['patient', 'professional']}>
              <HistoryScreen />
            </RequireRole>
          }
        />
        <Route
          path="/history/:patientId"
          element={
            <RequireRole roles={['professional']}>
              <HistoryScreen />
            </RequireRole>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireRole roles={['admin']}>
              <AdminScreen />
            </RequireRole>
          }
        />
        <Route
          path="/audit"
          element={
            <RequireRole roles={['admin']}>
              <AuditScreen />
            </RequireRole>
          }
        />
      </Route>
      <Route
        path="/login"
        element={<Navigate to="/" replace />}
      />
      <Route
        path="*"
        element={
          <Shell>
            <NotFoundScreen />
          </Shell>
        }
      />
    </Routes>
  );
}
