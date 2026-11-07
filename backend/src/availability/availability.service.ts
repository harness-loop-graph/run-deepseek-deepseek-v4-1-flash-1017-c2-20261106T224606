import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { validationError } from '../common/errors';

export interface Slot {
  start: string;
  end: string;
}

const MAX_RANGE_DAYS = 60;

@Injectable()
export class AvailabilityService {
  constructor(private readonly db: DatabaseService) {}

  assertRange(from: string, to: string): void {
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    if (end.getTime() < start.getTime()) {
      throw validationError('from must be before or equal to to');
    }
    const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (days > MAX_RANGE_DAYS) {
      throw validationError(`date range must not exceed ${MAX_RANGE_DAYS} days`);
    }
  }

  async freeSlots(professionalId: number, from: string, to: string): Promise<Slot[]> {
    this.assertRange(from, to);
    const result = await this.db.query<{ franja_inicio: Date; franja_fin: Date }>(
      `SELECT d.franja_inicio, d.franja_fin
         FROM disponibilidad d
        WHERE d.profesional_id = $1
          AND d.franja_inicio >= $2::timestamptz
          AND d.franja_inicio < ($3::date + interval '1 day')
          AND d.franja_inicio > now()
          AND NOT EXISTS (
            SELECT 1 FROM cita c
             WHERE c.profesional_id = d.profesional_id
               AND c.franja_inicio = d.franja_inicio
               AND c.estado <> 'cancelled'
          )
        ORDER BY d.franja_inicio`,
      [professionalId, `${from}T00:00:00.000Z`, to],
    );
    return result.rows.map((row) => ({
      start: row.franja_inicio.toISOString(),
      end: row.franja_fin.toISOString(),
    }));
  }

  async findWindow(
    professionalId: number,
    slotStart: string,
  ): Promise<{ start: Date; end: Date } | null> {
    const result = await this.db.query<{ franja_inicio: Date; franja_fin: Date }>(
      `SELECT franja_inicio, franja_fin
         FROM disponibilidad
        WHERE profesional_id = $1 AND franja_inicio = $2::timestamptz`,
      [professionalId, slotStart],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return { start: row.franja_inicio, end: row.franja_fin };
  }

  async replaceAvailability(
    professionalId: number,
    slots: Array<{ start: string; end: string }>,
  ): Promise<Slot[]> {
    const normalized = slots
      .map((slot) => ({ start: new Date(slot.start), end: new Date(slot.end) }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    for (let index = 0; index < normalized.length; index += 1) {
      const slot = normalized[index];
      if (slot.end.getTime() <= slot.start.getTime()) {
        throw validationError('slot end must be after slot start');
      }
      if (index > 0 && slot.start.getTime() < normalized[index - 1].end.getTime()) {
        throw validationError('slots must not overlap');
      }
    }

    await this.db.transaction(async (client) => {
      await client.query('DELETE FROM disponibilidad WHERE profesional_id = $1', [professionalId]);
      for (const slot of normalized) {
        await client.query(
          `INSERT INTO disponibilidad (profesional_id, franja_inicio, franja_fin)
           VALUES ($1, $2, $3)`,
          [professionalId, slot.start.toISOString(), slot.end.toISOString()],
        );
      }
    });

    return normalized.map((slot) => ({
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
    }));
  }

  async listAvailability(professionalId: number): Promise<Slot[]> {
    const result = await this.db.query<{ franja_inicio: Date; franja_fin: Date }>(
      `SELECT franja_inicio, franja_fin FROM disponibilidad
        WHERE profesional_id = $1 ORDER BY franja_inicio`,
      [professionalId],
    );
    return result.rows.map((row) => ({
      start: row.franja_inicio.toISOString(),
      end: row.franja_fin.toISOString(),
    }));
  }
}
