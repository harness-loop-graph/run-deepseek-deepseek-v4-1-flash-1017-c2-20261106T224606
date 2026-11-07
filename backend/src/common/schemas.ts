import { z } from 'zod';
import {
  dateOnlySchema,
  emailSchema,
  idSchema,
  isoDateTimeSchema,
  roleSchema,
} from './validation';

/**
 * Every request schema lives here: a single, testable source of truth for the
 * boundary validation of each endpoint. Object schemas are strict, so
 * undeclared fields are rejected with 422 and never silently ignored (RF-12).
 */

export const authorizeQuerySchema = z
  .object({
    response_type: z.literal('code'),
    client_id: z.string().min(1).max(120),
    redirect_uri: z.string().min(1).max(500),
    code_challenge: z.string().min(43).max(128),
    code_challenge_method: z.literal('S256'),
    state: z.string().min(1).max(512),
  })
  .strict();

export const loginQuerySchema = z
  .object({
    client_id: z.string().min(1).max(120),
    redirect_uri: z.string().min(1).max(500),
    code_challenge: z.string().min(43).max(128),
    state: z.string().min(1).max(512),
  })
  .strict();

export const loginBodySchema = loginQuerySchema
  .extend({
    email: z.string().trim().min(3).max(255),
    password: z.string().min(1).max(200),
  })
  .strict();

export const tokenBodySchema = z
  .object({
    code: z.string().min(1).max(512),
    code_verifier: z.string().min(43).max(128),
    client_id: z.string().min(1).max(120),
    redirect_uri: z.string().min(1).max(500),
  })
  .strict();

export const refreshBodySchema = z
  .object({ refresh_token: z.string().min(1).max(512) })
  .strict();

export const revokeBodySchema = z.object({ token: z.string().min(1).max(512) }).strict();

export const bookingBodySchema = z
  .object({
    professionalId: z.coerce.number().int().positive(),
    slotStart: z.string().min(10).max(64),
  })
  .strict();

export const idParamSchema = z.object({ id: idSchema }).strict();

/**
 * Endpoints with no declared query string (EP-05, EP-10, EP-12, EP-14, ...)
 * still validate their input: an undeclared parameter is a 422, not ignored.
 */
export const emptyQuerySchema = z.object({}).strict();

export const agendaQuerySchema = z
  .object({
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
  })
  .strict();

export const availabilityQuerySchema = z
  .object({
    professionalId: z.coerce.number().int().positive(),
    from: dateOnlySchema,
    to: dateOnlySchema,
  })
  .strict();

export const encounterBodySchema = z
  .object({
    notes: z.string().trim().min(1, 'notes is required').max(20_000),
    diagnosis: z.string().trim().min(1, 'diagnosis is required').max(5_000),
  })
  .strict();

export const pageQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const createUserSchema = z
  .object({
    email: emailSchema,
    roles: z.array(roleSchema).min(1).max(4),
  })
  .strict();

export const updateRolesSchema = z
  .object({ roles: z.array(roleSchema).min(1).max(4) })
  .strict();

export const availabilitySlotSchema = z
  .object({ start: isoDateTimeSchema, end: isoDateTimeSchema })
  .strict();

export const replaceAvailabilitySchema = z
  .object({ slots: z.array(availabilitySlotSchema).max(500) })
  .strict();

export const auditQuerySchema = z
  .object({
    actor: z.string().min(1).max(255).optional(),
    action: z.string().min(1).max(120).optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
