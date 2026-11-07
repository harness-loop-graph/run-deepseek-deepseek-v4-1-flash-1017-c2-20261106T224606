import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { sha256Hex, randomToken, verifyPassword } from '../common/crypto';
import { badRequest, unauthorized } from '../common/errors';
import { AuditService } from '../audit/audit.service';

const CODE_TTL_SECONDS = 120;

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_expires_in: number;
  user: {
    id: number;
    email: string;
    roles: string[];
    patientId: number | null;
    professionalId: number | null;
  };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  validateClient(clientId: string, redirectUri: string): void {
    if (clientId !== this.config.oauthClientId) {
      throw badRequest('Unknown client_id');
    }
    if (redirectUri !== this.config.oauthRedirectUri) {
      throw badRequest('Unregistered redirect_uri');
    }
  }

  async authenticate(email: string, password: string): Promise<{ userId: number; email: string }> {
    const result = await this.db.query<{
      id: number;
      email: string;
      password_hash: string;
      activo: boolean;
    }>('SELECT id, email, password_hash, activo FROM usuario WHERE lower(email) = lower($1)', [
      email,
    ]);
    if (!result.rowCount || result.rowCount === 0) {
      throw unauthorized('Invalid credentials');
    }
    const user = result.rows[0];
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid || !user.activo) {
      throw unauthorized('Invalid credentials');
    }
    return { userId: user.id, email: user.email };
  }

  async createAuthorizationCode(
    userId: number,
    clientId: string,
    redirectUri: string,
    codeChallenge: string,
  ): Promise<string> {
    const code = randomToken(32);
    await this.db.query(
      `INSERT INTO codigo_autorizacion
         (codigo_hash, usuario_id, client_id, redirect_uri, code_challenge, expira_en)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)`,
      [sha256Hex(code), userId, clientId, redirectUri, codeChallenge, String(CODE_TTL_SECONDS)],
    );
    await this.audit.record({
      actorId: userId,
      action: 'authorization_code_issued',
      resourceType: 'codigo_autorizacion',
      resourceId: null,
    });
    return code;
  }

  /**
   * EP-02: the code must exist, belong to this client and redirect URI, not be
   * used or expired, and the verifier must hash to the stored S256 challenge.
   */
  async exchangeCode(
    code: string,
    codeVerifier: string,
    clientId: string,
    redirectUri: string,
  ): Promise<TokenResponse> {
    const result = await this.db.query<{
      id: number;
      usuario_id: number;
      client_id: string;
      redirect_uri: string;
      code_challenge: string;
      usado: boolean;
      expira_en: Date;
    }>(
      `SELECT id, usuario_id, client_id, redirect_uri, code_challenge, usado, expira_en
         FROM codigo_autorizacion
        WHERE codigo_hash = $1`,
      [sha256Hex(code)],
    );
    const row = result.rows[0];
    if (!row || row.usado || row.expira_en.getTime() <= Date.now()) {
      throw unauthorized('Invalid authorization code');
    }
    if (row.client_id !== clientId || row.redirect_uri !== redirectUri) {
      throw badRequest('The authorization code was issued to another client');
    }

    const expectedChallenge = Buffer.from(sha256Hex(codeVerifier), 'hex').toString('base64url');
    if (expectedChallenge !== row.code_challenge) {
      throw badRequest('Code verifier does not match the challenge');
    }

    const consumed = await this.db.query(
      'UPDATE codigo_autorizacion SET usado = true WHERE id = $1 AND usado = false',
      [row.id],
    );
    if (!consumed.rowCount) {
      throw unauthorized('Invalid authorization code');
    }

    return this.issueSession(row.usuario_id);
  }

  /** Issues a session (refresh token, 8 h) plus its first access token (15 min). */
  async issueSession(userId: number): Promise<TokenResponse> {
    const accessToken = randomBytes(32).toString('base64url');
    const refreshToken = randomBytes(32).toString('base64url');
    const session = await this.db.query<{ id: number }>(
      `INSERT INTO sesion
         (usuario_id, access_hash, access_expira_en, refresh_hash, refresh_expira_en)
       VALUES ($1, $2, now() + ($3 || ' seconds')::interval,
               $4, now() + ($5 || ' seconds')::interval)
       RETURNING id`,
      [
        userId,
        sha256Hex(accessToken),
        String(this.config.accessTokenTtlSeconds),
        sha256Hex(refreshToken),
        String(this.config.refreshTokenTtlSeconds),
      ],
    );
    const profile = await this.loadProfile(userId);
    await this.audit.record({
      actorId: userId,
      action: 'token_issued',
      resourceType: 'sesion',
      resourceId: session.rows[0].id,
    });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.config.accessTokenTtlSeconds,
      refresh_expires_in: this.config.refreshTokenTtlSeconds,
      user: profile,
    };
  }

  /**
   * EP-03: rotates the refresh token of a live session and issues a fresh
   * access token. Access tokens that have not reached their own expiry remain
   * usable, which is exactly the 15 minute lifetime declared by RF-08.
   */
  async refresh(refreshToken: string): Promise<TokenResponse> {
    const hash = sha256Hex(refreshToken);
    const result = await this.db.query<{
      id: number;
      usuario_id: number;
      revocada: boolean;
      refresh_expira_en: Date;
    }>('SELECT id, usuario_id, revocada, refresh_expira_en FROM sesion WHERE refresh_hash = $1', [
      hash,
    ]);
    if (!result.rowCount || result.rowCount === 0) {
      throw unauthorized('Invalid refresh token');
    }
    const row = result.rows[0];
    if (row.revocada || row.refresh_expira_en.getTime() <= Date.now()) {
      throw unauthorized('Refresh token expired or revoked');
    }

    const accessToken = randomBytes(32).toString('base64url');
    const newRefreshToken = randomBytes(32).toString('base64url');
    const updated = await this.db.query(
      `UPDATE sesion
          SET refresh_hash = $1,
              refresh_expira_en = now() + ($2 || ' seconds')::interval
        WHERE id = $3 AND revocada = false`,
      [sha256Hex(newRefreshToken), String(this.config.refreshTokenTtlSeconds), row.id],
    );
    if (!updated.rowCount) {
      throw unauthorized('Refresh token expired or revoked');
    }
    await this.db.query(
      `INSERT INTO token_acceso (sesion_id, token_hash, expira_en)
       VALUES ($1, $2, now() + ($3 || ' seconds')::interval)`,
      [row.id, sha256Hex(accessToken), String(this.config.accessTokenTtlSeconds)],
    );

    const profile = await this.loadProfile(row.usuario_id);
    return {
      access_token: accessToken,
      refresh_token: newRefreshToken,
      token_type: 'Bearer',
      expires_in: this.config.accessTokenTtlSeconds,
      refresh_expires_in: this.config.refreshTokenTtlSeconds,
      user: profile,
    };
  }

  /** EP-04: revocation is immediate for every token of the session. */
  async revoke(token: string): Promise<void> {
    const hash = sha256Hex(token);
    const result = await this.db.query<{ sesion_id: number; usuario_id: number }>(
      `SELECT s.id AS sesion_id, s.usuario_id
         FROM sesion s
        WHERE s.refresh_hash = $1 OR s.access_hash = $1
       UNION ALL
       SELECT s.id AS sesion_id, s.usuario_id
         FROM token_acceso t
         JOIN sesion s ON s.id = t.sesion_id
        WHERE t.token_hash = $1`,
      [hash],
    );
    if (!result.rowCount || result.rowCount === 0) {
      throw unauthorized('Unknown token');
    }
    const row = result.rows[0];
    await this.db.query('UPDATE sesion SET revocada = true WHERE id = $1', [row.sesion_id]);
    await this.audit.record({
      actorId: row.usuario_id,
      action: 'token_revoked',
      resourceType: 'sesion',
      resourceId: row.sesion_id,
    });
  }

  async loadProfile(userId: number): Promise<TokenResponse['user']> {
    const userResult = await this.db.query<{ id: number; email: string }>(
      'SELECT id, email FROM usuario WHERE id = $1',
      [userId],
    );
    if (!userResult.rowCount) {
      throw unauthorized('Unknown user');
    }
    const rolesResult = await this.db.query<{ nombre: string }>(
      `SELECT r.nombre FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id
        WHERE ur.usuario_id = $1 ORDER BY r.nombre`,
      [userId],
    );
    const patientResult = await this.db.query<{ id: number }>(
      'SELECT id FROM paciente WHERE usuario_id = $1',
      [userId],
    );
    const professionalResult = await this.db.query<{ id: number }>(
      'SELECT id FROM profesional WHERE usuario_id = $1',
      [userId],
    );
    return {
      id: userResult.rows[0].id,
      email: userResult.rows[0].email,
      roles: rolesResult.rows.map((row) => row.nombre),
      patientId: patientResult.rows[0]?.id ?? null,
      professionalId: professionalResult.rows[0]?.id ?? null,
    };
  }
}
