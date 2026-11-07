import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/session';
import { useAsync } from '../hooks/useAsync';
import { EmptyState, ErrorBanner, LoadingIndicator } from '../components/States';
import { formatDateTime } from '../lib/dates';
import type { ClinicalHistory, ProfessionalPatient } from '../api/types';

/**
 * SCR-06 — Patient clinical history: chronology with attachments.
 *
 * A patient always reads their own history (the patient id comes from the
 * session, never from the URL); a professional picks one of the patients with
 * an assigned appointment, which is exactly the scope EP-12 enforces (RF-10).
 * Clinical notes are rendered as text, never as HTML (RF-22).
 */
export function HistoryScreen(): JSX.Element {
  const { user } = useAuth();
  const params = useParams<{ patientId?: string }>();
  const isPatient = user !== null && user.roles.includes('patient');

  const loadPatients = useCallback(
    () => (isPatient ? Promise.resolve([]) : api.professionalPatients()),
    [isPatient],
  );
  const patients = useAsync<ProfessionalPatient[]>(loadPatients, [isPatient]);

  const initialPatientId = isPatient
    ? user?.patientId ?? null
    : params.patientId !== undefined
      ? Number.parseInt(params.patientId, 10)
      : null;
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(initialPatientId);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const effectivePatientId = isPatient ? user?.patientId ?? null : selectedPatientId;

  const loadHistory = useCallback(
    () =>
      effectivePatientId === null
        ? Promise.resolve<ClinicalHistory | null>(null)
        : api.clinicalHistory(effectivePatientId),
    [effectivePatientId],
  );
  const history = useAsync<ClinicalHistory | null>(loadHistory, [effectivePatientId]);

  const download = async (attachmentId: number, filename: string): Promise<void> => {
    setDownloadError(null);
    try {
      await api.downloadAttachment(attachmentId, filename);
    } catch (failure) {
      setDownloadError(failure instanceof Error ? failure.message : 'Download failed.');
    }
  };

  return (
    <section>
      <h1>Clinical history</h1>
      {!isPatient ? (
        <div className="card form-grid">
          <label htmlFor="history-patient">Patient</label>
          <select
            id="history-patient"
            data-testid="history-patient"
            value={selectedPatientId ?? ''}
            onChange={(event) =>
              setSelectedPatientId(
                event.target.value === '' ? null : Number.parseInt(event.target.value, 10),
              )
            }
          >
            <option value="">Select a patient</option>
            {(patients.data ?? []).map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patient.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {patients.loading ? <LoadingIndicator label="Loading patients…" /> : null}
      {patients.error !== null ? <ErrorBanner message={patients.error} /> : null}
      {downloadError !== null ? <ErrorBanner message={downloadError} /> : null}

      {effectivePatientId === null ? (
        <EmptyState message="Select a patient to read their clinical history." />
      ) : null}
      {history.loading ? <LoadingIndicator label="Loading the clinical history…" /> : null}
      {!history.loading && history.error !== null ? <ErrorBanner message={history.error} /> : null}
      {!history.loading &&
      history.error === null &&
      history.data !== null &&
      history.data.encounters.length === 0 ? (
        <EmptyState message="This patient has no recorded encounters." />
      ) : null}
      {history.data !== null && history.data.encounters.length > 0 ? (
        <ol className="timeline" data-testid="history-timeline">
          {history.data.encounters.map((encounter) => (
            <li key={encounter.id} className="timeline-item">
              <p className="item-title">
                {encounter.appointment !== undefined
                  ? formatDateTime(encounter.appointment.slotStart)
                  : formatDateTime(encounter.createdAt)}{' '}
                · {encounter.professional.name} · version {encounter.version}
              </p>
              <p className="timeline-notes">Notes: {encounter.notes}</p>
              <p className="timeline-diagnosis">Diagnosis: {encounter.diagnosis}</p>
              {encounter.replaces !== null ? (
                <p className="item-subtitle">Corrects encounter {encounter.replaces}</p>
              ) : null}
              {encounter.attachments.length > 0 ? (
                <ul className="attachments">
                  {encounter.attachments.map((attachment) => (
                    <li key={attachment.id}>
                      <button
                        type="button"
                        className="link-button"
                        data-testid="attachment-download"
                        onClick={() => void download(attachment.id, attachment.filename)}
                      >
                        {attachment.filename} ({Math.max(1, Math.round(attachment.size / 1024))} KB)
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
