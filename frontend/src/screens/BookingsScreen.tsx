import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { describeError } from '../api/errors';
import { useAsync } from '../hooks/useAsync';
import { EmptyState, ErrorBanner, LoadingIndicator } from '../components/States';
import { formatDateTime } from '../lib/dates';
import type { Appointment } from '../api/types';

/**
 * SCR-02 — Patient portal: own appointments.
 *
 * The list is fetched from EP-05, so the server enforces that only the
 * patient's own appointments are returned (RF-10). Cancellation goes through
 * EP-08 and renders `cancel-appointment` inside each `appointment-item`.
 */
export function BookingsScreen(): JSX.Element {
  const load = useCallback(() => api.myAppointments(), []);
  const { data, loading, error, reload } = useAsync<Appointment[]>(load, []);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);

  // SCR-02 lists the patient's active appointments: a cancelled booking is no
  // longer part of the portal and disappears from the list right after EP-08.
  const appointments = (data ?? []).filter((appointment) => appointment.status !== 'cancelled');

  const cancel = async (id: number): Promise<void> => {
    setActionError(null);
    setCancelling(id);
    try {
      await api.cancelAppointment(id);
      reload();
    } catch (failure) {
      setActionError(describeError(failure));
    } finally {
      setCancelling(null);
    }
  };

  return (
    <section>
      <header className="page-header">
        <h1>My appointments</h1>
        <Link to="/search" className="button-link">
          Book an appointment
        </Link>
      </header>
      {actionError !== null ? <ErrorBanner message={actionError} /> : null}
      {loading ? <LoadingIndicator label="Loading your appointments…" /> : null}
      {!loading && error !== null ? <ErrorBanner message={error} /> : null}
      {!loading && error === null && data !== null && appointments.length === 0 ? (
        <EmptyState message="You have no appointments yet." />
      ) : null}
      {!loading && error === null && data !== null && appointments.length > 0 ? (
        <ul className="list">
          {appointments.map((appointment) => (
            <li
              key={appointment.id}
              className="list-item"
              data-testid="appointment-item"
              data-appointment-id={appointment.id}
            >
              <div>
                <p className="item-title">
                  {formatDateTime(appointment.slotStart)} · {appointment.professional.name}
                </p>
                <p className="item-subtitle">
                  {appointment.professional.specialty} · status: {appointment.status}
                </p>
              </div>
              <div className="item-actions">
                <Link to={`/appointments/${appointment.id}`}>Details</Link>
                {appointment.status !== 'cancelled' ? (
                  <button
                    type="button"
                    data-testid="cancel-appointment"
                    onClick={() => void cancel(appointment.id)}
                    disabled={cancelling === appointment.id}
                  >
                    {cancelling === appointment.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
