import type { RoleName } from '../config/config';

export interface Actor {
  userId: number;
  roles: RoleName[];
  patientId: number | null;
  professionalId: number | null;
}

export interface AppointmentScope {
  patientId: number;
  professionalId: number;
}

export interface AttachmentScope {
  encounterProfessionalId: number;
  encounterPatientId: number;
}

export function hasRole(actor: Actor, ...roles: RoleName[]): boolean {
  return roles.some((role) => actor.roles.includes(role));
}

/** Scheduling data is visible to patients (own), professionals (assigned) and staff. */
export function canReadAppointment(actor: Actor, appointment: AppointmentScope): boolean {
  if (actor.patientId !== null && actor.patientId === appointment.patientId) {
    return true;
  }
  if (actor.professionalId !== null && actor.professionalId === appointment.professionalId) {
    return true;
  }
  return hasRole(actor, 'staff');
}

export function canCancelAppointment(actor: Actor, appointment: AppointmentScope): boolean {
  return (
    actor.patientId !== null &&
    actor.patientId === appointment.patientId &&
    hasRole(actor, 'patient')
  );
}

export function canRecordEncounter(actor: Actor, appointment: AppointmentScope): boolean {
  return (
    actor.professionalId !== null &&
    actor.professionalId === appointment.professionalId &&
    hasRole(actor, 'professional')
  );
}

/**
 * Clinical history: the patient themself, or a professional that has an
 * appointment assigned with that patient. Staff and admin never read it.
 */
export function canReadClinicalHistory(
  actor: Actor,
  patientId: number,
  hasAssignedAppointment: boolean,
): boolean {
  if (hasRole(actor, 'staff') || hasRole(actor, 'admin')) {
    return false;
  }
  if (actor.patientId !== null && actor.patientId === patientId && hasRole(actor, 'patient')) {
    return true;
  }
  return (
    actor.professionalId !== null &&
    hasRole(actor, 'professional') &&
    hasAssignedAppointment
  );
}

/** Attachments: the authoring professional or the patient the encounter belongs to. */
export function canReadAttachment(actor: Actor, scope: AttachmentScope): boolean {
  if (
    actor.professionalId !== null &&
    actor.professionalId === scope.encounterProfessionalId &&
    hasRole(actor, 'professional')
  ) {
    return true;
  }
  return (
    actor.patientId !== null &&
    actor.patientId === scope.encounterPatientId &&
    hasRole(actor, 'patient')
  );
}

export function canSearchAvailability(actor: Actor): boolean {
  return hasRole(actor, 'patient', 'staff');
}

export function canBook(actor: Actor): boolean {
  return hasRole(actor, 'patient') && actor.patientId !== null;
}

export function canReadAgenda(actor: Actor): boolean {
  return hasRole(actor, 'professional', 'staff');
}
