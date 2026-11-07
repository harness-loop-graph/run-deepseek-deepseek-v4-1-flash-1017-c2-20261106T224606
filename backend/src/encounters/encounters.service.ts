import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';

export interface AttachmentView {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface EncounterView {
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
  attachments: AttachmentView[];
}

interface EncounterRow {
  id: number;
  cita_id: number;
  paciente_id: number;
  profesional_id: number;
  version: number;
  reemplaza_a: number | null;
  notas: string;
  diagnostico: string;
  creado_en: Date;
  profesional_nombre: string;
  profesional_apellidos: string;
  profesional_especialidad: string;
}

const ENCOUNTER_SELECT = `
  SELECT e.id, e.cita_id, e.paciente_id, e.profesional_id, e.version, e.reemplaza_a,
         e.notas, e.diagnostico, e.creado_en,
         pr.nombre AS profesional_nombre, pr.apellidos AS profesional_apellidos,
         pr.especialidad AS profesional_especialidad
    FROM encuentro e
    JOIN profesional pr ON pr.id = e.profesional_id
`;

@Injectable()
export class EncountersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private async attachmentsFor(encounterIds: number[]): Promise<Map<number, AttachmentView[]>> {
    const map = new Map<number, AttachmentView[]>();
    if (encounterIds.length === 0) {
      return map;
    }
    const result = await this.db.query<{
      id: number;
      encuentro_id: number;
      nombre_archivo: string;
      tipo_mime: string;
      tamano_bytes: number;
      creado_en: Date;
    }>(
      `SELECT id, encuentro_id, nombre_archivo, tipo_mime, tamano_bytes, creado_en
         FROM adjunto WHERE encuentro_id = ANY($1::int[]) ORDER BY id`,
      [encounterIds],
    );
    for (const row of result.rows) {
      const list = map.get(row.encuentro_id) ?? [];
      list.push({
        id: row.id,
        filename: row.nombre_archivo,
        mimeType: row.tipo_mime,
        size: row.tamano_bytes,
        createdAt: row.creado_en.toISOString(),
      });
      map.set(row.encuentro_id, list);
    }
    return map;
  }

  private toView(row: EncounterRow, attachments: AttachmentView[]): EncounterView {
    return {
      id: row.id,
      appointmentId: row.cita_id,
      patientId: row.paciente_id,
      professionalId: row.profesional_id,
      version: row.version,
      replaces: row.reemplaza_a,
      notes: row.notas,
      diagnosis: row.diagnostico,
      createdAt: row.creado_en.toISOString(),
      professional: {
        id: row.profesional_id,
        name: `${row.profesional_nombre} ${row.profesional_apellidos}`,
        specialty: row.profesional_especialidad,
      },
      attachments,
    };
  }

  async record(
    actorId: number,
    appointment: { id: number; patientId: number; professionalId: number },
    notes: string,
    diagnosis: string,
  ): Promise<EncounterView> {
    const previous = await this.db.query<{ id: number; version: number }>(
      `SELECT id, version FROM encuentro WHERE cita_id = $1 ORDER BY version DESC LIMIT 1`,
      [appointment.id],
    );
    const previousRow = previous.rows[0] ?? null;
    const version = previousRow === null ? 1 : previousRow.version + 1;

    const inserted = await this.db.query<{ id: number }>(
      `INSERT INTO encuentro
         (cita_id, paciente_id, profesional_id, version, reemplaza_a, notas, diagnostico)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        appointment.id,
        appointment.patientId,
        appointment.professionalId,
        version,
        previousRow?.id ?? null,
        notes,
        diagnosis,
      ],
    );
    await this.db.query(`UPDATE cita SET estado = 'attended' WHERE id = $1 AND estado = 'scheduled'`, [
      appointment.id,
    ]);
    await this.audit.record({
      actorId,
      action: previousRow === null ? 'encounter_created' : 'encounter_corrected',
      resourceType: 'encuentro',
      resourceId: inserted.rows[0].id,
      detail: { appointmentId: appointment.id, version },
    });

    const created = await this.findById(inserted.rows[0].id);
    if (created === null) {
      throw notFound('Encounter not found');
    }
    return created;
  }

  async findById(id: number): Promise<EncounterView | null> {
    const result = await this.db.query<EncounterRow>(`${ENCOUNTER_SELECT} WHERE e.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const attachments = await this.attachmentsFor([row.id]);
    return this.toView(row, attachments.get(row.id) ?? []);
  }

  async forAppointment(appointmentId: number): Promise<EncounterView[]> {
    const result = await this.db.query<EncounterRow>(
      `${ENCOUNTER_SELECT} WHERE e.cita_id = $1 ORDER BY e.version`,
      [appointmentId],
    );
    const attachments = await this.attachmentsFor(result.rows.map((row) => row.id));
    return result.rows.map((row) => this.toView(row, attachments.get(row.id) ?? []));
  }

  async clinicalHistory(
    patientId: number,
    actorId: number,
  ): Promise<{
    patientId: number;
    encounters: Array<
      EncounterView & {
        appointment: { id: number; slotStart: string; status: string; professionalName: string };
      }
    >;
  }> {
    const result = await this.db.query<
      EncounterRow & {
        cita_inicio: Date;
        cita_estado: string;
      }
    >(
      `SELECT e.id, e.cita_id, e.paciente_id, e.profesional_id, e.version, e.reemplaza_a,
              e.notas, e.diagnostico, e.creado_en,
              pr.nombre AS profesional_nombre, pr.apellidos AS profesional_apellidos,
              pr.especialidad AS profesional_especialidad,
              c.franja_inicio AS cita_inicio, c.estado AS cita_estado
         FROM encuentro e
         JOIN profesional pr ON pr.id = e.profesional_id
         JOIN cita c ON c.id = e.cita_id
        WHERE e.paciente_id = $1
        ORDER BY c.franja_inicio DESC, e.version DESC`,
      [patientId],
    );
    const attachments = await this.attachmentsFor(result.rows.map((row) => row.id));
    await this.audit.record({
      actorId,
      action: 'clinical_history_read',
      resourceType: 'paciente',
      resourceId: patientId,
    });
    return {
      patientId,
      encounters: result.rows.map((row) => ({
        ...this.toView(row, attachments.get(row.id) ?? []),
        appointment: {
          id: row.cita_id,
          slotStart: row.cita_inicio.toISOString(),
          status: row.cita_estado,
          professionalName: `${row.profesional_nombre} ${row.profesional_apellidos}`,
        },
      })),
    };
  }

  async listPatientsForProfessional(
    professionalId: number,
  ): Promise<Array<{ id: number; name: string; lastAppointment: string }>> {
    const result = await this.db.query<{
      id: number;
      nombre: string;
      apellidos: string;
      last_appointment: Date;
    }>(
      `SELECT p.id, p.nombre, p.apellidos, MAX(c.franja_inicio) AS last_appointment
         FROM cita c
         JOIN paciente p ON p.id = c.paciente_id
        WHERE c.profesional_id = $1 AND c.estado <> 'cancelled'
        GROUP BY p.id, p.nombre, p.apellidos
        ORDER BY MAX(c.franja_inicio) DESC`,
      [professionalId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: `${row.nombre} ${row.apellidos}`,
      lastAppointment: row.last_appointment.toISOString(),
    }));
  }
}
