import { HttpException, HttpStatus } from '@nestjs/common';

export type ErrorCode =
  | 'invalid_request'
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'internal_error';

export class AppError extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    public readonly retryAfterSeconds?: number,
  ) {
    super({ code, message }, status);
  }
}

export function validationError(message: string): AppError {
  return new AppError('validation_error', message, HttpStatus.UNPROCESSABLE_ENTITY);
}

export function unauthorized(message = 'Authentication required'): AppError {
  return new AppError('unauthorized', message, HttpStatus.UNAUTHORIZED);
}

export function forbidden(message = 'You are not allowed to access this resource'): AppError {
  return new AppError('forbidden', message, HttpStatus.FORBIDDEN);
}

export function notFound(message = 'Resource not found'): AppError {
  return new AppError('not_found', message, HttpStatus.NOT_FOUND);
}

export function conflict(message: string): AppError {
  return new AppError('conflict', message, HttpStatus.CONFLICT);
}

export function badRequest(message: string): AppError {
  return new AppError('invalid_request', message, HttpStatus.BAD_REQUEST);
}

export function rateLimited(retryAfterSeconds: number): AppError {
  return new AppError(
    'rate_limited',
    'Too many requests, retry later',
    HttpStatus.TOO_MANY_REQUESTS,
    retryAfterSeconds,
  );
}

export function internalError(): AppError {
  return new AppError('internal_error', 'Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
}
