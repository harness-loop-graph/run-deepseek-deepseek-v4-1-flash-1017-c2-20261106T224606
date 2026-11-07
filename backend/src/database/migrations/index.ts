export interface Migration {
  version: string;
  description: string;
  up: string[];
  down: string[];
}

export const migration001Identity: Migration = {
  version: '001_identity',
  description: 'roles, users, patients and professionals',
  up: [
    `CREATE TABLE rol (
       id serial PRIMARY KEY,
       nombre text NOT NULL UNIQUE,
       CONSTRAINT rol_nombre_check CHECK (nombre IN ('patient', 'professional', 'staff', 'admin'))
     )`,
    `CREATE TABLE usuario (
       id serial PRIMARY KEY,
       email text NOT NULL UNIQUE,
       password_hash text NOT NULL,
       activo boolean NOT NULL DEFAULT true,
       creado_en timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT usuario_email_check CHECK (position('@' in email) > 1)
     )`,
    `CREATE TABLE usuario_rol (
       usuario_id integer NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
       rol_id integer NOT NULL REFERENCES rol(id) ON DELETE RESTRICT,
       PRIMARY KEY (usuario_id, rol_id)
     )`,
    `CREATE TABLE paciente (
       id serial PRIMARY KEY,
       usuario_id integer NOT NULL UNIQUE REFERENCES usuario(id) ON DELETE RESTRICT,
       nombre text NOT NULL,
       apellidos text NOT NULL,
       fecha_nacimiento date NOT NULL,
       documento text NOT NULL UNIQUE
     )`,
    `CREATE TABLE profesional (
       id serial PRIMARY KEY,
       usuario_id integer NOT NULL UNIQUE REFERENCES usuario(id) ON DELETE RESTRICT,
       nombre text NOT NULL,
       apellidos text NOT NULL,
       especialidad text NOT NULL
     )`,
  ],
  down: [
    `DROP TABLE IF EXISTS profesional`,
    `DROP TABLE IF EXISTS paciente`,
    `DROP TABLE IF EXISTS usuario_rol`,
    `DROP TABLE IF EXISTS usuario`,
    `DROP TABLE IF EXISTS rol`,
  ],
};

export const migration002Clinical: Migration = {
  version: '002_clinical',
  description: 'availability, appointments, encounters, attachments and audit log',
  up: [
    `CREATE TABLE disponibilidad (
       id serial PRIMARY KEY,
       profesional_id integer NOT NULL REFERENCES profesional(id) ON DELETE RESTRICT,
       franja_inicio timestamptz NOT NULL,
       franja_fin timestamptz NOT NULL,
       CONSTRAINT disponibilidad_rango_check CHECK (franja_fin > franja_inicio),
       CONSTRAINT disponibilidad_unica UNIQUE (profesional_id, franja_inicio)
     )`,
    `CREATE TABLE cita (
       id serial PRIMARY KEY,
       paciente_id integer NOT NULL REFERENCES paciente(id) ON DELETE RESTRICT,
       profesional_id integer NOT NULL REFERENCES profesional(id) ON DELETE RESTRICT,
       franja_inicio timestamptz NOT NULL,
       franja_fin timestamptz NOT NULL,
       estado text NOT NULL DEFAULT 'scheduled',
       creado_en timestamptz NOT NULL DEFAULT now(),
       cancelada_en timestamptz,
       CONSTRAINT cita_estado_check CHECK (estado IN ('scheduled', 'attended', 'cancelled', 'no_show')),
       CONSTRAINT cita_rango_check CHECK (franja_fin > franja_inicio)
     )`,
    `CREATE UNIQUE INDEX cita_slot_activo_unico
       ON cita (profesional_id, franja_inicio)
       WHERE estado <> 'cancelled'`,
    `CREATE TABLE encuentro (
       id serial PRIMARY KEY,
       cita_id integer NOT NULL REFERENCES cita(id) ON DELETE RESTRICT,
       paciente_id integer NOT NULL REFERENCES paciente(id) ON DELETE RESTRICT,
       profesional_id integer NOT NULL REFERENCES profesional(id) ON DELETE RESTRICT,
       version integer NOT NULL,
       reemplaza_a integer REFERENCES encuentro(id) ON DELETE RESTRICT,
       notas text NOT NULL,
       diagnostico text NOT NULL,
       creado_en timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT encuentro_version_check CHECK (version > 0),
       CONSTRAINT encuentro_cita_version_unica UNIQUE (cita_id, version)
     )`,
    `CREATE TABLE adjunto (
       id serial PRIMARY KEY,
       encuentro_id integer NOT NULL REFERENCES encuentro(id) ON DELETE RESTRICT,
       nombre_archivo text NOT NULL,
       tipo_mime text NOT NULL,
       tamano_bytes integer NOT NULL,
       ruta_almacenamiento text NOT NULL,
       subido_por integer NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
       creado_en timestamptz NOT NULL DEFAULT now(),
       CONSTRAINT adjunto_tamano_check CHECK (tamano_bytes > 0)
     )`,
    `CREATE TABLE auditoria (
       id serial PRIMARY KEY,
       usuario_id integer NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
       accion text NOT NULL,
       recurso_tipo text NOT NULL,
       recurso_id text,
       detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
       creado_en timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE FUNCTION impedir_mutacion_clinica() RETURNS trigger
       LANGUAGE plpgsql AS $$
       BEGIN
         RAISE EXCEPTION 'append-only table: % cannot be modified', TG_TABLE_NAME;
       END;
     $$`,
    `CREATE TRIGGER encuentro_append_only
       BEFORE UPDATE OR DELETE ON encuentro
       FOR EACH ROW EXECUTE FUNCTION impedir_mutacion_clinica()`,
    `CREATE TRIGGER auditoria_append_only
       BEFORE UPDATE OR DELETE ON auditoria
       FOR EACH ROW EXECUTE FUNCTION impedir_mutacion_clinica()`,
  ],
  down: [
    `DROP TRIGGER IF EXISTS auditoria_append_only ON auditoria`,
    `DROP TRIGGER IF EXISTS encuentro_append_only ON encuentro`,
    `DROP FUNCTION IF EXISTS impedir_mutacion_clinica()`,
    `DROP TABLE IF EXISTS auditoria`,
    `DROP TABLE IF EXISTS adjunto`,
    `DROP TABLE IF EXISTS encuentro`,
    `DROP INDEX IF EXISTS cita_slot_activo_unico`,
    `DROP TABLE IF EXISTS cita`,
    `DROP TABLE IF EXISTS disponibilidad`,
  ],
};

export const migration003Oauth: Migration = {
  version: '003_oauth',
  description: 'authorization codes and token sessions for the PKCE flow',
  up: [
    `CREATE TABLE codigo_autorizacion (
       id serial PRIMARY KEY,
       codigo_hash text NOT NULL UNIQUE,
       usuario_id integer NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
       client_id text NOT NULL,
       redirect_uri text NOT NULL,
       code_challenge text NOT NULL,
       usado boolean NOT NULL DEFAULT false,
       expira_en timestamptz NOT NULL,
       creado_en timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE TABLE sesion (
       id serial PRIMARY KEY,
       usuario_id integer NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
       access_hash text NOT NULL UNIQUE,
       refresh_hash text NOT NULL UNIQUE,
       access_expira_en timestamptz NOT NULL,
       refresh_expira_en timestamptz NOT NULL,
       revocada boolean NOT NULL DEFAULT false,
       creada_en timestamptz NOT NULL DEFAULT now()
     )`,
  ],
  down: [`DROP TABLE IF EXISTS sesion`, `DROP TABLE IF EXISTS codigo_autorizacion`],
};

export const migration004Indexes: Migration = {
  version: '004_indexes',
  description: 'indexes for every filtered or ordered column used by the endpoint catalog',
  up: [
    `CREATE INDEX disponibilidad_profesional_inicio_idx ON disponibilidad (profesional_id, franja_inicio)`,
    `CREATE INDEX cita_paciente_idx ON cita (paciente_id, franja_inicio)`,
    `CREATE INDEX cita_profesional_idx ON cita (profesional_id, franja_inicio)`,
    `CREATE INDEX cita_franja_inicio_idx ON cita (franja_inicio)`,
    `CREATE INDEX cita_estado_idx ON cita (estado)`,
    `CREATE INDEX encuentro_cita_idx ON encuentro (cita_id)`,
    `CREATE INDEX encuentro_paciente_idx ON encuentro (paciente_id, creado_en)`,
    `CREATE INDEX encuentro_profesional_idx ON encuentro (profesional_id)`,
    `CREATE INDEX adjunto_encuentro_idx ON adjunto (encuentro_id)`,
    `CREATE INDEX auditoria_usuario_idx ON auditoria (usuario_id, creado_en)`,
    `CREATE INDEX auditoria_accion_idx ON auditoria (accion)`,
    `CREATE INDEX auditoria_creado_en_idx ON auditoria (creado_en)`,
    `CREATE INDEX sesion_usuario_idx ON sesion (usuario_id)`,
    `CREATE INDEX sesion_refresh_idx ON sesion (refresh_hash)`,
    `CREATE INDEX codigo_autorizacion_expira_idx ON codigo_autorizacion (expira_en)`,
  ],
  down: [
    `DROP INDEX IF EXISTS codigo_autorizacion_expira_idx`,
    `DROP INDEX IF EXISTS sesion_refresh_idx`,
    `DROP INDEX IF EXISTS sesion_usuario_idx`,
    `DROP INDEX IF EXISTS auditoria_creado_en_idx`,
    `DROP INDEX IF EXISTS auditoria_accion_idx`,
    `DROP INDEX IF EXISTS auditoria_usuario_idx`,
    `DROP INDEX IF EXISTS adjunto_encuentro_idx`,
    `DROP INDEX IF EXISTS encuentro_profesional_idx`,
    `DROP INDEX IF EXISTS encuentro_paciente_idx`,
    `DROP INDEX IF EXISTS encuentro_cita_idx`,
    `DROP INDEX IF EXISTS cita_estado_idx`,
    `DROP INDEX IF EXISTS cita_franja_inicio_idx`,
    `DROP INDEX IF EXISTS cita_profesional_idx`,
    `DROP INDEX IF EXISTS cita_paciente_idx`,
    `DROP INDEX IF EXISTS disponibilidad_profesional_inicio_idx`,
  ],
};

/**
 * One session can hold several live access tokens: a refresh rotates the
 * refresh token and issues a new access token without invalidating the one the
 * client is still using, while revocation still kills the whole session at
 * once (RF-08).
 */
export const migration005AccessTokens: Migration = {
  version: '005_access_tokens',
  description: 'additional access tokens issued by a refresh of the same session',
  up: [
    `CREATE TABLE token_acceso (
       id serial PRIMARY KEY,
       sesion_id integer NOT NULL REFERENCES sesion(id) ON DELETE CASCADE,
       token_hash text NOT NULL UNIQUE,
       expira_en timestamptz NOT NULL,
       creado_en timestamptz NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX token_acceso_sesion_idx ON token_acceso (sesion_id)`,
    `CREATE INDEX token_acceso_expira_idx ON token_acceso (expira_en)`,
  ],
  down: [
    `DROP INDEX IF EXISTS token_acceso_expira_idx`,
    `DROP INDEX IF EXISTS token_acceso_sesion_idx`,
    `DROP TABLE IF EXISTS token_acceso`,
  ],
};

export const migrations: Migration[] = [
  migration001Identity,
  migration002Clinical,
  migration003Oauth,
  migration004Indexes,
  migration005AccessTokens,
];
