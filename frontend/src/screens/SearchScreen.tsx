import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { describeError } from '../api/errors';
import { useAsync } from '../hooks/useAsync';
import { EmptyState, ErrorBanner, LoadingIndicator } from '../components/States';
import { addDays, formatDateTime, toIsoDate, today } from '../lib/dates';
import type { Professional, Slot } from '../api/types';

/**
 * SCR-03 — Availability search and booking.
 *
 * EP-06 lists the free slots of a professional for a date range; selecting a
 * `slot-item` and pressing `book-submit` books it through EP-07. The server
 * decides whether the slot is still free (409) and the error envelope is
 * displayed without hiding the underlying form (RF-21).
 */
export function SearchScreen(): JSX.Element {
  const professionals = useAsync<Professional[]>(useCallback(() => api.professionals(), []), []);
  const [professionalId, setProfessionalId] = useState('');
  const [from, setFrom] = useState(toIsoDate(today()));
  const [to, setTo] = useState(toIsoDate(addDays(today(), 7)));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ id: number; start: string } | null>(null);

  useEffect(() => {
    if (professionalId === '' && professionals.data !== null && professionals.data.length > 0) {
      setProfessionalId(String(professionals.data[0].id));
    }
  }, [professionals.data, professionalId]);

  const search = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSearchError(null);
    setBookingError(null);
    setBooked(null);
    setSelected(null);
    if (professionalId === '') {
      setSearchError('Select a professional.');
      return;
    }
    if (from === '' || to === '' || to < from) {
      setSearchError('The end date must be on or after the start date.');
      return;
    }
    setSearching(true);
    try {
      const result = await api.availability(Number.parseInt(professionalId, 10), from, to);
      setSlots(result);
    } catch (failure) {
      setSlots(null);
      setSearchError(describeError(failure));
    } finally {
      setSearching(false);
    }
  };

  const book = async (): Promise<void> => {
    setBookingError(null);
    setBooked(null);
    if (selected === null) {
      setBookingError('Select an available slot first.');
      return;
    }
    setBooking(true);
    try {
      const appointment = await api.bookAppointment(
        Number.parseInt(professionalId, 10),
        selected.start,
      );
      setBooked({ id: appointment.id, start: appointment.slotStart });
      setSelected(null);
      const result = await api.availability(Number.parseInt(professionalId, 10), from, to);
      setSlots(result);
    } catch (failure) {
      setBookingError(describeError(failure));
    } finally {
      setBooking(false);
    }
  };

  return (
    <section>
      <h1>Find availability</h1>
      {professionals.loading ? <LoadingIndicator label="Loading professionals…" /> : null}
      {professionals.error !== null ? <ErrorBanner message={professionals.error} /> : null}
      {professionals.data !== null && professionals.data.length === 0 ? (
        <EmptyState message="No professionals are registered." />
      ) : null}
      <form className="card form-grid" onSubmit={search}>
        <label htmlFor="search-professional">Professional</label>
        <select
          id="search-professional"
          data-testid="search-professional"
          value={professionalId}
          onChange={(event) => setProfessionalId(event.target.value)}
        >
          <option value="">Select a professional</option>
          {(professionals.data ?? []).map((professional) => (
            <option key={professional.id} value={professional.id}>
              {professional.nombre} {professional.apellidos} — {professional.especialidad}
            </option>
          ))}
        </select>
        <label htmlFor="search-from">From</label>
        <input
          id="search-from"
          type="date"
          data-testid="search-from"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <label htmlFor="search-to">To</label>
        <input
          id="search-to"
          type="date"
          data-testid="search-to"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <button type="submit" data-testid="search-submit" disabled={searching}>
          {searching ? 'Searching…' : 'Search availability'}
        </button>
      </form>
      {searchError !== null ? <ErrorBanner message={searchError} /> : null}
      {searching ? <LoadingIndicator label="Loading available slots…" /> : null}
      {bookingError !== null ? <ErrorBanner message={bookingError} /> : null}
      {booked !== null ? (
        <p className="state state-success" data-testid="booking-confirmation">
          Appointment {booked.id} confirmed for {formatDateTime(booked.start)}.
        </p>
      ) : null}
      {!searching && slots !== null && slots.length === 0 ? (
        <EmptyState message="No free slots in the selected range." />
      ) : null}
      {!searching && slots !== null && slots.length > 0 ? (
        <div className="slots">
          <h2>Available slots</h2>
          <ul className="slot-list">
            {slots.map((slot) => (
              <li key={slot.start}>
                <button
                  type="button"
                  data-testid="slot-item"
                  data-slot-start={slot.start}
                  className={selected?.start === slot.start ? 'slot selected' : 'slot'}
                  aria-pressed={selected?.start === slot.start}
                  onClick={() => setSelected(slot)}
                >
                  {formatDateTime(slot.start)}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            data-testid="book-submit"
            onClick={() => void book()}
            disabled={booking || selected === null}
          >
            {booking ? 'Booking…' : 'Book selected slot'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
