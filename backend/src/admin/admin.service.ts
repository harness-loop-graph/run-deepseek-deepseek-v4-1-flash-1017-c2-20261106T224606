import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { conflict, notFound, validationError } from '../common/errors';
import { hashPassword } from '../common/crypto';
import { APP_CONFIG, AppConfig, RoleName, ROLE_NAMES } from '../config/config';
import { AuditService } from '../audit/audit.service';

export interface AdminUserView {
  id: number;
  email: string;
  active: boolean;
  roles: RoleName[];
  createdAt: string;
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** A repeated role in the request is the same role, not a second assignment. */
  private normalizeRoles(roles: RoleName[]): RoleName[] {
    return [...new Set(roles)];
  }

  async listUsers(
    page: number,
    pageSize: number,
  ): Promise<{ items: AdminUserView[]; page: number; pageSize: number; total: number }> {
    const countResult = await this.db.query<{ total: string }>(
      'SELECT COUNT(*)::text AS total FROM usuario',
    );
    const total = Number.parseInt(countResult.rows[0]?.total ?? '0', 10);
    const result = await this.db.query<{
      id: number;
      email: string;
      activo: boolean;
      creado_en: Date;
      roles: string[] | null;
    }>(
      `SELECT u.id, u.email, u.activo, u.creado_en,
              array_remove(array_agg(r.nombre ORDER BY r.nombre), NULL) AS roles
         FROM usuario u
         LEFT JOIN usuario_rol ur ON ur.usuario_id = u.id
         LEFT JOIN rol r ON r.id = ur.rol_id
        GROUP BY u.id, u.email, u.activo, u.creado_en
        ORDER BY u.id
        LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        active: row.activo,
        roles: (row.roles ?? []) as RoleName[],
        createdAt: row.creado_en.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  private async roleIdsFor(roles: RoleName[]): Promise<Map<RoleName, number>> {
    const result = await this.db.query<{ id: number; nombre: RoleName }>(
      'SELECT id, nombre FROM rol WHERE nombre = ANY($1::text[])',
      [roles],
    );
    const map = new Map<RoleName, number>();
    for (const row of result.rows) {
      map.set(row.nombre, row.id);
    }
    for (const role of roles) {
      if (!map.has(role)) {
        throw validationError(`Unknown role: ${role}`);
      }
    }
    return map;
  }

  async createUser(
    actorId: number,
    email: string,
    roles: RoleName[],
  ): Promise<AdminUserView> {
    const existing = await this.db.query('SELECT 1 FROM usuario WHERE lower(email) = lower($1)', [
      email,
    ]);
    if (existing.rowCount && existing.rowCount > 0) {
      throw conflict('A user with that email already exists');
    }
    const normalized = this.normalizeRoles(roles);
    const roleIds = await this.roleIdsFor(normalized);
    const passwordHash = await hashPassword(this.config.seedPassword);

    const created = await this.db.transaction(async (client) => {
      const inserted = await client.query<{
        id: number;
        email: string;
        activo: boolean;
        creado_en: Date;
      }>(
        'INSERT INTO usuario (email, password_hash, activo) VALUES ($1, $2, true) RETURNING id, email, activo, creado_en',
        [email, passwordHash],
      );
      const user = inserted.rows[0];
      for (const role of normalized) {
        await client.query('INSERT INTO usuario_rol (usuario_id, rol_id) VALUES ($1, $2)', [
          user.id,
          roleIds.get(role),
        ]);
      }
      return user;
    });

    await this.audit.record({
      actorId,
      action: 'user_created',
      resourceType: 'usuario',
      resourceId: created.id,
      detail: { email: created.email, roles: normalized },
    });

    return {
      id: created.id,
      email: created.email,
      active: created.activo,
      roles: normalized,
      createdAt: created.creado_en.toISOString(),
    };
  }

  async updateRoles(
    actorId: number,
    userId: number,
    roles: RoleName[],
  ): Promise<AdminUserView> {
    const user = await this.db.query<{ id: number; email: string; activo: boolean; creado_en: Date }>(
      'SELECT id, email, activo, creado_en FROM usuario WHERE id = $1',
      [userId],
    );
    if (!user.rowCount || user.rowCount === 0) {
      throw notFound('User not found');
    }
    const normalized = this.normalizeRoles(roles);
    const roleIds = await this.roleIdsFor(normalized);
    await this.db.transaction(async (client) => {
      await client.query('DELETE FROM usuario_rol WHERE usuario_id = $1', [userId]);
      for (const role of normalized) {
        await client.query('INSERT INTO usuario_rol (usuario_id, rol_id) VALUES ($1, $2)', [
          userId,
          roleIds.get(role),
        ]);
      }
    });
    await this.audit.record({
      actorId,
      action: 'user_roles_updated',
      resourceType: 'usuario',
      resourceId: userId,
      detail: { roles: normalized },
    });
    const row = user.rows[0];
    return {
      id: row.id,
      email: row.email,
      active: row.activo,
      roles: normalized,
      createdAt: row.creado_en.toISOString(),
    };
  }

  static isValidRole(role: string): role is RoleName {
    return (ROLE_NAMES as readonly string[]).includes(role);
  }
}
