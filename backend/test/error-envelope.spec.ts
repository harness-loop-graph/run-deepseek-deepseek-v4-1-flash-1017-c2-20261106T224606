import { BadRequestException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { AppError, conflict, forbidden, internalError, notFound, validationError } from '../src/common/errors';

/**
 * RF-16: no error response may contain a stack trace, SQL or a file system
 * path. The filter is the single place that renders the envelope
 * `{ error: { code, message } }`, so the assertions below cover every status.
 */

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: { error: { code: string; message: string } };
}

function capture(exception: unknown): Captured {
  const captured: Captured = { status: 0, headers: {}, body: { error: { code: '', message: '' } } };
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
      return this;
    },
    json(body: Captured['body']) {
      captured.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  new AllExceptionsFilter().catch(exception, host);
  return captured;
}

const LEAK = /at\s+\w+\s+\(|\.ts:\d+|\/app\/|\/home\/|\bselect\b|\binsert\b|\bpg_/i;

describe('error envelope (RF-11 / RF-16)', () => {
  it('renders the declared envelope for every AppError', () => {
    const cases: Array<[AppError, number, string]> = [
      [validationError('bad input'), HttpStatus.UNPROCESSABLE_ENTITY, 'validation_error'],
      [forbidden(), HttpStatus.FORBIDDEN, 'forbidden'],
      [notFound(), HttpStatus.NOT_FOUND, 'not_found'],
      [conflict('taken'), HttpStatus.CONFLICT, 'conflict'],
      [internalError(), HttpStatus.INTERNAL_SERVER_ERROR, 'internal_error'],
    ];
    for (const [error, status, code] of cases) {
      const captured = capture(error);
      expect(captured.status).toBe(status);
      expect(captured.body.error.code).toBe(code);
      expect(captured.body.error.message.length).toBeGreaterThan(0);
      expect(JSON.stringify(captured.body)).not.toMatch(LEAK);
    }
  });

  it('adds Retry-After for a rate limited response', () => {
    const captured = capture(new AppError('rate_limited', 'slow down', 429, 42));
    expect(captured.status).toBe(429);
    expect(captured.headers['Retry-After']).toBe('42');
  });

  it('never leaks a stack trace from an unhandled exception', () => {
    const failure = new Error(
      'connect ECONNREFUSED /app/src/database/database.service.ts SELECT * FROM usuario',
    );
    const captured = capture(failure);
    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body).toEqual({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
    expect(JSON.stringify(captured.body)).not.toMatch(LEAK);
  });

  it('sanitises a framework message that carries SQL', () => {
    const captured = capture(
      new BadRequestException('select * from usuario where email = $1 failed'),
    );
    expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body.error.code).toBe('invalid_request');
    expect(captured.body.error.message).not.toMatch(/select/i);
  });

  it('renders malformed JSON bodies with a fixed message', () => {
    const captured = capture({ type: 'entity.parse.failed', message: 'Unexpected token < in JSON at position 0' });
    expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body).toEqual({
      error: { code: 'invalid_request', message: 'Malformed JSON body' },
    });
  });

  it('renders oversized bodies as 413', () => {
    const captured = capture({ type: 'entity.too.large' });
    expect(captured.status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(captured.body.error.code).toBe('payload_too_large');
  });

  it('renders an oversized upload as 413', () => {
    const captured = capture({ code: 'LIMIT_FILE_SIZE' });
    expect(captured.status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(captured.body.error.code).toBe('payload_too_large');
  });
});
