import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { describeError } from '../api/errors';
import { useAuth } from '../auth/session';
import { useAsync } from '../hooks/useAsync';
import { EmptyState, ErrorBanner, LoadingIndicator } from '../components/States';
import { formatDateTime } from '../lib/dates';
import type { Appointment, Encounter } from '../api/types';

/**
 * SCR-05 — Appointment detail and encounter recording.
 *
 * Scheduling data comes from EP-10. Clinical content (existing encounters and
 * attachments) is only requested by the roles the server authorises for it:
 * patients and professionals. Staff sees scheduling data only (RF-10).
 */
export function AppointmentDetailScreen(): JSX.Element {
  const params = useParams<{ id: string }>();
  const appointmentId = Number.parseInt(params.id ?? '', 10);
  const { roles, user } = useAuth();
  const isProfessional = roles.includes('professional');
  const isPatient = roles.includes('patient');
  const clinicalAllowed = isProfessional || isPatient;

  const loadAppointment = useCallback(() => api.appointment(appointmentId), [appointmentId]);
  const appointment = useAsync<Appointment>(loadAppointment, [appointmentId]);

  const loadEncounters = useCallback(
    () => (clinicalAllowed ? api.appointmentEncounters(appointmentId) : Promise.resolve([])),
    [appointmentId, clinicalAllowed],
  );
  const encounters = useAsync<Encounter[]>(loadEncounters, [appointmentId, clinicalAllowed]);

  const [notes, setNotes] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);

  if (Number.isNaN(appointmentId)) {
    return <ErrorBanner message="Invalid appointment identifier." />;
  }

  const submitEncounter = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);
    if (notes.trim() === '' || diagnosis.trim() === '') {
      setSaveError('Notes and diagnosis are required.');
      return;
    }
    setSaving(true);
    try {
      await api.recordEncounter(appointmentId, notes.trim(), diagnosis.trim());
      setNotes('');
      setDiagnosis('');
      setSaved(true);
      encounters.reload();
      appointment.reload();
    } catch (failure) {
      setSaveError(describeError(failure));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (encounterId: number, file: File | null): Promise<void> => {
    setUploadError(null);
    if (file === null) {
      setUploadError('Choose a PDF, JPEG or PNG file first.');
      return;
    }
    setUploading(encounterId);
    try {
      await api.uploadAttachment(encounterId, file);
      encounters.reload();
    } catch (failure) {
      setUploadError(describeError(failure));
    } finally {
      setUploading(null);
    }
  };

  const isAssignedProfessional =
    isProfessional && user !== null && appointment.data !== null
      ? appointment.data.professionalId === user.professionalId
      : false;

  return (
    <section>
      <p>
        <Link to={isProfessional ? '/agenda' : '/bookings'}>← Back</Link>
      </p>
      <h1>Appointment detail</h1>
      {appointment.loading ? <LoadingIndicator label="Loading the appointment…" /> : null}
      {!appointment.loading && appointment.error !== null ? (
        <ErrorBanner message={appointment.error} />
      ) : null}
      {appointment.data !== null && appointment.error === null ? (
        <article className="card">
          <h2 data-testid="appointment-title">
            {formatDateTime(appointment.data.slotStart)} · {appointment.data.professional.name}
          </h2>
          <dl className="details">
            <dt>Status</dt>
            <dd data-testid="appointment-status">{appointment.data.status}</dd>
            <dt>Patient</dt>
            <dd>{appointment.data.patient.name}</dd>
            <dt>Professional</dt>
            <dd>
              {appointment.data.professional.name} ({appointment.data.professional.specialty})
            </dd>
            <dt>Ends</dt>
            <dd>{formatDateTime(appointment.data.slotEnd)}</dd>
          </dl>
        </article>
      ) : null}

      {clinicalAllowed ? (
        <>
          <h2>Encounters</h2>
          {encounters.loading ? <LoadingIndicator label="Loading encounters…" /> : null}
          {!encounters.loading && encounters.error !== null ? (
            <ErrorBanner message={encounters.error} />
          ) : null}
          {uploadError !== null ? <ErrorBanner message={uploadError} /> : null}
          {!encounters.loading &&
          encounters.error === null &&
          encounters.data !== null &&
          encounters.data.length === 0 ? (
            <EmptyState message="No encounters recorded for this appointment." />
          ) : null}
          {encounters.data !== null && encounters.data.length > 0 ? (
            <ul className="list">
              {encounters.data.map((encounter) => (
                <li key={encounter.id} className="list-item" data-testid="encounter-item">
                  <div>
                    <p className="item-title">
                      Version {encounter.version} · {formatDateTime(encounter.createdAt)}
                    </p>
                    <p className="item-subtitle" data-testid="encounter-notes-text">
                      {encounter.notes}
                    </p>
                    <p className="item-subtitle" data-testid="encounter-diagnosis-text">
                      {encounter.diagnosis}
                    </p>
                    {encounter.attachments.length > 0 ? (
                      <ul className="attachments">
                        {encounter.attachments.map((attachment) => (
                          <li key={attachment.id}>
                            <button
                              type="button"
                              className="link-button"
                              data-testid="attachment-download"
                              onClick={() =>
                                void api.downloadAttachment(attachment.id, attachment.filename)
                              }
                            >
                              {attachment.filename}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {isAssignedProfessional ? (
                    <div className="item-actions">
                      <label className="inline-label" htmlFor={`attachment-${encounter.id}`}>
                        Attach
                      </label>
                      <input
                        id={`attachment-${encounter.id}`}
                        type="file"
                        accept="application/pdf,image/jpeg,image/png"
                        data-testid="attachment-input"
                        onChange={(event) =>
                          void upload(encounter.id, event.target.files?.[0] ?? null)
                        }
                      />
                      {uploading === encounter.id ? (
                        <LoadingIndicator label="Uploading…" />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {isAssignedProfessional ? (
            <form className="card form-grid" onSubmit={submitEncounter}>
              <h2>Record encounter</h2>
              {saveError !== null ? <ErrorBanner message={saveError} /> : null}
              {saved ? (
                <p className="state state-success" data-testid="encounter-confirmation">
                  Encounter recorded.
                </p>
              ) : null}
              <label htmlFor="encounter-notes">Notes</label>
              <textarea
                id="encounter-notes"
                data-testid="encounter-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={5}
                maxLength={20_000}
                required
              />
              <label htmlFor="encounter-diagnosis">Diagnosis</label>
              <textarea
                id="encounter-diagnosis"
                data-testid="encounter-diagnosis"
                value={diagnosis}
                onChange={(event) => setDiagnosis(event.target.value)}
                rows={3}
                maxLength={5_000}
                required
              />
              <button type="submit" data-testid="encounter-submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save encounter'}
              </button>
            </form>
          ) : null}
        </>
      ) : (
        <p className="hint">
          Scheduling data only: clinical content is not available to this role.
        </p>
      )}
    </section>
  );
}
