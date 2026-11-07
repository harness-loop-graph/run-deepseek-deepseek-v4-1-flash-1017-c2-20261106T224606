import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { EmptyState, ErrorBanner, LoadingIndicator } from '../components/States';
import { addDays, formatDateOnly, formatTime, toIsoDate, today } from '../lib/dates';
import type { AgendaDay } from '../api/types';

type ViewMode = 'day' | 'week';

/**
 * SCR-04 — Professional agenda, day and week views.
 *
 * On first render the agenda covers today through the next 7 days (EP-09).
 * Clicking an `appointment-item` opens SCR-05 for that appointment.
 */
export function AgendaScreen(): JSX.Element {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState<string>(toIsoDate(today()));

  const range = useMemo(() => {
    if (mode === 'day') {
      return { from: anchor, to: anchor };
    }
    return { from: anchor, to: toIsoDate(addDays(new Date(`${anchor}T00:00:00.000Z`), 7)) };
  }, [mode, anchor]);

  const load = useCallback(() => api.agenda(range.from, range.to), [range.from, range.to]);
  const { data, loading, error } = useAsync<AgendaDay[]>(load, [range.from, range.to]);

  const days = data ?? [];
  const total = days.reduce((count, day) => count + day.appointments.length, 0);

  return (
    <section>
      <header className="page-header">
        <h1>Agenda</h1>
        <div className="toolbar">
          <label htmlFor="agenda-view" className="inline-label">
            View
          </label>
          <select
            id="agenda-view"
            data-testid="agenda-view"
            value={mode}
            onChange={(event) => setMode(event.target.value === 'day' ? 'day' : 'week')}
          >
            <option value="week">Week</option>
            <option value="day">Day</option>
          </select>
          <label htmlFor="agenda-date" className="inline-label">
            {mode === 'day' ? 'Day' : 'Week starting'}
          </label>
          <input
            id="agenda-date"
            type="date"
            data-testid="agenda-date"
            value={anchor}
            onChange={(event) => setAnchor(event.target.value)}
          />
        </div>
      </header>
      <p className="hint">
        {mode === 'day' ? 'Day view' : 'Week view'} · {range.from} → {range.to}
      </p>
      {loading ? <LoadingIndicator label="Loading the agenda…" /> : null}
      {!loading && error !== null ? <ErrorBanner message={error} /> : null}
      {!loading && error === null && total === 0 ? (
        <EmptyState message="No appointments in this period." />
      ) : null}
      {!loading && error === null && total > 0 ? (
        <div className="agenda">
          {days.map((day) => (
            <section key={day.date} className="agenda-day">
              <h2>{formatDateOnly(day.date)}</h2>
              <ul className="list">
                {day.appointments.map((appointment) => (
                  <li
                    key={appointment.id}
                    className="list-item clickable"
                    data-testid="appointment-item"
                    data-appointment-id={appointment.id}
                    onClick={() => navigate(`/appointments/${appointment.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/appointments/${appointment.id}`);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div>
                      <p className="item-title">
                        {formatTime(appointment.slotStart)} · {appointment.patient.name}
                      </p>
                      <p className="item-subtitle">
                        {appointment.professional.name} · {appointment.status}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}
