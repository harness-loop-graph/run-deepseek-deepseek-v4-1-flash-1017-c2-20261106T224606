import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface AuditEntry {
  actorId: number;
  action: string;
  resourceType: string;
  resourceId?: string | number | null;
  detail?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly db: DatabaseService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO auditoria (usuario_id, accion, recurso_tipo, recurso_id, detalle)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          entry.actorId,
          entry.action,
          entry.resourceType,
          entry.resourceId === undefined || entry.resourceId === null
            ? null
            : String(entry.resourceId),
          JSON.stringify(entry.detail ?? {}),
        ],
      );
    } catch (error) {
      // The audit trail must never break a request that already succeeded.
      this.logger.error(
        `Could not persist audit entry ${entry.action}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async list(filters: {
    actor?: string;
    action?: string;
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
  }): Promise<{
    items: Array<{
      id: number;
      actorId: number;
      actorEmail: string | null;
      action: string;
      resourceType: string;
      resourceId: string | null;
      detail: Record<string, unknown>;
      createdAt: string;
    }>;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.actor !== undefined && filters.actor !== '') {
      const numericActor = Number.parseInt(filters.actor, 10);
      params.push(`%${filters.actor}%`);
      const likeParam = `$${params.length}`;
      if (Number.isInteger(numericActor) && String(numericActor) === filters.actor) {
        params.push(numericActor);
        conditions.push(`(u.email ILIKE ${likeParam} OR u.id = $${params.length})`);
      } else {
        conditions.push(`u.email ILIKE ${likeParam}`);
      }
    }
    if (filters.action !== undefined && filters.action !== '') {
      params.push(filters.action);
      conditions.push(`a.accion = $${params.length}`);
    }
    if (filters.from !== undefined && filters.from !== '') {
      params.push(`${filters.from}T00:00:00.000Z`);
      conditions.push(`a.creado_en >= $${params.length}`);
    }
    if (filters.to !== undefined && filters.to !== '') {
      params.push(`${filters.to}T23:59:59.999Z`);
      conditions.push(`a.creado_en <= $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await this.db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM auditoria a
         JOIN usuario u ON u.id = a.usuario_id
         ${where}`,
      params,
    );
    const total = Number.parseInt(countResult.rows[0]?.total ?? '0', 10);
    const offset = (filters.page - 1) * filters.pageSize;
    params.push(filters.pageSize, offset);
    const rows = await this.db.query<{
      id: number;
      actor_id: number;
      actor_email: string | null;
      accion: string;
      recurso_tipo: string;
      recurso_id: string | null;
      detalle: Record<string, unknown>;
      creado_en: Date;
    }>(
      `SELECT a.id, a.usuario_id AS actor_id, u.email AS actor_email, a.accion,
              a.recurso_tipo, a.recurso_id, a.detalle, a.creado_en
         FROM auditoria a
         JOIN usuario u ON u.id = a.usuario_id
         ${where}
         ORDER BY a.creado_en DESC, a.id DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      items: rows.rows.map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        actorEmail: row.actor_email,
        action: row.accion,
        resourceType: row.recurso_tipo,
        resourceId: row.recurso_id,
        detail: row.detalle,
        createdAt: row.creado_en.toISOString(),
      })),
      page: filters.page,
      pageSize: filters.pageSize,
      total,
    };
  }
}
