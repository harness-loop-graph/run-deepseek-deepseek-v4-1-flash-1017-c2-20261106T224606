import { API_URL } from '../config';
import { ApiError } from './errors';
import { tokenManager } from '../auth/token-manager';
import type {
  AdminUser,
  AgendaDay,
  Appointment,
  AuditEntry,
  ClinicalHistory,
  Encounter,
  Paginated,
  Professional,
  ProfessionalPatient,
  RoleName,
  Slot,
} from './types';

/**
 * API client. Every call attaches the current access token, retries exactly
 * once after a 401 by refreshing, and normalises failures into `ApiError`
 * built from the server envelope `{ error: { code, message } }` (RF-16).
 */

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  formData?: FormData;
  query?: Record<string, string | number | undefined>;
  raw?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_URL}${path}`);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function readError(response: Response): Promise<ApiError> {
  const retryAfterHeader = response.headers.get('Retry-After');
  const retryAfter = retryAfterHeader === null ? null : Number.parseInt(retryAfterHeader, 10);
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    if (body.error !== undefined && typeof body.error.message === 'string') {
      return new ApiError(
        body.error.code ?? 'error',
        body.error.message,
        response.status,
        Number.isFinite(retryAfter) ? retryAfter : null,
      );
    }
  } catch {
    // Fall through to the generic message below: never surface raw bodies.
  }
  return new ApiError(
    'error',
    response.status === 401
      ? 'Your session expired. Please sign in again.'
      : 'The request could not be completed.',
    response.status,
    Number.isFinite(retryAfter) ? retryAfter : null,
  );
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = await tokenManager.getAccessToken();
  if (token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }
  let body: BodyInit | undefined;
  if (options.formData !== undefined) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  return fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body,
  });
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options);
  if (response.status === 401 && tokenManager.getSession() !== null) {
    const refreshed = await tokenManager.refresh();
    if (refreshed !== null) {
      response = await send(path, options);
    }
  }
  if (!response.ok) {
    throw await readError(response);
  }
  if (options.raw) {
    return response as unknown as T;
  }
  if (response.status === 204) {
    return undefined as unknown as T;
  }
  return (await response.json()) as T;
}

export const api = {
  // --- appointments (EP-05, EP-07, EP-08, EP-09, EP-10) ---
  myAppointments: (): Promise<Appointment[]> => request('/me/appointments'),
  bookAppointment: (professionalId: number, slotStart: string): Promise<Appointment> =>
    request('/appointments', {
      method: 'POST',
      body: { professionalId, slotStart },
    }),
  cancelAppointment: (id: number): Promise<void> =>
    request(`/appointments/${id}`, { method: 'DELETE' }),
  appointment: (id: number): Promise<Appointment> => request(`/appointments/${id}`),
  agenda: (from: string, to: string): Promise<AgendaDay[]> =>
    request('/agenda', { query: { from, to } }),

  // --- availability (EP-06) ---
  professionals: (): Promise<Professional[]> => request('/professionals'),
  availability: (professionalId: number, from: string, to: string): Promise<Slot[]> =>
    request('/availability', { query: { professionalId, from, to } }),

  // --- encounters and clinical history (EP-11, EP-12) ---
  recordEncounter: (appointmentId: number, notes: string, diagnosis: string): Promise<Encounter> =>
    request(`/appointments/${appointmentId}/encounter`, {
      method: 'POST',
      body: { notes, diagnosis },
    }),
  appointmentEncounters: (appointmentId: number): Promise<Encounter[]> =>
    request(`/appointments/${appointmentId}/encounters`),
  clinicalHistory: (patientId: number): Promise<ClinicalHistory> =>
    request(`/patients/${patientId}/clinical-history`),
  professionalPatients: (): Promise<ProfessionalPatient[]> => request('/professional/patients'),

  // --- attachments (EP-13, EP-14) ---
  uploadAttachment: (encounterId: number, file: File): Promise<unknown> => {
    const form = new FormData();
    form.append('file', file);
    return request(`/encounters/${encounterId}/attachments`, { method: 'POST', formData: form });
  },
  downloadAttachment: async (attachmentId: number, filename: string): Promise<void> => {
    const response = await request<Response>(`/attachments/${attachmentId}`, { raw: true });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },

  // --- administration (EP-15..EP-19) ---
  adminUsers: (page = 1, pageSize = 20): Promise<Paginated<AdminUser>> =>
    request('/admin/users', { query: { page, pageSize } }),
  createUser: (email: string, roles: RoleName[]): Promise<AdminUser> =>
    request('/admin/users', { method: 'POST', body: { email, roles } }),
  updateUserRoles: (id: number, roles: RoleName[]): Promise<AdminUser> =>
    request(`/admin/users/${id}/roles`, { method: 'PATCH', body: { roles } }),
  adminProfessionals: (): Promise<Professional[]> => request('/admin/professionals'),
  professionalAvailability: (id: number): Promise<Slot[]> =>
    request(`/admin/professionals/${id}/availability`),
  replaceAvailability: (id: number, slots: Slot[]): Promise<{ slots: Slot[] }> =>
    request(`/admin/professionals/${id}/availability`, { method: 'PUT', body: { slots } }),
  audit: (filters: {
    actor?: string;
    action?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Paginated<AuditEntry>> => request('/admin/audit', { query: filters }),
};
