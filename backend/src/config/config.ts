export const APP_CONFIG = 'APP_CONFIG';

export type RoleName = 'patient' | 'professional' | 'staff' | 'admin';

export const ROLE_NAMES: readonly RoleName[] = ['patient', 'professional', 'staff', 'admin'];

export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  seedPassword: string;
  frontendOrigin: string;
  oauthClientId: string;
  oauthRedirectUri: string;
  backendPublicUrl: string;
  attachmentsDir: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  maxAttachmentBytes: number;
  authRateLimit: number;
  bookingRateLimit: number;
}

function readString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return parsed;
}

export function loadConfig(): AppConfig {
  return {
    nodeEnv: readString('NODE_ENV', 'development'),
    port: readInt('PORT', 3000),
    databaseUrl: readString(
      'DATABASE_URL',
      'postgres://medapp:medapp@localhost:5432/medapp',
    ),
    seedPassword: readString('SEED_PASSWORD', 'Seed!Passw0rd'),
    frontendOrigin: readString('FRONTEND_ORIGIN', 'http://localhost:8080'),
    oauthClientId: readString('OAUTH_CLIENT_ID', 'medapp-spa'),
    oauthRedirectUri: readString(
      'OAUTH_REDIRECT_URI',
      'http://localhost:8080/auth/callback',
    ),
    backendPublicUrl: readString(
      'BACKEND_PUBLIC_URL',
      'http://localhost:3000',
    ).replace(/\/$/, ''),
    attachmentsDir: readString('ATTACHMENTS_DIR', '/app/storage/attachments'),
    accessTokenTtlSeconds: readInt('ACCESS_TOKEN_TTL_SECONDS', 900),
    refreshTokenTtlSeconds: readInt('REFRESH_TOKEN_TTL_SECONDS', 28800),
    maxAttachmentBytes: readInt('MAX_ATTACHMENT_BYTES', 5 * 1024 * 1024),
    authRateLimit: readInt('AUTH_RATE_LIMIT_PER_MINUTE', 5),
    bookingRateLimit: readInt('BOOKING_RATE_LIMIT_PER_MINUTE', 10),
  };
}
