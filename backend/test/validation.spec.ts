import { describe, expect, it } from 'vitest';
import { AppError } from '../src/common/errors';
import { dateOnlySchema, parseWithSchema } from '../src/common/validation';
import {
  auditQuerySchema,
  availabilityQuerySchema,
  bookingBodySchema,
  createUserSchema,
  encounterBodySchema,
  idParamSchema,
  pageQuerySchema,
  refreshBodySchema,
  tokenBodySchema,
  updateRolesSchema,
} from '../src/common/schemas';

/**
 * RF-12: every request is validated at the boundary and undeclared fields are
 * rejected with 422 instead of being ignored. These tests exercise the exact
 * schemas the controllers call through `parseWithSchema`.
 */

function statusOf(error: unknown): number | null {
  return error instanceof AppError ? error.getStatus() : null;
}

function codeOf(error: unknown): string | null {
  return error instanceof AppError ? error.code : null;
}

describe('undeclared fields are rejected (RF-12)', () => {
  it('rejects an extra field on the booking body', () => {
    const failure = (() => {
      try {
        parseWithSchema(bookingBodySchema, {
          professionalId: 1,
          slotStart: '2030-01-07T09:00:00.000Z',
          pacienteId: 2,
        });
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(statusOf(failure)).toBe(422);
    expect(codeOf(failure)).toBe('validation_error');
  });

  it('rejects an extra field on the encounter body', () => {
    expect(() =>
      parseWithSchema(encounterBodySchema, { notes: 'a', diagnosis: 'b', version: 2 }),
    ).toThrow(AppError);
  });

  it('rejects an extra query parameter on the availability search', () => {
    expect(() =>
      parseWithSchema(availabilityQuerySchema, {
        professionalId: '1',
        from: '2030-01-01',
        to: '2030-01-02',
        patientId: '2',
      }),
    ).toThrow(AppError);
  });

  it('rejects an extra filter on the audit query', () => {
    expect(() => parseWithSchema(auditQuerySchema, { actor: 'admin', role: 'admin' })).toThrow(
      AppError,
    );
  });

  it('rejects an extra field on token exchange and refresh bodies', () => {
    expect(() =>
      parseWithSchema(tokenBodySchema, {
        code: 'c',
        code_verifier: 'v'.repeat(43),
        client_id: 'medapp-spa',
        redirect_uri: 'http://localhost:8080/auth/callback',
        client_secret: 'nope',
      }),
    ).toThrow(AppError);
    expect(() => parseWithSchema(refreshBodySchema, { refresh_token: 't', grant_type: 'x' })).toThrow(
      AppError,
    );
  });

  it('rejects an extra field on the admin user and role payloads', () => {
    expect(() =>
      parseWithSchema(createUserSchema, { email: 'a@b.co', roles: ['staff'], password: 'x' }),
    ).toThrow(AppError);
    expect(() => parseWithSchema(updateRolesSchema, { roles: ['admin'], active: false })).toThrow(
      AppError,
    );
  });
});

describe('declared values are validated', () => {
  it('rejects an impossible calendar date', () => {
    expect(() => parseWithSchema(dateOnlySchema, '2030-02-30')).toThrow(AppError);
    expect(() => parseWithSchema(dateOnlySchema, '30-02-2030')).toThrow(AppError);
  });

  it('rejects unknown roles', () => {
    expect(() => parseWithSchema(createUserSchema, { email: 'a@b.co', roles: ['wizard'] })).toThrow(
      AppError,
    );
  });

  it('rejects an empty encounter', () => {
    expect(() => parseWithSchema(encounterBodySchema, { notes: '   ', diagnosis: 'd' })).toThrow(
      AppError,
    );
  });

  it('rejects a non numeric path parameter', () => {
    expect(() => parseWithSchema(idParamSchema, { id: 'abc' })).toThrow(AppError);
    expect(() => parseWithSchema(idParamSchema, { id: '0' })).toThrow(AppError);
  });

  it('bounds the pagination parameters', () => {
    expect(() => parseWithSchema(pageQuerySchema, { page: '0' })).toThrow(AppError);
    expect(() => parseWithSchema(pageQuerySchema, { pageSize: '1000' })).toThrow(AppError);
    expect(parseWithSchema(pageQuerySchema, { page: '2', pageSize: '50' })).toEqual({
      page: 2,
      pageSize: 50,
    });
  });

  it('accepts the declared payloads unchanged', () => {
    expect(
      parseWithSchema(bookingBodySchema, {
        professionalId: '1',
        slotStart: '2030-01-07T09:00:00.000Z',
      }),
    ).toEqual({ professionalId: 1, slotStart: '2030-01-07T09:00:00.000Z' });
  });
});
