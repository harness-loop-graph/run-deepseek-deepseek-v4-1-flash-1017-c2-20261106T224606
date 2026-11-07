import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { sha256Hex } from './crypto';
import { isAccessTokenUsable } from './session-policy';

export interface SessionUser {
  sessionId: number;
  userId: number;
  email: string;
  roles: string[];
}

interface AccessTokenRow {
  sesion_id: number;
  usuario_id: number;
  email: string;
  revocada: boolean;
  access_expira_en: Date;
}

/**
 * Resolves a bearer token to a live session. An access token is either the one
 * stored on the session row (the first token of the session) or one of the
 * additional tokens issued by a refresh (table `token_acceso`). In both cases
 * the session must not be revoked and the token must not have expired (RF-08).
 */
@Injectable()
export class TokenService {
  constructor(private readonly db: DatabaseService) {}

  async findByAccessToken(accessToken: string): Promise<SessionUser | null> {
    const hash = sha256Hex(accessToken);
    const result = await this.db.query<AccessTokenRow>(
      `SELECT s.id AS sesion_id, u.id AS usuario_id, u.email, s.revocada,
              s.access_expira_en
         FROM sesion s
         JOIN usuario u ON u.id = s.usuario_id
        WHERE s.access_hash = $1
       UNION ALL
       SELECT s.id AS sesion_id, u.id AS usuario_id, u.email, s.revocada,
              t.expira_en AS access_expira_en
         FROM token_acceso t
         JOIN sesion s ON s.id = t.sesion_id
         JOIN usuario u ON u.id = s.usuario_id
        WHERE t.token_hash = $1`,
      [hash],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }
    if (!isAccessTokenUsable({ revoked: row.revocada, accessExpiresAt: row.access_expira_en })) {
      return null;
    }
    const roles = await this.loadRoles(row.usuario_id);
    return { sessionId: row.sesion_id, userId: row.usuario_id, email: row.email, roles };
  }

  async loadRoles(userId: number): Promise<string[]> {
    const result = await this.db.query<{ nombre: string }>(
      `SELECT r.nombre
         FROM usuario_rol ur
         JOIN rol r ON r.id = ur.rol_id
        WHERE ur.usuario_id = $1
        ORDER BY r.nombre`,
      [userId],
    );
    return result.rows.map((row) => row.nombre);
  }
}
