import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AvailabilityService } from '../availability/availability.service';
import { APPOINTMENT_SELECT, AppointmentRow } from '../common/access.service';
import { conflict, notFound, validationError } from '../common/errors';
import { AuditService } from '../audit/audit.service';

export interface AppointmentView {
  id: number;
  patientId: number;
  professionalId: number;
  slotStart: string;
  slotEnd: string;
  status: 'scheduled' | 'attended' | 'cancelled' | 'no_show';
  patient: { id: number; name: string };
  professional: { id: number; name: string; specialty: string };
}

/**
 * The three statements the booking transaction needs. Keeping them behind an
 * interface lets the concurrency test (RF-13) exercise the exact same
 * transaction body against an in-memory implementation.
 */
export interface BookingTransaction {
  /** Locks the availability row for the slot; false when the slot does not exist. */
  lockAvailability(professionalId: number, slotStart: string): Promise<boolean>;
  /** Returns the id of an active (non-cancelled) booking for the slot, if any. */
  findActiveBooking(professionalId: number, slotStart: string): Promise<number | null>;
  insertBooking(input: {
    patientId: number;
    professionalId: number;
    slotStart: string;
    slotEnd: string;
  }): Promise<number>;
}

export interface BookingInput {
  actorId: number;
  patientId: number;
  professionalId: number;
  slotStart: string;
}

export function toAppointmentView(row: AppointmentRow): AppointmentView {
  return {
    id: row.id,
    patientId: row.paciente_id,
    professionalId: row.profesional_id,
    slotStart: row.franja_inicio.toISOString(),
    slotEnd: row.franja_fin.toISOString(),
    status: row.estado,
    patient: { id: row.paciente_id, name: `${row.paciente_nombre} ${row.paciente_apellidos}` },
    professional: {
      id: row.profesional_id,
      name: `${row.profesional_nombre} ${row.profesional_apellidos}`,
      specialty: row.profesional_especialidad,
    },
  };
}

export function createBookingTransaction(client: PoolClient): BookingTransaction {
  return {
    async lockAvailability(professionalId, slotStart) {
      const lock = await client.query(
        `SELECT id FROM disponibilidad
          WHERE profesional_id = $1 AND franja_inicio = $2::timestamptz
          FOR UPDATE`,
        [professionalId, slotStart],
      );
      return (lock.rowCount ?? 0) > 0;
    },
    async findActiveBooking(professionalId, slotStart) {
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM cita
          WHERE profesional_id = $1 AND franja_inicio = $2::timestamptz
            AND estado <> 'cancelled'
          FOR UPDATE`,
        [professionalId, slotStart],
      );
      return existing.rows[0]?.id ?? null;
    },
    async insertBooking(input) {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO cita (paciente_id, profesional_id, franja_inicio, franja_fin, estado)
         VALUES ($1, $2, $3, $4, 'scheduled')
         RETURNING id`,
        [input.patientId, input.professionalId, input.slotStart, input.slotEnd],
      );
      return inserted.rows[0].id;
    },
  };
}

/**
 * RF-13: the booking decision and the insert run inside a single transaction
 * that first locks the availability row, so two concurrent requests for the
 * same slot are serialised: the first commits, the second observes the active
 * booking and receives a 409. The partial unique index on
 * `(profesional_id, franja_inicio)` is the database-level backstop.
 */
export async function bookSlot(
  transaction: BookingTransaction,
  input: BookingInput & { slotEnd: string },
): Promise<number> {
  const locked = await transaction.lockAvailability(input.professionalId, input.slotStart);
  if (!locked) {
    throw validationError('slotStart is not an available slot for this professional');
  }
  const active = await transaction.findActiveBooking(input.professionalId, input.slotStart);
  if (active !== null) {
    throw conflict('The slot is already booked');
  }
  return transaction.insertBooking({
    patientId: input.patientId,
    professionalId: input.professionalId,
    slotStart: input.slotStart,
    slotEnd: input.slotEnd,
  });
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
  ) {}

  async listForPatient(patientId: number): Promise<AppointmentView[]> {
    const result = await this.db.query<AppointmentRow>(
      `${APPOINTMENT_SELECT} WHERE c.paciente_id = $1 ORDER BY c.franja_inicio DESC`,
      [patientId],
    );
    return result.rows.map(toAppointmentView);
  }

  private groupByDay(rows: AppointmentRow[]): Array<{ date: string; appointments: AppointmentView[] }> {
    const grouped = new Map<string, AppointmentView[]>();
    for (const row of rows) {
      const date = row.franja_inicio.toISOString().slice(0, 10);
      const list = grouped.get(date) ?? [];
      list.push(toAppointmentView(row));
      grouped.set(date, list);
    }
    return [...grouped.entries()].map(([date, appointments]) => ({ date, appointments }));
  }

  async listAgenda(
    professionalId: number,
    from: string,
    to: string,
  ): Promise<Array<{ date: string; appointments: AppointmentView[] }>> {
    const result = await this.db.query<AppointmentRow>(
      `${APPOINTMENT_SELECT}
        WHERE c.profesional_id = $1
          AND c.franja_inicio >= $2::timestamptz
          AND c.franja_inicio < ($3::date + interval '1 day')
        ORDER BY c.franja_inicio`,
      [professionalId, `${from}T00:00:00.000Z`, to],
    );
    return this.groupByDay(result.rows);
  }

  async listAgendaForStaff(
    from: string,
    to: string,
  ): Promise<Array<{ date: string; appointments: AppointmentView[] }>> {
    const result = await this.db.query<AppointmentRow>(
      `${APPOINTMENT_SELECT}
        WHERE c.franja_inicio >= $1::timestamptz
          AND c.franja_inicio < ($2::date + interval '1 day')
        ORDER BY c.franja_inicio`,
      [`${from}T00:00:00.000Z`, to],
    );
    return this.groupByDay(result.rows);
  }

  async book(
    actorId: number,
    patientId: number,
    professionalId: number,
    slotStart: string,
  ): Promise<AppointmentView> {
    const window = await this.availability.findWindow(professionalId, slotStart);
    if (window === null) {
      throw validationError('slotStart is not an available slot for this professional');
    }
    if (window.start.getTime() <= Date.now()) {
      throw validationError('slotStart must be in the future');
    }

    let createdId: number;
    try {
      createdId = await this.db.transaction((client) =>
        bookSlot(createBookingTransaction(client), {
          actorId,
          patientId,
          professionalId,
          slotStart: window.start.toISOString(),
          slotEnd: window.end.toISOString(),
        }),
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        // Unique partial index backstop: one active booking per slot.
        throw conflict('The slot is already booked');
      }
      throw error;
    }

    await this.audit.record({
      actorId,
      action: 'appointment_created',
      resourceType: 'cita',
      resourceId: createdId,
      detail: { professionalId, slotStart },
    });

    const row = await this.findById(createdId);
    if (row === null) {
      throw notFound('Appointment not found');
    }
    return row;
  }

  async findById(id: number): Promise<AppointmentView | null> {
    const result = await this.db.query<AppointmentRow>(`${APPOINTMENT_SELECT} WHERE c.id = $1`, [id]);
    const row = result.rows[0];
    return row ? toAppointmentView(row) : null;
  }

  async cancel(actorId: number, appointmentId: number): Promise<void> {
    const updated = await this.db.query(
      `UPDATE cita SET estado = 'cancelled', cancelada_en = now()
        WHERE id = $1 AND estado <> 'cancelled'`,
      [appointmentId],
    );
    if (!updated.rowCount) {
      const existing = await this.db.query<{ estado: string }>(
        'SELECT estado FROM cita WHERE id = $1',
        [appointmentId],
      );
      if (!existing.rowCount) {
        throw notFound('Appointment not found');
      }
      // Cancelling an already cancelled appointment is idempotent for its owner.
      return;
    }
    await this.audit.record({
      actorId,
      action: 'appointment_cancelled',
      resourceType: 'cita',
      resourceId: appointmentId,
    });
  }
}
