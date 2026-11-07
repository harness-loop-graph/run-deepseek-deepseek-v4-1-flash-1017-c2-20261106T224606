/** Wire types shared by the screens. They mirror the backend response bodies. */

export type RoleName = 'patient' | 'professional' | 'staff' | 'admin';

export interface SessionUser {
  id: number;
  email: string;
  roles: RoleName[];
  patientId: number | null;
  professionalId: number | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_expires_in: number;
  user: SessionUser;
}

export interface Professional {
  id: number;
  nombre: string;
  apellidos: string;
  especialidad: string;
}

export interface Slot {
  start: string;
  end: string;
}

export type AppointmentStatus = 'scheduled' | 'attended' | 'cancelled' | 'no_show';

export interface Appointment {
  id: number;
  patientId: number;
  professionalId: number;
  slotStart: string;
  slotEnd: string;
  status: AppointmentStatus;
  patient: { id: number; name: string };
  professional: { id: number; name: string; specialty: string };
}

export interface AgendaDay {
  date: string;
  appointments: Appointment[];
}

export interface Attachment {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface Encounter {
  id: number;
  appointmentId: number;
  patientId: number;
  professionalId: number;
  version: number;
  replaces: number | null;
  notes: string;
  diagnosis: string;
  createdAt: string;
  professional: { id: number; name: string; specialty: string };
  attachments: Attachment[];
  appointment?: {
    id: number;
    slotStart: string;
    status: string;
    professionalName: string;
  };
}

export interface ClinicalHistory {
  patientId: number;
  encounters: Encounter[];
}

export interface AdminUser {
  id: number;
  email: string;
  active: boolean;
  roles: RoleName[];
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AuditEntry {
  id: number;
  actorId: number;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface ProfessionalPatient {
  id: number;
  name: string;
  lastAppointment: string;
}
