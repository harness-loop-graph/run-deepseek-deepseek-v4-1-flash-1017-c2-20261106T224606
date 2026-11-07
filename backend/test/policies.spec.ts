import { describe, expect, it } from 'vitest';
import {
  canBook,
  canCancelAppointment,
  canReadAgenda,
  canReadAppointment,
  canReadAttachment,
  canReadClinicalHistory,
  canRecordEncounter,
  hasRole,
  type Actor,
} from '../src/common/policies';

/**
 * RF-09 / RF-10: role and scope decisions. These are the exact functions the
 * controllers call before touching data, so the matrix below is the server-side
 * authorization contract, independent of the UI.
 */

const patient1: Actor = { userId: 1, roles: ['patient'], patientId: 1, professionalId: null };
const patient2: Actor = { userId: 2, roles: ['patient'], patientId: 2, professionalId: null };
const gomez: Actor = { userId: 6, roles: ['professional'], patientId: null, professionalId: 1 };
const lopez: Actor = { userId: 7, roles: ['professional'], patientId: null, professionalId: 2 };
const staff: Actor = { userId: 2, roles: ['staff'], patientId: null, professionalId: null };
const admin: Actor = { userId: 1, roles: ['admin'], patientId: null, professionalId: null };

describe('appointment scope', () => {
  const ownAppointment = { patientId: 1, professionalId: 1 };

  it('lets a patient read only their own appointment', () => {
    expect(canReadAppointment(patient1, ownAppointment)).toBe(true);
    expect(canReadAppointment(patient2, ownAppointment)).toBe(false);
  });

  it('lets the assigned professional and staff read scheduling data', () => {
    expect(canReadAppointment(gomez, ownAppointment)).toBe(true);
    expect(canReadAppointment(lopez, ownAppointment)).toBe(false);
    expect(canReadAppointment(staff, ownAppointment)).toBe(true);
    expect(canReadAppointment(admin, ownAppointment)).toBe(false);
  });

  it('lets only the owning patient cancel', () => {
    expect(canCancelAppointment(patient1, ownAppointment)).toBe(true);
    expect(canCancelAppointment(patient2, ownAppointment)).toBe(false);
    expect(canCancelAppointment(gomez, ownAppointment)).toBe(false);
    expect(canCancelAppointment(staff, ownAppointment)).toBe(false);
  });

  it('lets only the assigned professional record an encounter', () => {
    expect(canRecordEncounter(gomez, ownAppointment)).toBe(true);
    expect(canRecordEncounter(lopez, ownAppointment)).toBe(false);
    expect(canRecordEncounter(patient1, ownAppointment)).toBe(false);
    expect(canRecordEncounter(staff, ownAppointment)).toBe(false);
  });

  it('limits the agenda to professionals and staff', () => {
    expect(canReadAgenda(gomez)).toBe(true);
    expect(canReadAgenda(staff)).toBe(true);
    expect(canReadAgenda(patient1)).toBe(false);
    expect(canReadAgenda(admin)).toBe(false);
  });

  it('lets only a patient with a patient profile book', () => {
    expect(canBook(patient1)).toBe(true);
    expect(canBook(staff)).toBe(false);
    expect(canBook(gomez)).toBe(false);
    expect(canBook({ ...patient1, patientId: null })).toBe(false);
  });
});

describe('clinical history isolation', () => {
  it('lets a patient read their own history and nobody else', () => {
    expect(canReadClinicalHistory(patient1, 1, false)).toBe(true);
    expect(canReadClinicalHistory(patient2, 1, false)).toBe(false);
    expect(canReadClinicalHistory(patient1, 2, false)).toBe(false);
  });

  it('lets a professional read only patients with an assigned appointment', () => {
    expect(canReadClinicalHistory(gomez, 1, true)).toBe(true);
    expect(canReadClinicalHistory(gomez, 1, false)).toBe(false);
  });

  it('never lets staff or admin read clinical content', () => {
    expect(canReadClinicalHistory(staff, 1, true)).toBe(false);
    expect(canReadClinicalHistory(admin, 1, true)).toBe(false);
  });

  it('allows a multi-role account only through its clinical roles', () => {
    const patientAndStaff: Actor = {
      userId: 9,
      roles: ['patient', 'staff'],
      patientId: 3,
      professionalId: null,
    };
    expect(canReadClinicalHistory(patientAndStaff, 3, false)).toBe(false);
    expect(canReadClinicalHistory(patientAndStaff, 4, false)).toBe(false);
  });
});

describe('attachment scope', () => {
  const scope = { encounterProfessionalId: 1, encounterPatientId: 1 };

  it('allows the authoring professional and the owning patient', () => {
    expect(canReadAttachment(gomez, scope)).toBe(true);
    expect(canReadAttachment(patient1, scope)).toBe(true);
  });

  it('denies other professionals, other patients and staff', () => {
    expect(canReadAttachment(lopez, scope)).toBe(false);
    expect(canReadAttachment(patient2, scope)).toBe(false);
    expect(canReadAttachment(staff, scope)).toBe(false);
    expect(canReadAttachment(admin, scope)).toBe(false);
  });
});

describe('role helper', () => {
  it('matches any of the requested roles', () => {
    expect(hasRole(staff, 'staff', 'admin')).toBe(true);
    expect(hasRole(staff, 'patient')).toBe(false);
  });
});
