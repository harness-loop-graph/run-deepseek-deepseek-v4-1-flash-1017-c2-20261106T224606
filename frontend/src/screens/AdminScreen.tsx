import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { describeError } from '../api/errors';
import { useAsync } from '../hooks/useAsync';
import { EmptyState, ErrorBanner, LoadingIndicator } from '../components/States';
import { formatDateTime } from '../lib/dates';
import type { AdminUser, Paginated, Professional, RoleName, Slot } from '../api/types';

const ROLES: RoleName[] = ['patient', 'professional', 'staff', 'admin'];

/** Converts a `datetime-local` value to the ISO-8601 UTC wire format. */
function toIso(value: string): string {
  return new Date(value).toISOString();
}

/** Converts an ISO-8601 timestamp to a `datetime-local` input value. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().slice(0, 16);
}

/**
 * SCR-07 — Administration: availability, users, roles (EP-15..EP-18).
 *
 * Every mutation is followed by a reload of the affected list so the screen
 * always shows the server state, and the server error envelope is displayed.
 */
export function AdminScreen(): JSX.Element {
  const [page, setPage] = useState(1);
  const loadUsers = useCallback(() => api.adminUsers(page, 20), [page]);
  const users = useAsync<Paginated<AdminUser>>(loadUsers, [page]);

  const professionals = useAsync<Professional[]>(
    useCallback(() => api.adminProfessionals(), []),
    [],
  );

  const [email, setEmail] = useState('');
  const [newRoles, setNewRoles] = useState<RoleName[]>(['patient']);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [roleDrafts, setRoleDrafts] = useState<Record<number, RoleName[]>>({});
  const [roleError, setRoleError] = useState<string | null>(null);
  const [savingRoles, setSavingRoles] = useState<number | null>(null);

  const [professionalId, setProfessionalId] = useState<string>('');
  const [slotRows, setSlotRows] = useState<Array<{ start: string; end: string }>>([]);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [availabilitySaved, setAvailabilitySaved] = useState(false);
  const [savingAvailability, setSavingAvailability] = useState(false);

  useEffect(() => {
    if (professionalId === '' && professionals.data !== null && professionals.data.length > 0) {
      setProfessionalId(String(professionals.data[0].id));
    }
  }, [professionals.data, professionalId]);

  const loadAvailability = useCallback(async () => {
    if (professionalId === '') {
      setSlotRows([]);
      return;
    }
    const slots: Slot[] = await api.professionalAvailability(Number.parseInt(professionalId, 10));
    setSlotRows(slots.map((slot) => ({ start: toLocalInput(slot.start), end: toLocalInput(slot.end) })));
  }, [professionalId]);

  useEffect(() => {
    setAvailabilityError(null);
    setAvailabilitySaved(false);
    loadAvailability().catch((failure: unknown) => setAvailabilityError(describeError(failure)));
  }, [loadAvailability]);

  const toggleRole = (role: RoleName, current: RoleName[]): RoleName[] =>
    current.includes(role) ? current.filter((item) => item !== role) : [...current, role];

  const createUser = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setCreateError(null);
    if (email.trim() === '' || newRoles.length === 0) {
      setCreateError('An email and at least one role are required.');
      return;
    }
    setCreating(true);
    try {
      await api.createUser(email.trim(), newRoles);
      setEmail('');
      setNewRoles(['patient']);
      users.reload();
    } catch (failure) {
      setCreateError(describeError(failure));
    } finally {
      setCreating(false);
    }
  };

  const saveRoles = async (user: AdminUser): Promise<void> => {
    const roles = roleDrafts[user.id] ?? user.roles;
    setRoleError(null);
    if (roles.length === 0) {
      setRoleError('At least one role is required.');
      return;
    }
    setSavingRoles(user.id);
    try {
      await api.updateUserRoles(user.id, roles);
      users.reload();
    } catch (failure) {
      setRoleError(describeError(failure));
    } finally {
      setSavingRoles(null);
    }
  };

  const saveAvailability = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setAvailabilityError(null);
    setAvailabilitySaved(false);
    if (professionalId === '') {
      setAvailabilityError('Select a professional.');
      return;
    }
    const slots = slotRows
      .filter((row) => row.start !== '' && row.end !== '')
      .map((row) => ({ start: toIso(row.start), end: toIso(row.end) }));
    setSavingAvailability(true);
    try {
      await api.replaceAvailability(Number.parseInt(professionalId, 10), slots);
      setAvailabilitySaved(true);
      await loadAvailability();
    } catch (failure) {
      setAvailabilityError(describeError(failure));
    } finally {
      setSavingAvailability(false);
    }
  };

  return (
    <section>
      <h1>Administration</h1>

      <section className="card">
        <h2>Users</h2>
        <form className="form-grid" onSubmit={createUser}>
          {createError !== null ? <ErrorBanner message={createError} /> : null}
          <label htmlFor="admin-user-email">Email</label>
          <input
            id="admin-user-email"
            type="email"
            data-testid="admin-user-email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <fieldset className="roles">
            <legend>Roles</legend>
            {ROLES.map((role) => (
              <label key={role} className="checkbox">
                <input
                  type="checkbox"
                  data-testid={`admin-role-${role}`}
                  checked={newRoles.includes(role)}
                  onChange={() => setNewRoles((current) => toggleRole(role, current))}
                />
                {role}
              </label>
            ))}
          </fieldset>
          <button type="submit" data-testid="admin-user-submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create user'}
          </button>
        </form>

        {users.loading ? <LoadingIndicator label="Loading users…" /> : null}
        {!users.loading && users.error !== null ? <ErrorBanner message={users.error} /> : null}
        {roleError !== null ? <ErrorBanner message={roleError} /> : null}
        {!users.loading && users.error === null && users.data !== null && users.data.items.length === 0 ? (
          <EmptyState message="No users registered." />
        ) : null}
        {users.data !== null && users.data.items.length > 0 ? (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Id</th>
                  <th>Email</th>
                  <th>Active</th>
                  <th>Roles</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((user) => {
                  const draft = roleDrafts[user.id] ?? user.roles;
                  return (
                    <tr key={user.id} data-testid="admin-user-item" data-user-id={user.id}>
                      <td>{user.id}</td>
                      <td>{user.email}</td>
                      <td>{user.active ? 'yes' : 'no'}</td>
                      <td>
                        <div className="roles">
                          {ROLES.map((role) => (
                            <label key={role} className="checkbox">
                              <input
                                type="checkbox"
                                checked={draft.includes(role)}
                                onChange={() =>
                                  setRoleDrafts((current) => ({
                                    ...current,
                                    [user.id]: toggleRole(role, draft),
                                  }))
                                }
                              />
                              {role}
                            </label>
                          ))}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          data-testid="admin-save-roles"
                          onClick={() => void saveRoles(user)}
                          disabled={savingRoles === user.id}
                        >
                          {savingRoles === user.id ? 'Saving…' : 'Save roles'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="pagination">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span>
                Page {users.data.page} · {users.data.total} users
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => current + 1)}
                disabled={users.data.page * users.data.pageSize >= users.data.total}
              >
                Next
              </button>
            </div>
          </>
        ) : null}
      </section>

      <section className="card">
        <h2>Availability</h2>
        {professionals.loading ? <LoadingIndicator label="Loading professionals…" /> : null}
        {professionals.error !== null ? <ErrorBanner message={professionals.error} /> : null}
        <form className="form-grid" onSubmit={saveAvailability}>
          <label htmlFor="admin-professional">Professional</label>
          <select
            id="admin-professional"
            data-testid="admin-professional"
            value={professionalId}
            onChange={(event) => setProfessionalId(event.target.value)}
          >
            <option value="">Select a professional</option>
            {(professionals.data ?? []).map((professional) => (
              <option key={professional.id} value={professional.id}>
                {professional.nombre} {professional.apellidos}
              </option>
            ))}
          </select>
          {availabilityError !== null ? <ErrorBanner message={availabilityError} /> : null}
          {availabilitySaved ? (
            <p className="state state-success" data-testid="availability-confirmation">
              Availability replaced.
            </p>
          ) : null}
          {slotRows.length === 0 ? (
            <EmptyState message="No availability slots. Add one below." />
          ) : null}
          {slotRows.map((row, index) => (
            <div key={index} className="slot-row">
              <label className="inline-label" htmlFor={`slot-start-${index}`}>
                Start
              </label>
              <input
                id={`slot-start-${index}`}
                type="datetime-local"
                data-testid="availability-start"
                value={row.start}
                onChange={(event) =>
                  setSlotRows((current) =>
                    current.map((item, position) =>
                      position === index ? { ...item, start: event.target.value } : item,
                    ),
                  )
                }
              />
              <label className="inline-label" htmlFor={`slot-end-${index}`}>
                End
              </label>
              <input
                id={`slot-end-${index}`}
                type="datetime-local"
                data-testid="availability-end"
                value={row.end}
                onChange={(event) =>
                  setSlotRows((current) =>
                    current.map((item, position) =>
                      position === index ? { ...item, end: event.target.value } : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                onClick={() =>
                  setSlotRows((current) => current.filter((_item, position) => position !== index))
                }
              >
                Remove
              </button>
            </div>
          ))}
          <div className="toolbar">
            <button
              type="button"
              data-testid="availability-add"
              onClick={() =>
                setSlotRows((current) => [
                  ...current,
                  { start: '', end: '' },
                ])
              }
            >
              Add slot
            </button>
            <button type="submit" data-testid="availability-submit" disabled={savingAvailability}>
              {savingAvailability ? 'Saving…' : 'Replace availability'}
            </button>
          </div>
        </form>
        <p className="hint">
          Existing availability is shown for the selected professional; the submission replaces the
          whole set, as EP-18 specifies.
        </p>
      </section>

      <section className="card">
        <h2>Roles</h2>
        <ul className="list">
          {ROLES.map((role) => (
            <li key={role} className="list-item">
              <span>{role}</span>
              <span className="item-subtitle">
                {(users.data?.items ?? []).filter((user) => user.roles.includes(role)).length} users on
                this page
              </span>
            </li>
          ))}
        </ul>
        <p className="hint">
          Last user update: {users.data?.items[0] !== undefined
            ? formatDateTime(users.data.items[0].createdAt)
            : 'n/a'}
        </p>
      </section>
    </section>
  );
}
