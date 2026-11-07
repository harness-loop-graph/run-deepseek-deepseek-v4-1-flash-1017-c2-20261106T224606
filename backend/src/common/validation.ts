import { z } from 'zod';
import { validationError } from './errors';

export function parseWithSchema<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw validationError(`${path}${issue.message}`);
  }
  return result.data;
}

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'must be a valid calendar date');

export const isoDateTimeSchema = z
  .string()
  .refine((value) => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && /T\d{2}:\d{2}/.test(value);
  }, 'must be an ISO-8601 timestamp');

export const idSchema = z.coerce.number().int().positive();

export const roleSchema = z.enum(['patient', 'professional', 'staff', 'admin']);

export const emailSchema = z
  .string()
  .trim()
  .min(3, 'must be a valid email')
  .max(255)
  .email('must be a valid email');

export const paginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
