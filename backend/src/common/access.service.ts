import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface AppointmentRow {
  id: number;
  paciente_id: number;
  profesional_id: number;
  franja_inicio: Date;
  franja_fin: Date;
  estado: 'scheduled' | 'attended' | 'cancelled' | 'no_show';
  paciente_nombre: string;
  paciente_apellidos: string;
  profesional_nombre: string;
  profesional_apellidos: string;
  profesional_especialidad: string;
}

export const APPOINTMENT_SELECT = `
  SELECT c.id, c.paciente_id, c.profesional_id, c.franja_inicio, c.franja_fin, c.estado,
         p.nombre AS paciente_nombre, p.apellidos AS paciente_apellidos,
         pr.nombre AS profesional_nombre, pr.apellidos AS profesional_apellidos,
         pr.especialidad AS profesional_especialidad
    FROM cita c
    JOIN paciente p ON p.id = c.paciente_id
    JOIN profesional pr ON pr.id = c.profesional_id
`;

@Injectable()
export class AccessService {
  constructor(private readonly db: DatabaseService) {}

  async patientIdForUser(userId: number): Promise<number | null> {
    const result = await this.db.query<{ id: number }>(
      'SELECT id FROM paciente WHERE usuario_id = $1',
      [userId],
    );
    return result.rows[0]?.id ?? null;
  }

  async professionalIdForUser(userId: number): Promise<number | null> {
    const result = await this.db.query<{ id: number }>(
      'SELECT id FROM profesional WHERE usuario_id = $1',
      [userId],
    );
    return result.rows[0]?.id ?? null;
  }

  async patientExists(patientId: number): Promise<boolean> {
    const result = await this.db.query('SELECT 1 FROM paciente WHERE id = $1', [patientId]);
    return (result.rowCount ?? 0) > 0;
  }

  async professionalExists(professionalId: number): Promise<boolean> {
    const result = await this.db.query('SELECT 1 FROM profesional WHERE id = $1', [professionalId]);
    return (result.rowCount ?? 0) > 0;
  }

  /** A professional may read clinical content of patients with an assigned appointment. */
  async hasAssignedAppointment(professionalId: number, patientId: number): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1 FROM cita
        WHERE profesional_id = $1 AND paciente_id = $2 AND estado <> 'cancelled'
        LIMIT 1`,
      [professionalId, patientId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listProfessionals(): Promise<
    Array<{ id: number; nombre: string; apellidos: string; especialidad: string }>
  > {
    const result = await this.db.query<{
      id: number;
      nombre: string;
      apellidos: string;
      especialidad: string;
    }>('SELECT id, nombre, apellidos, especialidad FROM profesional ORDER BY apellidos, nombre');
    return result.rows;
  }

  async findAppointment(id: number): Promise<AppointmentRow | null> {
    const result = await this.db.query<AppointmentRow>(`${APPOINTMENT_SELECT} WHERE c.id = $1`, [id]);
    return result.rows[0] ?? null;
  }

  async isAssignedProfessional(professionalId: number, appointment: AppointmentRow): Promise<boolean> {
    return appointment.profesional_id === professionalId;
  }
}
