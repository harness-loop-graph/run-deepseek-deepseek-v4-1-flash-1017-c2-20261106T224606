import { Logger } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { hashPassword } from '../../common/crypto';
import { loadConfig } from '../../config/config';
import type { RoleName } from '../../config/config';

const logger = new Logger('Seed');

export const SEED_USERS: Array<{
  email: string;
  roles: RoleName[];
  nombre: string;
  apellidos: string;
  extra?: { fechaNacimiento: string; documento: string } | { especialidad: string };
}> = [
  {
    email: 'admin@seed.local',
    roles: ['admin'],
    nombre: 'Ada',
    apellidos: 'Administradora',
  },
  {
    email: 'staff@seed.local',
    roles: ['staff'],
    nombre: 'Sara',
    apellidos: 'Staff',
  },
  {
    email: 'paciente1@seed.local',
    roles: ['patient'],
    nombre: 'Ana',
    apellidos: 'Paciente Uno',
    extra: { fechaNacimiento: '1985-04-12', documento: 'DOC-0001' },
  },
  {
    email: 'paciente2@seed.local',
    roles: ['patient'],
    nombre: 'Bruno',
    apellidos: 'Paciente Dos',
    extra: { fechaNacimiento: '1990-09-23', documento: 'DOC-0002' },
  },
  {
    email: 'paciente3@seed.local',
    roles: ['patient'],
    nombre: 'Carla',
    apellidos: 'Paciente Tres',
    extra: { fechaNacimiento: '1978-01-30', documento: 'DOC-0003' },
  },
  {
    email: 'gomez@seed.local',
    roles: ['professional'],
    nombre: 'Laura',
    apellidos: 'Gómez',
    extra: { especialidad: 'Medicina general' },
  },
  {
    email: 'lopez@seed.local',
    roles: ['professional'],
    nombre: 'Martín',
    apellidos: 'López',
    extra: { especialidad: 'Cardiología' },
  },
];

const SLOT_MINUTES = 30;
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 16;
const AVAILABILITY_DAYS = 14;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function availabilityWindowsFor(
  professionalId: number,
  from: Date,
  days = AVAILABILITY_DAYS,
): Array<{ start: Date; end: Date }> {
  const windows: Array<{ start: Date; end: Date }> = [];
  const base = startOfUtcDay(from);
  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const day = new Date(base.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const weekday = day.getUTCDay(); // 0 Sunday .. 6 Saturday
    if (weekday === 0 || weekday === 6) {
      continue;
    }
    // López has no slots on Fridays (RF-05).
    if (professionalId === 2 && weekday === 5) {
      continue;
    }
    for (let minutes = DAY_START_HOUR * 60; minutes < DAY_END_HOUR * 60; minutes += SLOT_MINUTES) {
      const start = new Date(day.getTime() + minutes * 60 * 1000);
      const end = new Date(start.getTime() + SLOT_MINUTES * 60 * 1000);
      windows.push({ start, end });
    }
  }
  return windows;
}

async function seedRoles(db: DatabaseService): Promise<Map<RoleName, number>> {
  const roles: RoleName[] = ['patient', 'professional', 'staff', 'admin'];
  for (const role of roles) {
    await db.query('INSERT INTO rol (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [role]);
  }
  const result = await db.query<{ id: number; nombre: RoleName }>('SELECT id, nombre FROM rol');
  const map = new Map<RoleName, number>();
  for (const row of result.rows) {
    map.set(row.nombre, row.id);
  }
  return map;
}

async function seedUsers(db: DatabaseService, roleIds: Map<RoleName, number>): Promise<void> {
  const config = loadConfig();
  const passwordHash = await hashPassword(config.seedPassword);

  for (const user of SEED_USERS) {
    const existing = await db.query<{ id: number }>('SELECT id FROM usuario WHERE email = $1', [
      user.email,
    ]);
    let userId: number;
    if (existing.rowCount && existing.rowCount > 0) {
      userId = existing.rows[0].id;
    } else {
      const inserted = await db.query<{ id: number }>(
        'INSERT INTO usuario (email, password_hash, activo) VALUES ($1, $2, true) RETURNING id',
        [user.email, passwordHash],
      );
      userId = inserted.rows[0].id;
    }

    for (const role of user.roles) {
      const roleId = roleIds.get(role);
      if (roleId === undefined) {
        throw new Error(`Seed role ${role} was not created`);
      }
      await db.query(
        'INSERT INTO usuario_rol (usuario_id, rol_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, roleId],
      );
    }

    if (roleIds.has('patient') && user.roles.includes('patient') && user.extra) {
      const extra = user.extra as { fechaNacimiento: string; documento: string };
      await db.query(
        `INSERT INTO paciente (usuario_id, nombre, apellidos, fecha_nacimiento, documento)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (usuario_id) DO NOTHING`,
        [userId, user.nombre, user.apellidos, extra.fechaNacimiento, extra.documento],
      );
    }

    if (user.roles.includes('professional') && user.extra) {
      const extra = user.extra as { especialidad: string };
      await db.query(
        `INSERT INTO profesional (usuario_id, nombre, apellidos, especialidad)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (usuario_id) DO NOTHING`,
        [userId, user.nombre, user.apellidos, extra.especialidad],
      );
    }
  }
}

async function seedAvailability(db: DatabaseService): Promise<void> {
  const professionals = await db.query<{ id: number }>('SELECT id FROM profesional ORDER BY id');
  const today = new Date();
  for (const professional of professionals.rows) {
    const windows = availabilityWindowsFor(professional.id, today);
    for (const window of windows) {
      await db.query(
        `INSERT INTO disponibilidad (profesional_id, franja_inicio, franja_fin)
         VALUES ($1, $2, $3)
         ON CONFLICT (profesional_id, franja_inicio) DO NOTHING`,
        [professional.id, window.start.toISOString(), window.end.toISOString()],
      );
    }
  }
}

export async function runSeed(db: DatabaseService): Promise<void> {
  const roleIds = await seedRoles(db);
  await seedUsers(db, roleIds);
  await seedAvailability(db);
  logger.log('Deterministic seed completed');
}
