import { useCallback, useState } from 'react';
import { api } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { EmptyState, ErrorBanner, LoadingIndicator } from '../components/States';
import { formatDateTime } from '../lib/dates';
import type { AuditEntry, Paginated } from '../api/types';

/**
 * SCR-08 — Audit log query (EP-19).
 *
 * Filters are sent to the server, which owns the query and the pagination;
 * the screen only renders the returned page and the error envelope.
 */
export function AuditScreen(): JSX.Element {
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState<{
    actor: string;
    action: string;
    from: string;
    to: string;
    page: number;
  }>({ actor: '', action: '', from: '', to: '', page: 1 });
  const [validationError, setValidationError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api.audit({
        actor: applied.actor === '' ? undefined : applied.actor,
        action: applied.action === '' ? undefined : applied.action,
        from: applied.from === '' ? undefined : applied.from,
        to: applied.to === '' ? undefined : applied.to,
        page: applied.page,
        pageSize: 20,
      }),
    [applied],
  );
  const audit = useAsync<Paginated<AuditEntry>>(load, [applied]);

  const search = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (from !== '' && to !== '' && to < from) {
      setValidationError('The end date must be on or after the start date.');
      return;
    }
    setValidationError(null);
    setApplied({ actor, action, from, to, page: 1 });
  };

  return (
    <section>
      <h1>Audit log</h1>
      <form className="card form-grid" onSubmit={search}>
        <label htmlFor="audit-actor">Actor (email or id)</label>
        <input
          id="audit-actor"
          data-testid="audit-actor"
          value={actor}
          onChange={(event) => setActor(event.target.value)}
        />
        <label htmlFor="audit-action">Action</label>
        <input
          id="audit-action"
          data-testid="audit-action"
          value={action}
          onChange={(event) => setAction(event.target.value)}
        />
        <label htmlFor="audit-from">From</label>
        <input
          id="audit-from"
          type="date"
          data-testid="audit-from"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <label htmlFor="audit-to">To</label>
        <input
          id="audit-to"
          type="date"
          data-testid="audit-to"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <button type="submit" data-testid="audit-submit">
          Search
        </button>
      </form>
      {validationError !== null ? <ErrorBanner message={validationError} /> : null}
      {audit.loading ? <LoadingIndicator label="Loading the audit log…" /> : null}
      {!audit.loading && audit.error !== null ? <ErrorBanner message={audit.error} /> : null}
      {!audit.loading &&
      audit.error === null &&
      audit.data !== null &&
      audit.data.items.length === 0 ? (
        <EmptyState message="No audit entries match the filters." />
      ) : null}
      {audit.data !== null && audit.data.items.length > 0 ? (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Id</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.items.map((entry) => (
                <tr key={entry.id} data-testid="audit-item" data-audit-id={entry.id}>
                  <td>{formatDateTime(entry.createdAt)}</td>
                  <td>{entry.actorEmail ?? entry.actorId}</td>
                  <td>{entry.action}</td>
                  <td>{entry.resourceType}</td>
                  <td>{entry.resourceId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pagination">
            <button
              type="button"
              onClick={() => setApplied((current) => ({ ...current, page: Math.max(1, current.page - 1) }))}
              disabled={audit.data.page <= 1}
            >
              Previous
            </button>
            <span>
              Page {audit.data.page} · {audit.data.total} entries
            </span>
            <button
              type="button"
              onClick={() => setApplied((current) => ({ ...current, page: current.page + 1 }))}
              disabled={audit.data.page * audit.data.pageSize >= audit.data.total}
            >
              Next
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
